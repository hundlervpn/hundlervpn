import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { grantSuperBoxToUser } from '@/lib/boxes';

export const dynamic = 'force-dynamic';

type GrantBody = {
  telegramId?: number;
};

// POST /api/boxes/admin/grant-super
// body: { telegramId }
//
// Admin-only debug helper — primes the CALLER'S OWN box state so their
// next open rolls a SUPER box (current_streak = 6, cooldown cleared,
// last_opened_at refreshed). Used to test the SUPER reveal flow without
// grinding 7 daily opens.
//
// Scope: self-only, exactly like /api/boxes/admin/reset. Admins cannot
// grant super boxes to other users — that would be a content/economy
// integrity hazard. The userId param is intentionally absent from the
// request shape; resolution is always by `telegramId` of the caller.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as GrantBody;
    const telegramId = body.telegramId;

    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const byTg = await client.query<{ id: number }>(
        'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1',
        [telegramId],
      );
      const dbUserId = byTg.rows[0]?.id ?? null;

      if (!dbUserId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const state = await grantSuperBoxToUser(client, dbUserId);

      await client.query('COMMIT');

      return NextResponse.json({ ok: true, state });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[api/boxes/admin/grant-super] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
