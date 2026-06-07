import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// One-shot migration runner for the 2026-05-22 referral-cash schema
// (`db/migrations/2026-05-22-referral-cash.sql`).
//
// The migration file is idempotent (`CREATE … IF NOT EXISTS`, `ADD COLUMN
// IF NOT EXISTS`, `DROP TRIGGER IF EXISTS`), so re-running this endpoint
// is harmless — second call is a no-op.
//
// POST /api/admin/db/migrate-referral-cash
// body: { telegramId }
//
// Returns: { ok, applied: true } or 403 if the caller isn't an admin.
//
// We keep this in `/api/admin/db/` rather than a generic migrate endpoint
// to keep the auth surface narrow — only this one specific migration can
// be run, no SQL-injection risk via path params.
// ────────────────────────────────────────────────────────────────────────────

type MigrateBody = { telegramId?: number };

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as MigrateBody;
    const telegramId = body.telegramId;
    if (!telegramId || !Number.isFinite(telegramId) || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Read the SQL file from the bundled `db/migrations/` directory.
    // process.cwd() returns the project root in both `next dev` and the
    // standalone build output.
    const sqlPath = join(process.cwd(), 'db', 'migrations', '2026-05-22-referral-cash.sql');
    let sql: string;
    try {
      sql = readFileSync(sqlPath, 'utf8');
    } catch (e) {
      console.error('[migrate-referral-cash] file not found:', sqlPath, e);
      return NextResponse.json({ error: 'Migration file missing' }, { status: 500 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, applied: true, file: '2026-05-22-referral-cash.sql' });
    } catch (e: any) {
      await client.query('ROLLBACK');
      console.error('[migrate-referral-cash] SQL error:', e);
      return NextResponse.json(
        { error: e?.message || 'Migration failed', detail: e?.detail ?? null },
        { status: 500 },
      );
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[migrate-referral-cash] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
