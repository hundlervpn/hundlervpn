import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { resetUserBoxState } from '@/lib/boxes';

export const dynamic = 'force-dynamic';

type ResetBody = {
  telegramId?: number;
  wipeHistory?: boolean;
};

// POST /api/boxes/admin/reset
// body: { telegramId, wipeHistory? }
//
// Admin-only helper — clears the CALLER'S OWN box_user_state row
// (cooldown + streak) so they can open another box immediately.
//
// v4 (2026-05-21 late): tightened scope. Previously accepted a `userId`
// param so an admin could nuke any user's cooldown; the requirement
// changed to "admin can only reset their own account" — admins should
// not be able to mess with other users' streaks. The userId param is
// now ignored entirely; resets always resolve `dbUserId` from the
// admin's own `telegramId`. Owner-side analytics and bans live in
// their own endpoints, not here.
//
// Admin gate is double-checked: lib/admin.ts whitelist on the
// telegramId param + the underlying isAdmin() returns false for any
// non-Telegram caller.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ResetBody;
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

      // Resolve only by the caller's own telegram_id — refuses to act
      // on anyone else even if their userId was supplied.
      const byTg = await client.query<{ id: number }>(
        'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1',
        [telegramId],
      );
      const dbUserId = byTg.rows[0]?.id ?? null;

      if (!dbUserId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const state = await resetUserBoxState(client, dbUserId, {
        wipeHistory: body.wipeHistory === true,
      });

      await client.query('COMMIT');

      return NextResponse.json({ ok: true, state });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[api/boxes/admin/reset] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
