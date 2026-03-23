import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { getSubscriptionUrl } from '@/lib/sub-token';

type UserState = {
  userId: number;
  telegramId: number | null;
  status: 'active' | 'expired' | 'canceled' | 'none';
  endDate: string | null;
  daysLeft: number;
  hasActiveKey: boolean;
  subscriptionUrl?: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramIdRaw = url.searchParams.get('telegramId');
    const userIdRaw = url.searchParams.get('userId');

    if (!telegramIdRaw && !userIdRaw) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    const telegramId = telegramIdRaw ? Number(telegramIdRaw) : null;
    const userId = userIdRaw ? Number(userIdRaw) : null;
    if ((telegramIdRaw && !Number.isFinite(telegramId)) || (userIdRaw && !Number.isFinite(userId))) {
      return NextResponse.json({ error: 'Invalid id parameter' }, { status: 400 });
    }

    const userWhereClause = telegramId ? 'telegram_id = $1' : 'id = $1';
    const userParam = telegramId ?? userId;

    await dbQuery(
      `
      WITH target_user AS (
        SELECT id
        FROM users
        WHERE ${userWhereClause}
        LIMIT 1
      ),
      candidate AS (
        SELECT vk.id
        FROM vpn_keys vk
        JOIN target_user tu ON tu.id = vk.user_id
        LEFT JOIN subscriptions s ON s.id = vk.subscription_id
        WHERE (vk.expires_at IS NULL OR vk.expires_at > NOW())
          AND (
            (s.id IS NOT NULL AND s.status = 'active' AND s.end_date > NOW())
            OR (s.id IS NULL AND vk.is_active = TRUE)
          )
        ORDER BY vk.created_at DESC
        LIMIT 1
      )
      UPDATE vpn_keys vk
      SET is_active = CASE WHEN vk.id = (SELECT id FROM candidate) THEN TRUE ELSE FALSE END
      WHERE vk.user_id IN (SELECT id FROM target_user);
      `,
      [userParam]
    );

    const result = await dbQuery<UserState>(
      `
      SELECT
        u.id AS "userId",
        u.telegram_id AS "telegramId",
        CASE
          WHEN s.status = 'active' AND s.end_date > NOW() THEN 'active'
          WHEN s.status IS NULL THEN 'none'
          ELSE 'none'
        END::text AS status,
        CASE
          WHEN s.status = 'active' AND s.end_date > NOW() THEN s.end_date
          ELSE NULL
        END AS "endDate",
        CASE
          WHEN s.end_date IS NULL THEN 0
          WHEN s.end_date <= NOW() THEN 0
          WHEN s.status <> 'active' THEN 0
          ELSE CEIL(EXTRACT(EPOCH FROM (s.end_date - NOW())) / 86400)::int
        END AS "daysLeft",
        EXISTS (
          SELECT 1
          FROM vpn_keys vk
          LEFT JOIN subscriptions sk ON sk.id = vk.subscription_id
          WHERE vk.user_id = u.id
            AND vk.is_active = TRUE
            AND (vk.expires_at IS NULL OR vk.expires_at > NOW())
            AND (sk.id IS NULL OR (sk.status = 'active' AND sk.end_date > NOW()))
        ) AS "hasActiveKey"
      FROM users u
      LEFT JOIN LATERAL (
        SELECT status, end_date
        FROM subscriptions
        WHERE user_id = u.id
        ORDER BY end_date DESC NULLS LAST
        LIMIT 1
      ) s ON TRUE
      WHERE u.${userWhereClause}
      LIMIT 1;
      `,
      [userParam]
    );

    if (!result.rows[0]) {
      return NextResponse.json({
        ok: true,
        profile: null,
      });
    }

    return NextResponse.json({
      ok: true,
      profile: {
        ...result.rows[0],
        subscriptionUrl: result.rows[0].status === 'active' && result.rows[0].hasActiveKey && result.rows[0].telegramId ? getSubscriptionUrl(Number(result.rows[0].telegramId)) : null,
      },
    });
  } catch (error) {
    console.error('User state error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
