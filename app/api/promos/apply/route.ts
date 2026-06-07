import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { applyPromoCode, deactivateExpiredAccess, upsertTelegramUser } from '@/lib/access';

type ApplyPromoBody = {
  telegramId?: number;
  userId?: number;
  code?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ApplyPromoBody;
    const telegramId = body.telegramId;
    const bodyUserId = body.userId;
    const code = body.code?.trim();

    if (!telegramId && !bodyUserId) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      let dbUserId: number;

      if (telegramId && Number.isFinite(telegramId)) {
        // Telegram user: upsert as before
        const syncedUser = await upsertTelegramUser(client, {
          telegramId,
          username: body.username ?? null,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          photoUrl: body.photoUrl ?? null,
          referralCode: `u${telegramId.toString(36)}`,
        });
        dbUserId = syncedUser.userId;
      } else {
        // Email user: verify user exists by userId
        const userRes = await client.query<{ id: number }>(
          'SELECT id FROM users WHERE id = $1 LIMIT 1',
          [bodyUserId]
        );
        if (!userRes.rows[0]) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        dbUserId = userRes.rows[0].id;
      }

      await deactivateExpiredAccess(client, dbUserId);

      const result = await applyPromoCode(client, {
        userId: dbUserId,
        telegramId: telegramId ?? null,
        code,
      });

      await client.query('COMMIT');

      return NextResponse.json({
        ok: true,
        type: result.type,
        promoCode: result.promoCode,
        promoId: result.promoId,
        discountPercent: result.discountPercent,
        days: result.days,
        endDate: result.endDate,
        keyUri: result.keyUri,
        subscriptionUrl: result.subscriptionUrl,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Promo apply error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
