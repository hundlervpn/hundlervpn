import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { assertTelegramLinked, BoxTelegramRequiredError, clearUserRewardHistory, getUserRewardHistory } from '@/lib/boxes';

export const dynamic = 'force-dynamic';

// GET /api/boxes/rewards?telegramId=...&userId=...&limit=50&offset=0
//
// Полная история наград боксов с пагинацией. 2026-05-22: admin-gate
// снят — фича доступна всем юзерам. Идентификация: telegramId (Telegram
// WebApp) или userId (email-only).
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    const queryUserId = url.searchParams.get('userId');
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

    if (!telegramId && !queryUserId) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      const dbUserId = await resolveDbUserId(client, telegramId, queryUserId);
      if (!dbUserId) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Same Telegram-link gate as /api/boxes/state and /api/boxes/open.
      // Without it, an email-only user could still see history while the
      // open/state endpoints would refuse — confusing UX.
      try {
        await assertTelegramLinked(client, dbUserId);
      } catch (e) {
        if (e instanceof BoxTelegramRequiredError) {
          return NextResponse.json({ error: 'telegram_required' }, { status: 403 });
        }
        throw e;
      }

      const result = await getUserRewardHistory(client, dbUserId, limit, offset);
      return NextResponse.json({
        ok: true,
        items: result.items,
        total: result.total,
        limit: Math.max(1, Math.min(200, Math.floor(limit))),
        offset: Math.max(0, Math.floor(offset)),
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[api/boxes/rewards] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/boxes/rewards?telegramId=...&userId=...
//
// Hard-deletes the caller's box_rewards rows. Used by the "Clear history"
// button on BoxesHistoryView. Does NOT reset streak / cooldown — см.
// clearUserRewardHistory() для полного контракта сохраняемого состояния.
// 2026-05-22: admin-gate снят — каждый юзер чистит только СВОЮ историю
// (резолвится по его telegramId / userId).
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    const queryUserId = url.searchParams.get('userId');

    if (!telegramId && !queryUserId) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      const dbUserId = await resolveDbUserId(client, telegramId, queryUserId);
      if (!dbUserId) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      try {
        await assertTelegramLinked(client, dbUserId);
      } catch (e) {
        if (e instanceof BoxTelegramRequiredError) {
          return NextResponse.json({ error: 'telegram_required' }, { status: 403 });
        }
        throw e;
      }

      const deleted = await clearUserRewardHistory(client, dbUserId);
      return NextResponse.json({ ok: true, deleted });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[api/boxes/rewards DELETE] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Helper: резолвим внутренний users.id по приоритету userId → telegramId.
// Вынесено в отдельную функцию чтобы GET/DELETE не дублировали 8 строк
// одинакового кода. Возвращает null если ни один параметр не валиден или
// юзер не найден — оба случая обрабатываются 404 у вызывающей стороны.
async function resolveDbUserId(
  client: import('pg').PoolClient,
  telegramId: string | null,
  queryUserId: string | null,
): Promise<number | null> {
  if (queryUserId) {
    const id = parseInt(queryUserId, 10);
    if (!Number.isFinite(id)) return null;
    const r = await client.query<{ id: number }>(
      'SELECT id FROM users WHERE id = $1 LIMIT 1',
      [id],
    );
    return r.rows[0]?.id ?? null;
  }
  if (telegramId) {
    const tg = parseInt(telegramId, 10);
    if (!Number.isFinite(tg)) return null;
    const r = await client.query<{ id: number }>(
      'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1',
      [tg],
    );
    return r.rows[0]?.id ?? null;
  }
  return null;
}
