import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { isReferralPartner, referralCashPercentForInviter, referralPartnerIds, isSiteReferralInviter } from '@/lib/referral-cash';

type AdminUser = {
  id: string;
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_verified: boolean | null;
  auth_type: string | null;
  status: string;
  is_banned: boolean;
  ban_reason: string | null;
  ban_type: string | null;
  created_at: string;
  last_seen_at: string;
  total_paid: string;
  payments_count: string;
  subscription_status: string | null;
  subscription_end: string | null;
  // 2026-05-06 (admin abuse-detection): lifetime stats since registration.
  // total_lifetime_days = SUM(end_date - start_date) over ALL subscription
  // rows for this user, in days (rounded). Includes paid + bonus + referral
  // + promo extensions because all of those mutate end_date.
  // device_count = number of currently-bound (non-kicked) device_sessions.
  // A user with high total_lifetime_days but device_count = 0 is suspicious
  // (paying but giving the subscription away to other people).
  total_lifetime_days: string;
  device_count: string;
  // 2026-06-13 (admin partner view): referral fields so the admin can see a
  // partner's code/links, how many users they invited and their cash balance
  // straight from the user card.
  referral_code: string | null;
  referral_balance_rub: string;
  referred_count: string;
  // Computed server-side (not DB columns): is this inviter a managed partner
  // and at what cash percent.
  is_partner?: boolean;
  partner_cash_percent?: number;
  // Whether this inviter's website/email (?ref=) link actually attributes
  // signups. Only allowlisted inviters (e.g. 5700) earn from site/email refs;
  // for everyone else the site link is dead, so the admin UI hides it.
  is_site_referral_inviter?: boolean;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const search = url.searchParams.get('search')?.trim() || '';
    // v58 / v68: admin can filter the user list by current subscription state.
    // 'active'             → users with an active, non-expired subscription
    // 'none'               → users with no subscription or an expired/cancelled one
    // 'active_no_devices'  → users with active sub but ZERO bound devices
    //                        (kicked_at IS NULL). Targets potential abusers
    //                        who pay but share their VLESS link with others
    //                        instead of installing the VPN themselves.
    // 'all'/''             → no subscription filter (default)
    const subscriptionFilter = (url.searchParams.get('subscription') || 'all').toLowerCase();
    // v68: optional sort key. Default 'recent' (created_at DESC). 'lifetime'
    // sorts by total_lifetime_days DESC — used by admins to surface heavy-
    // usage accounts when looking for abuse patterns.
    const sortBy = (url.searchParams.get('sort') || 'recent').toLowerCase();
    // 2026-06-13: when partner=1 the list is restricted to managed partner
    // accounts (inviters with a negotiated cash deal). Lets the admin jump
    // straight to them without searching.
    const partnersOnly = ['1', 'true', 'yes'].includes((url.searchParams.get('partner') || '').toLowerCase());
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = 50;
    const offset = (page - 1) * limit;

    const whereParts: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      // v57: also search by email (substring) and exact user.id — admin
      // copies these from a card or another tool and expects to find the user.
      whereParts.push(`(u.username ILIKE $${paramIndex} OR u.first_name ILIKE $${paramIndex} OR u.last_name ILIKE $${paramIndex} OR u.telegram_id::text LIKE $${paramIndex} OR u.email ILIKE $${paramIndex} OR u.id::text = $${paramIndex + 1})`);
      params.push(`%${search}%`);
      params.push(search);
      paramIndex += 2;
    }

    // v58 / v68: subscription filter applied via EXISTS so it composes with COUNT() and
    // doesn't accidentally drop users that have no subscriptions at all (LEFT JOIN
    // would let them through but EXISTS / NOT EXISTS keeps the SQL simple).
    if (subscriptionFilter === 'active') {
      whereParts.push(`EXISTS (
        SELECT 1 FROM subscriptions sf
        WHERE sf.user_id = u.id
          AND sf.status = 'active'
          AND sf.end_date IS NOT NULL
          AND sf.end_date > NOW()
      )`);
    } else if (subscriptionFilter === 'none') {
      whereParts.push(`NOT EXISTS (
        SELECT 1 FROM subscriptions sf
        WHERE sf.user_id = u.id
          AND sf.status = 'active'
          AND sf.end_date IS NOT NULL
          AND sf.end_date > NOW()
      )`);
    } else if (subscriptionFilter === 'active_no_devices') {
      // v68: matches the same audience used by `/api/admin/broadcasts`
      // (`buildAudienceCountSql('active_no_devices')`) — users with a
      // live subscription but zero non-kicked device_sessions.
      whereParts.push(`EXISTS (
        SELECT 1 FROM subscriptions sf
        WHERE sf.user_id = u.id
          AND sf.status = 'active'
          AND sf.end_date IS NOT NULL
          AND sf.end_date > NOW()
      )`);
      whereParts.push(`NOT EXISTS (
        SELECT 1 FROM device_sessions ds
        WHERE ds.user_id = u.id
          AND ds.kicked_at IS NULL
      )`);
    }

    if (partnersOnly) {
      const partnerIds = referralPartnerIds();
      if (partnerIds.length === 0) {
        // No partners configured — short-circuit to an empty result.
        return NextResponse.json({ ok: true, users: [], total: 0, page: 1, totalPages: 0 });
      }
      whereParts.push(`u.id = ANY($${paramIndex}::bigint[])`);
      params.push(partnerIds);
      paramIndex += 1;
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const countResult = await dbQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users u ${whereClause};`,
      params
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    // v68: ORDER BY whitelist. 'lifetime' sorts heaviest-usage users first
    // so admins can spot abusers who racked up many days without binding
    // any device. Anything else falls back to the recent-signup default.
    const orderClause = sortBy === 'lifetime'
      ? 'ORDER BY total_lifetime_days DESC, u.created_at DESC'
      : 'ORDER BY u.created_at DESC';

    const result = await dbQuery<AdminUser>(
      `
      SELECT
        u.id::text AS id,
        u.telegram_id::text AS telegram_id,
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        u.email_verified,
        u.auth_type,
        u.status,
        u.is_banned,
        u.ban_reason,
        u.ban_type,
        u.created_at,
        u.last_seen_at,
        COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'paid'), 0)::text AS total_paid,
        COUNT(p.id) FILTER (WHERE p.status = 'paid')::text AS payments_count,
        s.status AS subscription_status,
        s.end_date AS subscription_end,
        -- v68: lifetime stats. Scalar subqueries to keep the GROUP BY trivial
        -- and avoid double-counting via the existing payments LEFT JOIN.
        -- total_lifetime_days = SUM of every subscription's duration in days
        -- (rounded). Includes paid + bonus + referral + promo extensions
        -- because all of those mutate end_date in place.
        COALESCE((
          SELECT ROUND(SUM(EXTRACT(EPOCH FROM (s2.end_date - s2.start_date)) / 86400))::int
          FROM subscriptions s2
          WHERE s2.user_id = u.id
        ), 0) AS total_lifetime_days,
        COALESCE((
          SELECT COUNT(*)::int
          FROM device_sessions ds
          WHERE ds.user_id = u.id
            AND ds.kicked_at IS NULL
        ), 0) AS device_count,
        -- 2026-06-13 (partner view): referral identity + reach + balance.
        u.referral_code AS referral_code,
        COALESCE(u.referral_balance_rub, 0)::text AS referral_balance_rub,
        COALESCE((
          SELECT COUNT(*)::int
          FROM users inv
          WHERE inv.referred_by_user_id = u.id
        ), 0)::text AS referred_count
      FROM users u
      LEFT JOIN payments p ON p.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT status, end_date
        FROM subscriptions
        WHERE user_id = u.id
        ORDER BY end_date DESC NULLS LAST
        LIMIT 1
      ) s ON TRUE
      ${whereClause}
      GROUP BY u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.email, u.email_verified, u.auth_type, u.status, u.is_banned, u.ban_reason, u.ban_type, u.created_at, u.last_seen_at, s.status, s.end_date, u.referral_code, u.referral_balance_rub
      ${orderClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
      `,
      [...params, limit, offset]
    );

    // Flag managed partners (and their negotiated cash rate) so the admin UI
    // can highlight them and show the right percent.
    const users = result.rows.map((u) => {
      const idNum = Number(u.id);
      const partner = isReferralPartner(idNum);
      return {
        ...u,
        is_partner: partner,
        partner_cash_percent: partner ? referralCashPercentForInviter(idNum) : undefined,
        is_site_referral_inviter: isSiteReferralInviter(idNum),
      };
    });

    return NextResponse.json({
      ok: true,
      users,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Admin users error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
