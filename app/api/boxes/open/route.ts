import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { deactivateExpiredAccess } from '@/lib/access';
import { assertTelegramLinked, BoxCooldownError, BoxTelegramRequiredError, openBox } from '@/lib/boxes';

export const dynamic = 'force-dynamic';

type OpenBoxBody = {
  telegramId?: number;
  userId?: number;
};

// POST /api/boxes/open  body: { telegramId } | { userId }
//
// Открывает один daily/super бокс и возвращает награду + новое состояние.
// 2026-05-22: фича выведена из беты, admin-gate снят. Cooldown / streak
// логика в @/lib/boxes сама гарантирует что за день можно взять только
// один бокс — этого достаточно чтобы не дать спамить открытия.
//
// Вся материализация награды (включая subscription extension через
// ensureVpnKey) обёрнута в одну транзакцию: падение в середине
// откатывает и box ledger, и продление подписки — никаких orphaned
// days.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as OpenBoxBody;
    const telegramId = body.telegramId;
    const queryUserId = body.userId;

    if ((!telegramId || !Number.isFinite(telegramId)) && (!queryUserId || !Number.isFinite(queryUserId))) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Resolve DB user_id. Same lookup pattern as the state route:
      // explicit userId param wins, telegramId is the fallback.
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
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Same Telegram-link gate as /api/boxes/state. We re-check here
      // (instead of trusting the frontend) because the open endpoint
      // mutates ledger state — a stray POST from a tampered client
      // mustn't bypass the rule. Returns 403 so the SPA renders the
      // «Link Telegram» CTA instead of a generic error toast.
      try {
        await assertTelegramLinked(client, dbUserId);
      } catch (e) {
        if (e instanceof BoxTelegramRequiredError) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'telegram_required' }, { status: 403 });
        }
        throw e;
      }

      // Sweep expired access first so that activateSubscriptionForDays
      // makes the right INSERT-vs-UPDATE choice (a freshly expired sub
      // shouldn't keep getting extended in-place).
      await deactivateExpiredAccess(client, dbUserId);

      const result = await openBox(client, dbUserId);

      await client.query('COMMIT');

      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof BoxCooldownError) {
        return NextResponse.json(
          {
            error: 'Cooldown active',
            nextAvailableAt: error.nextAvailableAt.toISOString(),
          },
          { status: 429 },
        );
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[api/boxes/open] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
