import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

/**
 * GET /api/users/referrals?telegramId=N  (or &userId=N)
 *
 * Returns the list of users the caller has invited, together with the total
 * number of bonus days each invitee contributed. Powers the "who gave you
 * days" section in the referral modal on the home / profile screens.
 *
 * Join strategy:
 *   - Start from `users` rows where `referred_by_user_id = <caller>` — gives
 *     us every invitee, including those who haven't made a payment yet.
 *   - LEFT JOIN `referral_bonus_transactions` summed by invitee so invitees
 *     with no journaled bonus still show up (bonus_days = 0). That covers
 *     invitees who registered after the table existed but before any bonus
 *     event fired.
 *   - Order by most recently invited first, matching how the list feels in
 *     the UI (newest friends at the top).
 */

function resolveUserParams(url: URL) {
  const telegramIdRaw = url.searchParams.get('telegramId');
  const userIdRaw = url.searchParams.get('userId');
  if (!telegramIdRaw && !userIdRaw) return null;
  const telegramId = telegramIdRaw ? Number(telegramIdRaw) : null;
  const userId = userIdRaw ? Number(userIdRaw) : null;
  if ((telegramIdRaw && !Number.isFinite(telegramId)) || (userIdRaw && !Number.isFinite(userId))) return null;
  const whereClause = telegramId ? 'u.telegram_id = $1' : 'u.id = $1';
  const param = telegramId ?? userId;
  return { whereClause, param };
}

type ReferralRow = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  auth_type: string;
  created_at: string;
  // pg returns BIGINT/SUM as text to avoid JS number precision loss; we cast.
  signup_bonus: string;
  payment_bonus: string;
  payment_count: string;
  total_bonus: string;
  // 2026-05-22 (cash referral): how much RUB this invitee has paid in
  // total + how much of that was credited as 10% to the caller.
  paid_amount_rub: string;
  cash_earned_rub: string;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const resolved = resolveUserParams(url);
    if (!resolved) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    // Resolve the caller's internal users.id first. Using a subquery avoids a
    // second round-trip and keeps the aggregation query tight.
    const callerIdResult = await dbQuery<{ id: number }>(
      `SELECT u.id FROM users u WHERE ${resolved.whereClause} LIMIT 1;`,
      [resolved.param]
    );
    const callerId = callerIdResult.rows[0]?.id;
    if (!callerId) {
      // New telegram user that hasn't synced yet — no referrals possible.
      return NextResponse.json({ ok: true, referrals: [], totalDays: 0, totalPayments: 0 });
    }

    // Aggregate per-invitee:
    //   - `signup_bonus`: fixed +5 fired at registration (exactly one per pair).
    //   - `payment_bonus`: sum of EVERY recurring payment bonus (post-v2),
    //      PLUS the legacy one-shot 'first_payment' rows from v1 so the UI
    //      stays consistent for accounts that paid during the v1 window.
    //   - `payment_count`: distinct number of paid plans the invitee bought
    //      that actually triggered a bonus — powers the "M payments" copy
    //      in the referral modal.
    // Aggregate per-invitee. Each LATERAL block keeps the rows tight to
    // its own table — without it the GROUP BY would multiply rows across
    // payments × bonus_transactions × balance_transactions and double-
    // count totals.
    //
    // 2026-05-22 additions:
    //   • LEFT JOIN LATERAL pay — sum of RUB paid by this invitee (drives
    //     "оплатил X ₽" badge in the referral modal).
    //   • LEFT JOIN LATERAL cash — sum of 10% credited to the caller from
    //     this invitee's RUB payments (drives "+Y ₽ на баланс" sub-line).
    const result = await dbQuery<ReferralRow>(
      `
      SELECT
        invitee.id,
        invitee.first_name,
        invitee.last_name,
        invitee.username,
        invitee.photo_url,
        invitee.auth_type,
        invitee.created_at,
        COALESCE(rbt_agg.signup_bonus, 0)::text  AS signup_bonus,
        COALESCE(rbt_agg.payment_bonus, 0)::text AS payment_bonus,
        COALESCE(rbt_agg.payment_count, 0)::text AS payment_count,
        COALESCE(rbt_agg.total_bonus, 0)::text   AS total_bonus,
        COALESCE(pay.paid_amount_rub, 0)::text   AS paid_amount_rub,
        COALESCE(cash.cash_earned_rub, 0)::text  AS cash_earned_rub
      FROM users invitee
      LEFT JOIN LATERAL (
        SELECT
          SUM(CASE WHEN rbt.bonus_type = 'signup' THEN rbt.bonus_days ELSE 0 END)                    AS signup_bonus,
          SUM(CASE WHEN rbt.bonus_type IN ('payment', 'first_payment') THEN rbt.bonus_days ELSE 0 END) AS payment_bonus,
          COUNT(*) FILTER (WHERE rbt.bonus_type IN ('payment', 'first_payment'))                       AS payment_count,
          SUM(rbt.bonus_days)                                                                          AS total_bonus
        FROM referral_bonus_transactions rbt
        WHERE rbt.invitee_user_id = invitee.id
          AND rbt.inviter_user_id = $1
      ) rbt_agg ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(CASE WHEN p.currency = 'RUB' THEN p.amount ELSE 0 END) AS paid_amount_rub
        FROM payments p
        WHERE p.user_id = invitee.id
          AND p.status = 'paid'
      ) pay ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(rct.amount_rub) AS cash_earned_rub
        FROM referral_balance_transactions rct
        WHERE rct.invitee_user_id = invitee.id
          AND rct.inviter_user_id = $1
      ) cash ON TRUE
      WHERE invitee.referred_by_user_id = $1
        -- Defensive: filter out self-loops (referred_by_user_id = id) that
        -- pre-date the sync-route guard. Otherwise the inviter sees their
        -- own row in their invitee list. New rows can no longer create a
        -- self-loop (see /api/users/sync effectiveReferralCode), but
        -- legacy rows from before 2026-05-09 still exist.
        AND invitee.id <> $1
      ORDER BY invitee.created_at DESC
      LIMIT 200;
      `,
      [callerId]
    );

    const referrals = result.rows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      username: row.username,
      photoUrl: row.photo_url,
      authType: row.auth_type,
      invitedAt: row.created_at,
      signupBonus: Number(row.signup_bonus) || 0,
      paymentBonus: Number(row.payment_bonus) || 0,
      paymentCount: Number(row.payment_count) || 0,
      totalBonus: Number(row.total_bonus) || 0,
      paidAmountRub: Number(row.paid_amount_rub) || 0,
      cashEarnedRub: Number(row.cash_earned_rub) || 0,
    }));

    const totalDays = referrals.reduce((acc, r) => acc + r.totalBonus, 0);
    const totalPayments = referrals.reduce((acc, r) => acc + r.paymentCount, 0);
    const totalCashEarnedRub = referrals.reduce((acc, r) => acc + r.cashEarnedRub, 0);

    // Current spendable wallet (live, not historical sum — withdrawals
    // are debited from this column). cashEarnedRub above is the lifetime
    // gross credit; subtracting it from balance reveals how much has been
    // already withdrawn ⇒ the UI can show "earned/withdrawn/available".
    const balanceRes = await dbQuery<{ balance: string }>(
      'SELECT referral_balance_rub::text AS balance FROM users WHERE id = $1 LIMIT 1;',
      [callerId],
    );
    const referralBalanceRub = Number(balanceRes.rows[0]?.balance ?? 0);

    return NextResponse.json({
      ok: true,
      referrals,
      totalDays,
      totalPayments,
      totalCashEarnedRub,
      referralBalanceRub,
    });
  } catch (error) {
    console.error('Referrals fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
