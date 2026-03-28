import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { getSubscriptionUrlWithLimit, encryptSubscriptionUrl } from '@/lib/sub-token';

type UserState = {
  userId: number;
  telegramId: number | null;
  isBanned: boolean;
  banReason: string | null;
  banType: string | null;
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

    // Only update if there's a valid candidate - don't deactivate all keys if no candidate
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
            OR s.id IS NULL
          )
        ORDER BY 
          CASE WHEN s.id IS NOT NULL AND s.status = 'active' THEN 0 ELSE 1 END,
          vk.created_at DESC
        LIMIT 1
      )
      UPDATE vpn_keys vk
      SET is_active = (vk.id = (SELECT id FROM candidate))
      WHERE vk.user_id IN (SELECT id FROM target_user)
        AND EXISTS (SELECT 1 FROM candidate);
      `,
      [userParam]
    );

    const result = await dbQuery<UserState>(
      `
      SELECT
        u.id AS "userId",
        u.telegram_id AS "telegramId",
        u.is_banned AS "isBanned",
        u.ban_reason AS "banReason",
        u.ban_type AS "banType",
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

    const { status, hasActiveKey, telegramId: tgId } = result.rows[0];
    console.log('User state check:', { status, hasActiveKey, telegramId: tgId });
    
    let subscriptionUrl: string | null = null;
    
    if (status === 'active' && hasActiveKey && tgId) {
      const rawSubUrl = await getSubscriptionUrlWithLimit(Number(tgId));
      console.log('Raw subscription URL:', rawSubUrl);
      
      if (rawSubUrl) {
        subscriptionUrl = await encryptSubscriptionUrl(rawSubUrl);
        console.log('Encrypted subscription URL:', subscriptionUrl?.slice(0, 80));
      }
    } else {
      console.log('Subscription URL not generated - conditions not met');
    }

    return NextResponse.json({
      ok: true,
      profile: {
        ...result.rows[0],
        subscriptionUrl,
      },
    });
  } catch (error) {
    console.error('User state error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
