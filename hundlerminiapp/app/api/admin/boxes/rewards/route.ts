import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { rewardRowToHistoryItem } from '@/lib/boxes';

export const dynamic = 'force-dynamic';

// GET /api/admin/boxes/rewards?telegramId=...&limit=100&offset=0
//                              &boxKind=daily|super (optional)
//                              &rewardKind=hours|discount_coupon (optional)
//
// Cross-user feed of recent box rewards — "who won what" view for the
// admin panel. Joins box_rewards → users so the UI can show a
// recognisable name/email next to each reward. Also returns aggregate
// totals (hours granted, coupons issued / active / used / expired) so
// the admin can see the economic impact at a glance.
//
// Filters intentionally apply to BOTH `items` and `total`, but NOT to
// `totals`. `totals` always reflects the entire box_rewards table —
// that's the global "big picture" the admin wants regardless of which
// tab they're staring at. `total` (singular) is the count for the
// currently-filtered slice, used for pagination + "X more" labels.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') ?? '100', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

    // Accept either DB-canonical (`subscription_hours`,
    // `discount_coupon`) or short UI aliases (`hours`). 'days' is
    // grandfathered in case earlier rows used `subscription_days`.
    const rewardKindRaw = url.searchParams.get('rewardKind');
    const rewardKind: string | null =
      rewardKindRaw === 'hours' ? 'subscription_hours'
      : rewardKindRaw === 'days' ? 'subscription_days'
      : rewardKindRaw;
    const boxKind = url.searchParams.get('boxKind');

    if (!telegramId || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();
    type Row = {
      id: number;
      box_kind: 'daily' | 'super';
      reward_kind: 'subscription_hours' | 'subscription_days' | 'discount_coupon';
      reward_value: number;
      streak_at_open: number;
      created_at: Date;
      metadata: any;
      user_id: number;
      telegram_id: string | null;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      // Joined from promo_codes / promo_code_uses for discount_coupon rows.
      promo_id: number | null;
      promo_used_count: number | null;
      promo_max_uses: number | null;
      promo_expires_at: Date | null;
      coupon_used_at: Date | null;
    };

    // Build WHERE dynamically so empty filters don't poison the query
    // plan with NULL comparisons.
    const conds: string[] = [];
    const params: any[] = [];
    if (boxKind === 'daily' || boxKind === 'super') {
      params.push(boxKind);
      conds.push(`br.box_kind = $${params.length}`);
    }
    if (rewardKind && ['subscription_hours', 'subscription_days', 'discount_coupon'].includes(rewardKind)) {
      params.push(rewardKind);
      conds.push(`br.reward_kind = $${params.length}`);
    }
    const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // Items page. LEFT JOIN promo_codes via the promoCodeId stashed in
    // box_rewards.metadata so we can surface the canonical "used / not
    // used" state — promo_codes.used_count is the source of truth,
    // bumped by /api/payments/sbp/create when the coupon is redeemed.
    // We also pull promo_code_uses.used_at for the exact redemption
    // timestamp shown in the admin feed.
    const itemsSql = `
      SELECT br.id, br.box_kind, br.reward_kind, br.reward_value, br.streak_at_open,
             br.created_at, br.metadata,
             u.id AS user_id, u.telegram_id::text AS telegram_id,
             u.username, u.first_name, u.last_name, u.email,
             pc.id            AS promo_id,
             pc.used_count    AS promo_used_count,
             pc.max_uses      AS promo_max_uses,
             pc.expires_at    AS promo_expires_at,
             pcu.used_at      AS coupon_used_at
        FROM box_rewards br
        JOIN users u ON u.id = br.user_id
        LEFT JOIN promo_codes pc ON pc.id = NULLIF(br.metadata->>'promoCodeId', '')::int
        LEFT JOIN promo_code_uses pcu ON pcu.promo_code_id = pc.id AND pcu.user_id = u.id
        ${whereClause}
       ORDER BY br.created_at DESC, br.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2};`;
    const rows = await pool.query<Row>(itemsSql, [...params, limit, offset]);

    // Filtered total (drives pagination).
    const totalSql = `SELECT COUNT(*)::text AS count FROM box_rewards br ${whereClause};`;
    const totalRow = await pool.query<{ count: string }>(totalSql, params);

    // Global aggregates — always over the full table, ignoring filters.
    // Coupon status is computed via JOIN on promo_codes (the actual
    // ledger), not metadata — that way `used_count` increments from the
    // checkout flow flow straight through to the admin UI without us
    // having to maintain a duplicate metadata column.
    const totalsRow = await pool.query<{
      total_opens: string;
      total_hours_granted: string;
      total_coupons_issued: string;
      coupons_active: string;
      coupons_used: string;
      coupons_expired: string;
    }>(`
      WITH coupon_rows AS (
        SELECT br.id,
               pc.used_count,
               pc.max_uses,
               pc.expires_at
          FROM box_rewards br
          LEFT JOIN promo_codes pc ON pc.id = NULLIF(br.metadata->>'promoCodeId', '')::int
         WHERE br.reward_kind = 'discount_coupon'
      )
      SELECT
        (SELECT COUNT(*)::text FROM box_rewards) AS total_opens,
        COALESCE((SELECT SUM(CASE WHEN reward_kind = 'subscription_hours' THEN reward_value
                                  WHEN reward_kind = 'subscription_days'  THEN reward_value * 24
                                  ELSE 0 END)
                     FROM box_rewards), 0)::text AS total_hours_granted,
        (SELECT COUNT(*)::text FROM coupon_rows) AS total_coupons_issued,
        (SELECT COUNT(*)::text FROM coupon_rows
          WHERE used_count IS NOT NULL
            AND used_count < COALESCE(max_uses, 1)
            AND (expires_at IS NULL OR expires_at > NOW())) AS coupons_active,
        (SELECT COUNT(*)::text FROM coupon_rows
          WHERE used_count IS NOT NULL AND used_count >= COALESCE(max_uses, 1)) AS coupons_used,
        (SELECT COUNT(*)::text FROM coupon_rows
          WHERE (used_count IS NULL OR used_count = 0)
            AND expires_at IS NOT NULL
            AND expires_at <= NOW()) AS coupons_expired;
    `);
    const t = totalsRow.rows[0];
    const totals = {
      totalOpens: parseInt(t?.total_opens ?? '0', 10),
      totalHoursGranted: parseInt(t?.total_hours_granted ?? '0', 10),
      totalCouponsIssued: parseInt(t?.total_coupons_issued ?? '0', 10),
      couponsActive: parseInt(t?.coupons_active ?? '0', 10),
      couponsUsed: parseInt(t?.coupons_used ?? '0', 10),
      couponsExpired: parseInt(t?.coupons_expired ?? '0', 10),
    };

    const now = new Date();
    const items = rows.rows.map((r) => {
      const reward = rewardRowToHistoryItem(
        {
          id: r.id,
          box_kind: r.box_kind,
          reward_kind: r.reward_kind,
          reward_value: r.reward_value,
          streak_at_open: r.streak_at_open,
          created_at: r.created_at,
          metadata: r.metadata,
        } as any,
        now,
      );
      // Override coupon status with the canonical promo_codes data when
      // we have it: `coupon_used_at` from promo_code_uses is the truth
      // about redemption, `promo_expires_at` about expiry. metadata
      // copies are only fallbacks for rows where the JOIN missed.
      const couponUsedAt = r.coupon_used_at ? new Date(r.coupon_used_at).toISOString() : null;
      const promoExpiresIso = r.promo_expires_at ? new Date(r.promo_expires_at).toISOString() : reward.couponExpiresAt;
      const couponExpired = !!(r.promo_expires_at && new Date(r.promo_expires_at).getTime() <= now.getTime());
      return {
        ...reward,
        couponExpiresAt: promoExpiresIso,
        couponExpired,
        couponUsedAt,
        user: {
          id: r.user_id,
          telegramId: r.telegram_id,
          username: r.username,
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.email,
          // Display-friendly label for the UI to consume directly.
          displayName:
            [r.first_name, r.last_name].filter(Boolean).join(' ').trim() ||
            r.username ||
            r.email ||
            (r.telegram_id ? `tg:${r.telegram_id}` : `user#${r.user_id}`),
        },
      };
    });

    const total = parseInt(totalRow.rows[0]?.count ?? '0', 10);
    return NextResponse.json({
      ok: true,
      items,
      total,
      hasMore: offset + items.length < total,
      limit,
      offset,
      totals,
    });
  } catch (error) {
    console.error('[api/admin/boxes/rewards] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
