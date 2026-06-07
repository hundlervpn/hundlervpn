import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

type CleanupBody = {
  telegramId?: number;
};

// POST /api/boxes/admin/cleanup-expired-coupons
// body: { telegramId }
//
// Admin-only — purge box-issued promo codes that already expired AND
// were never redeemed. The intent is freeing up the `promo_codes` table
// from clutter that the user-facing flows already treat as invalid
// (expired_at < NOW() blocks them at checkout, and the UI badges them
// "истёк"). This is a manual button, not a cron, so admins can review
// the count before/after in the AdminBoxesView feed.
//
// Filter rationale:
//   • code LIKE 'BOX%'           — touch ONLY box-issued promo codes,
//                                   never manually-created ones
//                                   (COUPON_CODE_PREFIX='BOX', see
//                                   lib/boxes.ts:35).
//   • expires_at < NOW()         — already expired.
//   • used_count = 0             — never redeemed by anyone. If a coupon
//                                   was used at least once, we keep it
//                                   so the promo_code_uses + box_rewards
//                                   audit trail stays consistent.
//
// Side-effects to be aware of:
//   • box_rewards.metadata.promoCodeId is JSON, NOT a foreign key. Rows
//     in box_rewards that referenced the deleted promo_code keep the
//     stale ID in their metadata; the LEFT JOIN in the admin feed will
//     simply produce NULLs for the joined columns. Display-side, the
//     code/discount we copy into metadata at issue time is still shown
//     (issue-time snapshot), and the badge falls back to "истёк" via
//     metadata.couponExpiresAt. So the admin feed is unaffected
//     visually, only the canonical promo_codes JOIN is missing.
//   • promo_code_uses has a FK to promo_codes (ON DELETE CASCADE in the
//     schema). Since we filter `used_count = 0`, there are no
//     promo_code_uses rows to cascade against — safe.
//
// Returns: { ok, deleted } — deleted is the count of rows wiped.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as CleanupBody;
    const telegramId = body.telegramId;

    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }
    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();
    const result = await pool.query<{ id: string }>(
      `DELETE FROM promo_codes
        WHERE code LIKE 'BOX%'
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
          AND used_count = 0
        RETURNING id::text AS id;`,
    );

    return NextResponse.json({
      ok: true,
      deleted: result.rowCount ?? 0,
    });
  } catch (error) {
    console.error('[api/boxes/admin/cleanup-expired-coupons] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
