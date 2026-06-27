import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { ensureRemnawaveUser } from '@/lib/remnawave-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * One-off backfill: provision existing active-subscription users into Remnawave.
 *
 * Idempotent (ensureRemnawaveUser caches remnawave_uuid). Best-effort per user:
 * one failure never aborts the batch. Admin-gated (same isAdmin check as ban).
 *
 *   GET  ?adminId=<tg>                         -> scope preview (counts, no writes)
 *   POST { telegramId, limit?, onlyMissing?, dryRun? }  -> run backfill
 *
 * onlyMissing (default true) skips users already mapped (remnawave_uuid set),
 * so the endpoint is safe to re-run until ok stabilizes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const adminId = url.searchParams.get('adminId');
  if (!isAdmin(adminId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const pool = getDbPool();
  const total = await pool.query(
    'SELECT COUNT(DISTINCT u.id)::int AS n FROM users u JOIN subscriptions s ON s.user_id = u.id WHERE s.status = $1 AND s.end_date > NOW()',
    ['active'],
  );
  const missing = await pool.query(
    'SELECT COUNT(DISTINCT u.id)::int AS n FROM users u JOIN subscriptions s ON s.user_id = u.id WHERE s.status = $1 AND s.end_date > NOW() AND u.remnawave_uuid IS NULL',
    ['active'],
  );
  return NextResponse.json({
    activeSubUsers: total.rows[0].n,
    notYetInPanel: missing.rows[0].n,
  });
}

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const telegramId = body.telegramId != null ? body.telegramId : body.adminId;
  if (!isAdmin(telegramId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 1000);
  const onlyMissing = body.onlyMissing !== false;
  const dryRun = body.dryRun === true;

  const pool = getDbPool();
  let sql =
    'SELECT DISTINCT u.id FROM users u JOIN subscriptions s ON s.user_id = u.id WHERE s.status = $1 AND s.end_date > NOW()';
  if (onlyMissing) {
    sql += ' AND u.remnawave_uuid IS NULL';
  }
  sql += ' ORDER BY u.id LIMIT $2';
  const { rows } = await pool.query(sql, ['active', limit]);
  const targets: number[] = rows.map((r: any) => Number(r.id));

  if (dryRun) {
    return NextResponse.json({ dryRun: true, count: targets.length, userIds: targets });
  }

  const ok: number[] = [];
  const failed: Array<{ userId: number; error: string }> = [];
  for (const userId of targets) {
    try {
      await ensureRemnawaveUser(userId);
      ok.push(userId);
    } catch (err) {
      failed.push({ userId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    processed: targets.length,
    ok: ok.length,
    okUserIds: ok,
    failedCount: failed.length,
    failed,
  });
}
