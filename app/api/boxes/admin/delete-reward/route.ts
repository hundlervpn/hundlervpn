import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

type DeleteBody = {
  telegramId?: number;
  // rewardId is BIGSERIAL on Postgres, which `pg-node` returns as a STRING
  // by default (precision-safe — JS numbers can't represent every int64
  // value). The admin feed endpoint forwards that string straight through
  // to the client without coercion, so the delete request body arrives
  // here with a string in this field. Accept both shapes; the runtime
  // validation below normalises to a positive integer before the DELETE.
  rewardId?: number | string;
};

// POST /api/boxes/admin/delete-reward
// body: { telegramId, rewardId }
//
// Admin-only — wipe a single row from `box_rewards` (the audit log of
// every box open across all users). The reward must be referenced by
// `id`; the admin's telegramId is required for the auth gate (same
// shape as /api/boxes/admin/reset etc).
//
// IMPORTANT — scope and side-effects:
//   • Unlike the self-only reset/grant-super endpoints, this one lets
//     admins delete ANY user's reward history row. That's the whole
//     point — owner-facing AdminBoxesView lists every user's opens and
//     needs a per-row trash button to scrub mistakes / spam test data.
//   • Subscription hours already credited to the recipient stay
//     credited. The `applied_subscription_id` link in box_rewards is
//     purely a feed/audit label, not a source of truth for entitlements.
//   • Discount-coupon promo_codes issued via this open are NOT cancelled.
//     They sit in promo_codes with their own expires_at/max_uses; if the
//     admin also needs to invalidate the coupon, that's a separate
//     promo_codes UPDATE. We only purge the box_rewards row so it
//     disappears from the audit feed.
//   • box_user_state (current_streak, total_opens, last_opened_at, etc.)
//     is INTENTIONALLY left untouched. Deleting a history row mid-streak
//     should not also break the user's streak counter — that's a
//     separate concept managed by `/api/boxes/admin/reset`.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as DeleteBody;
    const telegramId = body.telegramId;

    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }

    // Normalise rewardId. The client may send it as either:
    //   • number  — JSON-parsed BIGSERIAL that fit in a safe integer
    //   • string  — pg's default representation, forwarded as-is by the
    //     admin feed endpoint
    // Either way, validate that it parses to a positive integer ≤ 2^53-1
    // (any larger and we shouldn't be touching it from JS land anyway —
    // box_rewards.id is BIGSERIAL but realistic row counts stay under
    // ~10^9 for years). Reject everything else with a clear 400.
    const rawRewardId = body.rewardId;
    const rewardIdStr = typeof rawRewardId === 'string' ? rawRewardId.trim() : String(rawRewardId ?? '');
    if (!rewardIdStr || !/^\d+$/.test(rewardIdStr)) {
      return NextResponse.json({ error: 'rewardId is required (positive integer)' }, { status: 400 });
    }
    const rewardIdNum = Number(rewardIdStr);
    if (!Number.isSafeInteger(rewardIdNum) || rewardIdNum <= 0) {
      return NextResponse.json({ error: 'rewardId is out of range' }, { status: 400 });
    }

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();
    const result = await pool.query<{ id: string; user_id: string }>(
      // Cast id/user_id to text in the RETURNING clause to keep them
      // serialisable as strings on the way back — same convention the
      // admin feed uses, so the deletion confirmation echoes the same
      // shape the client UI was rendering.
      'DELETE FROM box_rewards WHERE id = $1 RETURNING id::text AS id, user_id::text AS user_id;',
      [rewardIdNum],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      deletedId: result.rows[0].id,
      affectedUserId: result.rows[0].user_id,
    });
  } catch (error) {
    console.error('[api/boxes/admin/delete-reward] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
