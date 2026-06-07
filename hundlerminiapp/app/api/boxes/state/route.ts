import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { assertTelegramLinked, BoxTelegramRequiredError, getBoxState } from '@/lib/boxes';

export const dynamic = 'force-dynamic';

// GET /api/boxes/state?telegramId=NNN  (or ?userId=NNN)
//
// Возвращает состояние боксов пользователя (стрик, кулдаун, последние
// награды). 2026-05-22: фича вышла из беты — admin-gate снят, теперь
// доступно всем юзерам. Email-only авторизация работает через ?userId,
// Telegram WebApp — через ?telegramId.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramIdRaw = url.searchParams.get('telegramId');
    const userIdRaw = url.searchParams.get('userId');

    const telegramId = telegramIdRaw ? Number(telegramIdRaw) : null;
    const queryUserId = userIdRaw ? Number(userIdRaw) : null;

    if ((!telegramId || !Number.isFinite(telegramId)) && (!queryUserId || !Number.isFinite(queryUserId))) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      // Resolve the DB user_id. Prefer the explicit userId param, fall
      // back to the telegram_id lookup. We don't upsert here — the
      // Boxes tab assumes the user already exists (they hit /api/users/sync
      // on app boot).
      let dbUserId: number | null = null;
      if (queryUserId && Number.isFinite(queryUserId)) {
        const exists = await client.query<{ id: number }>(
          'SELECT id FROM users WHERE id = $1 LIMIT 1',
          [queryUserId],
        );
        dbUserId = exists.rows[0]?.id ?? null;
      } else {
        const byTg = await client.query<{ id: number }>(
          'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1',
          [telegramId],
        );
        dbUserId = byTg.rows[0]?.id ?? null;
      }

      if (!dbUserId) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Boxes are gated on a linked Telegram account. Email-only users without
      // a `users.telegram_id` get a structured 403 here so the frontend can
      // render the «Link Telegram» CTA instead of a raw validation toast.
      try {
        await assertTelegramLinked(client, dbUserId);
      } catch (e) {
        if (e instanceof BoxTelegramRequiredError) {
          return NextResponse.json({ error: 'telegram_required' }, { status: 403 });
        }
        throw e;
      }

      const state = await getBoxState(client, dbUserId);
      return NextResponse.json({ ok: true, state });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[api/boxes/state] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
