import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

/**
 * GET /api/admin/referrals?telegramId=<admin_tg_id>
 *
 * Returns the full inviter→invitee map for the admin "Рефералы" tab.
 *
 * Response shape (v2, 2026-05-17):
 *   - `totals`      — global KPI counters.
 *   - `categoryCounts` — number of inviters per category (whale / active /
 *                        neutral / suspicious / abuser). Drives the
 *                        filter-tab badges in the UI.
 *   - `inviters[]`  — aggregated per-inviter rows with engagement metrics
 *                     (paidInviteeCount, deviceInviteeCount,
 *                     subInviterCount), `category` enum and `signals[]` of
 *                     abuse flags. Pre-sorted by category priority then
 *                     totalBonus DESC.
 *   - `pairs[]`     — flat (inviter, invitee) list with per-invitee
 *                     engagement (paidCount, paidAmount, deviceCount,
 *                     subInviteeCount). Already grouped into
 *                     `inviter.invitees[]`; kept top-level for backwards
 *                     compatibility with any external dashboards.
 *
 * Joins: users ← users (referred_by_user_id) plus four LATERAL subselects
 * for the engagement metrics, kept on the server side so the dataset
 * sent to the admin client stays compact. Single query, indexed lookups,
 * fine up to ~10k pairs.
 *
 * Self-loops (referred_by_user_id = id) are filtered out defensively.
 * The /api/users/sync guard added 2026-05-09 prevents new self-loops, but
 * legacy rows from before that may still exist on prod (already cleaned
 * via scripts/fix-self-referral-1388.js, but the filter is cheap).
 */

type PairRow = {
  inviter_id: string;
  inviter_telegram_id: string | null;
  inviter_username: string | null;
  inviter_first_name: string | null;
  invitee_id: string;
  invitee_telegram_id: string | null;
  invitee_username: string | null;
  invitee_first_name: string | null;
  invitee_auth_type: string;
  invitee_created_at: string;
  signup_bonus: string;
  payment_bonus: string;
  payment_count: string;
  total_bonus: string;
  invitee_paid_count: string;
  invitee_paid_amount_rub: string;
  invitee_device_count: string;
  invitee_sub_invitee_count: string;
  invitee_last_seen_at: string | null;
};

type InviterCategory = 'whale' | 'active' | 'neutral' | 'suspicious' | 'abuser';

// Order matters: badges in the UI follow this priority. Worse-class
// inviters are listed first inside the "all" tab so the admin sees the
// abuse cases without scrolling. Sort key is `CATEGORY_ORDER[category]`.
const CATEGORY_ORDER: Record<InviterCategory, number> = {
  abuser: 0,
  suspicious: 1,
  whale: 2,
  active: 3,
  neutral: 4,
};

type Signal =
  | 'no_devices'        // 100% of invitees have no active device session
  | 'no_payments'       // 100% of invitees never paid
  | 'dead_end'          // none of the invitees invited anyone themselves
  | 'burst'             // ≥3 invitees registered within a 1-hour window
  | 'all_same_authtype' // ≥5 invitees and all share the same auth_type (mass-bot signal)
  | 'never_seen';       // ≥5 invitees and zero device sessions across all of them

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await dbQuery<PairRow>(
      `
      SELECT
        inviter.id::text                AS inviter_id,
        inviter.telegram_id::text       AS inviter_telegram_id,
        inviter.username                AS inviter_username,
        inviter.first_name              AS inviter_first_name,
        invitee.id::text                AS invitee_id,
        invitee.telegram_id::text       AS invitee_telegram_id,
        invitee.username                AS invitee_username,
        invitee.first_name              AS invitee_first_name,
        invitee.auth_type               AS invitee_auth_type,
        invitee.created_at::text        AS invitee_created_at,
        COALESCE(rbt_agg.signup_bonus,  0)::text AS signup_bonus,
        COALESCE(rbt_agg.payment_bonus, 0)::text AS payment_bonus,
        COALESCE(rbt_agg.payment_count, 0)::text AS payment_count,
        COALESCE(rbt_agg.total_bonus,   0)::text AS total_bonus,
        -- Engagement metrics for the invitee. We compute these inline so the
        -- admin client stays a single round-trip. All indexed lookups.
        COALESCE(pay.paid_count, 0)::text                        AS invitee_paid_count,
        COALESCE(pay.paid_amount_rub, 0)::text                   AS invitee_paid_amount_rub,
        COALESCE(dev.device_count, 0)::text                      AS invitee_device_count,
        COALESCE(sub_inv.cnt, 0)::text                           AS invitee_sub_invitee_count,
        dev.last_seen_at::text                                   AS invitee_last_seen_at
      FROM users invitee
      JOIN users inviter ON inviter.id = invitee.referred_by_user_id
      LEFT JOIN LATERAL (
        SELECT
          SUM(CASE WHEN rbt.bonus_type = 'signup'
                   THEN rbt.bonus_days ELSE 0 END)                AS signup_bonus,
          SUM(CASE WHEN rbt.bonus_type IN ('payment', 'first_payment')
                   THEN rbt.bonus_days ELSE 0 END)                AS payment_bonus,
          COUNT(*) FILTER (WHERE rbt.bonus_type IN ('payment', 'first_payment'))
                                                                  AS payment_count,
          SUM(rbt.bonus_days)                                     AS total_bonus
        FROM referral_bonus_transactions rbt
        WHERE rbt.invitee_user_id = invitee.id
          AND rbt.inviter_user_id = inviter.id
      ) rbt_agg ON TRUE
      LEFT JOIN LATERAL (
        -- Did the invitee ever pay for themselves? RUB-only amount; mixed
        -- currencies (Stars/CryptoBot in TON/USDT) are excluded from the
        -- monetary sum but still counted in paid_count. Goal of the field
        -- is heuristics, not exact bookkeeping.
        SELECT
          COUNT(*)                                                AS paid_count,
          SUM(CASE WHEN p.currency = 'RUB' THEN p.amount ELSE 0 END)
                                                                  AS paid_amount_rub
        FROM payments p
        WHERE p.user_id = invitee.id
          AND p.status = 'paid'
      ) pay ON TRUE
      LEFT JOIN LATERAL (
        -- Active device sessions (kicked_at IS NULL). Mirrors how the user
        -- UI counts devices in /api/users/devices. Last-seen helps spot
        -- registered-but-never-connected accounts (a key abuse signal).
        SELECT
          COUNT(*)                                                AS device_count,
          MAX(ds.last_seen_at)                                    AS last_seen_at
        FROM device_sessions ds
        WHERE ds.user_id = invitee.id
          AND ds.kicked_at IS NULL
      ) dev ON TRUE
      LEFT JOIN LATERAL (
        -- How many people did THIS invitee invite themselves? Two-level
        -- visibility makes it obvious which referrals are pulling their
        -- own weight vs. dead-end signups farmed for the welcome bonus.
        SELECT COUNT(*) AS cnt
        FROM users u2
        WHERE u2.referred_by_user_id = invitee.id
          AND u2.id <> invitee.id
      ) sub_inv ON TRUE
      WHERE invitee.referred_by_user_id IS NOT NULL
        AND invitee.referred_by_user_id <> invitee.id
      ORDER BY inviter.id, invitee.created_at DESC
      LIMIT 5000;
      `
    );

    type Pair = {
      inviterId: string;
      inviterTelegramId: string | null;
      inviterUsername: string | null;
      inviterFirstName: string | null;
      inviteeId: string;
      inviteeTelegramId: string | null;
      inviteeUsername: string | null;
      inviteeFirstName: string | null;
      inviteeAuthType: string;
      invitedAt: string;
      signupBonus: number;
      paymentBonus: number;
      paymentCount: number;
      totalBonus: number;
      // Engagement metrics for the invitee themselves — used by both the
      // inviter-level classification (“do their friends actually use the
      // service?”) and the drill-down UI.
      inviteePaidCount: number;
      inviteePaidAmountRub: number;
      inviteeDeviceCount: number;
      inviteeSubInviteeCount: number;
      inviteeLastSeenAt: string | null;
    };

    const pairs: Pair[] = result.rows.map((row) => ({
      inviterId: row.inviter_id,
      inviterTelegramId: row.inviter_telegram_id,
      inviterUsername: row.inviter_username,
      inviterFirstName: row.inviter_first_name,
      inviteeId: row.invitee_id,
      inviteeTelegramId: row.invitee_telegram_id,
      inviteeUsername: row.invitee_username,
      inviteeFirstName: row.invitee_first_name,
      inviteeAuthType: row.invitee_auth_type,
      invitedAt: row.invitee_created_at,
      signupBonus: Number(row.signup_bonus) || 0,
      paymentBonus: Number(row.payment_bonus) || 0,
      paymentCount: Number(row.payment_count) || 0,
      totalBonus: Number(row.total_bonus) || 0,
      inviteePaidCount: Number(row.invitee_paid_count) || 0,
      inviteePaidAmountRub: Number(row.invitee_paid_amount_rub) || 0,
      inviteeDeviceCount: Number(row.invitee_device_count) || 0,
      inviteeSubInviteeCount: Number(row.invitee_sub_invitee_count) || 0,
      inviteeLastSeenAt: row.invitee_last_seen_at,
    }));

    // Aggregate per-inviter for the main list view + run the engagement
    // metrics through the classifier. One pass over `pairs`.
    type InviterAgg = {
      inviterId: string;
      inviterTelegramId: string | null;
      inviterUsername: string | null;
      inviterFirstName: string | null;
      inviteeCount: number;
      paymentCount: number;
      signupBonus: number;
      paymentBonus: number;
      totalBonus: number;
      // v2 (2026-05-17): aggregated invitee engagement so the admin can see
      // at a glance whether this inviter is bringing real users or farming
      // signups. All counts are over the inviter's invitees:
      //   - paidInviteeCount  : invitees who ever paid (status='paid')
      //   - deviceInviteeCount: invitees with ≥1 active device session
      //   - subInviterCount   : invitees who themselves invited ≥1 user
      //   - paidAmountRub     : sum of RUB paid by invitees
      paidInviteeCount: number;
      deviceInviteeCount: number;
      subInviterCount: number;
      paidAmountRub: number;
      category: InviterCategory;
      signals: Signal[];
      invitees: Pair[];
    };
    const byInviter = new Map<string, InviterAgg>();
    for (const p of pairs) {
      const cur = byInviter.get(p.inviterId);
      if (cur) {
        cur.inviteeCount += 1;
        cur.paymentCount += p.paymentCount;
        cur.signupBonus += p.signupBonus;
        cur.paymentBonus += p.paymentBonus;
        cur.totalBonus += p.totalBonus;
        if (p.inviteePaidCount > 0) cur.paidInviteeCount += 1;
        if (p.inviteeDeviceCount > 0) cur.deviceInviteeCount += 1;
        if (p.inviteeSubInviteeCount > 0) cur.subInviterCount += 1;
        cur.paidAmountRub += p.inviteePaidAmountRub;
        cur.invitees.push(p);
      } else {
        byInviter.set(p.inviterId, {
          inviterId: p.inviterId,
          inviterTelegramId: p.inviterTelegramId,
          inviterUsername: p.inviterUsername,
          inviterFirstName: p.inviterFirstName,
          inviteeCount: 1,
          paymentCount: p.paymentCount,
          signupBonus: p.signupBonus,
          paymentBonus: p.paymentBonus,
          totalBonus: p.totalBonus,
          paidInviteeCount: p.inviteePaidCount > 0 ? 1 : 0,
          deviceInviteeCount: p.inviteeDeviceCount > 0 ? 1 : 0,
          subInviterCount: p.inviteeSubInviteeCount > 0 ? 1 : 0,
          paidAmountRub: p.inviteePaidAmountRub,
          category: 'neutral', // placeholder, filled below
          signals: [],
          invitees: [p],
        });
      }
    }

    // Classify each inviter + collect abuse signals.
    //
    // Categories (priority top → bottom, first match wins):
    //   abuser     : ≥5 invitees AND 0 ever paid AND 0 have active devices
    //                AND 0 brought other users themselves. Pure signup
    //                farm. The user is gaming the welcome bonus.
    //   suspicious : ≥5 invitees AND 0 ever paid AND device coverage <50%.
    //                Soft signal — might be a friend group that hasn't
    //                gotten around to paying yet, but worth a closer look.
    //   whale      : ≥3 invitees that have paid OR paidAmountRub ≥ 500₽.
    //                Real value inviter, treat well.
    //   active     : paidInviteeCount ≥1 OR subInviterCount ≥1 — at least
    //                one invitee converted into a real user.
    //   neutral    : everything else. Usually 1–2 friends who haven't
    //                triggered any of the above yet.
    //
    // Signals are independent flags that the UI shows as small badges; one
    // inviter can have multiple.
    for (const inv of byInviter.values()) {
      const e = inv.inviteeCount;
      const paid = inv.paidInviteeCount;
      const dev = inv.deviceInviteeCount;
      const sub = inv.subInviterCount;
      const paidRub = inv.paidAmountRub;

      // Burst detection: are ≥3 invitees registered within any 60-minute
      // window? Cheap O(n log n) sort + sliding pointer.
      let burst = false;
      if (e >= 3) {
        const times = inv.invitees
          .map((p) => new Date(p.invitedAt).getTime())
          .filter((t) => Number.isFinite(t))
          .sort((a, b) => a - b);
        const WINDOW_MS = 60 * 60 * 1000;
        let left = 0;
        for (let right = 0; right < times.length; right++) {
          while (times[right] - times[left] > WINDOW_MS) left++;
          if (right - left + 1 >= 3) { burst = true; break; }
        }
      }

      // Auth-type homogeneity: telegram-only signup farms register dozens
      // of accounts via the same channel — same auth_type. Real organic
      // referrals show a mix of telegram / email / google.
      let allSameAuth = false;
      if (e >= 5) {
        const first = inv.invitees[0]?.inviteeAuthType;
        allSameAuth = first !== undefined
          && inv.invitees.every((p) => p.inviteeAuthType === first);
      }

      const signals: Signal[] = [];
      if (e >= 3 && dev === 0) signals.push('no_devices');
      if (e >= 3 && paid === 0) signals.push('no_payments');
      if (e >= 3 && sub === 0) signals.push('dead_end');
      if (burst) signals.push('burst');
      if (allSameAuth) signals.push('all_same_authtype');
      if (e >= 5 && dev === 0) signals.push('never_seen');
      inv.signals = signals;

      let category: InviterCategory;
      if (e >= 5 && paid === 0 && dev === 0 && sub === 0) {
        category = 'abuser';
      } else if (e >= 5 && paid === 0 && dev / e < 0.5) {
        category = 'suspicious';
      } else if (paid >= 3 || paidRub >= 500) {
        category = 'whale';
      } else if (paid >= 1 || sub >= 1) {
        category = 'active';
      } else {
        category = 'neutral';
      }
      inv.category = category;
    }

    const inviters = Array.from(byInviter.values()).sort((a, b) => {
      // Worst-class first so the admin sees abuse cases without scrolling.
      const co = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
      if (co !== 0) return co;
      // Then by total bonus DESC.
      if (b.totalBonus !== a.totalBonus) return b.totalBonus - a.totalBonus;
      return b.inviteeCount - a.inviteeCount;
    });

    const totals = {
      totalPairs: pairs.length,
      totalInviters: inviters.length,
      totalDays: pairs.reduce((s, p) => s + p.totalBonus, 0),
      totalPayments: pairs.reduce((s, p) => s + p.paymentCount, 0),
      // Sum of RUB paid by EVERY invitee across the system (deduped via the
      // Map — each invitee row is unique because of the GROUP BY on the SQL
      // side, so we can just sum pairs[]).
      totalPaidRub: pairs.reduce((s, p) => s + p.inviteePaidAmountRub, 0),
      totalPaidInvitees: pairs.reduce(
        (s, p) => s + (p.inviteePaidCount > 0 ? 1 : 0),
        0,
      ),
      totalActiveDeviceInvitees: pairs.reduce(
        (s, p) => s + (p.inviteeDeviceCount > 0 ? 1 : 0),
        0,
      ),
    };

    const categoryCounts: Record<InviterCategory, number> = {
      whale: 0,
      active: 0,
      neutral: 0,
      suspicious: 0,
      abuser: 0,
    };
    for (const inv of inviters) categoryCounts[inv.category] += 1;

    return NextResponse.json({
      ok: true,
      totals,
      categoryCounts,
      inviters,
      pairs,
    });
  } catch (error) {
    console.error('admin/referrals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
