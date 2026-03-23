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

    if (!telegramIdRaw) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }

    const telegramId = Number(telegramIdRaw);
    if (!Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is invalid' }, { status: 400 });
    }

    await dbQuery(
      `
      UPDATE vpn_keys
      SET is_active = FALSE
      WHERE (expires_at IS NOT NULL AND expires_at <= NOW())
         OR user_id IN (
           SELECT s.user_id
           FROM subscriptions s
           WHERE s.status <> 'active' OR s.end_date <= NOW()
         );
      `
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
          WHERE vk.user_id = u.id
            AND vk.is_active = TRUE
            AND (vk.expires_at IS NULL OR vk.expires_at > NOW())
        ) AS "hasActiveKey"
      FROM users u
      LEFT JOIN LATERAL (
        SELECT status, end_date
        FROM subscriptions
        WHERE user_id = u.id
        ORDER BY end_date DESC NULLS LAST
        LIMIT 1
      ) s ON TRUE
      WHERE u.telegram_id = $1
      LIMIT 1;
      `,
      [telegramId]
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
        subscriptionUrl: result.rows[0].status === 'active' ? getSubscriptionUrl(telegramId) : null,
      },
    });
  } catch (error) {
    console.error('User state error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
