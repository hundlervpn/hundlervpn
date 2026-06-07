import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// Dev-only endpoint to credit the calling admin's own referral wallet so
// the withdrawal flow can be tested end-to-end without inviting a real
// paying friend.
//
//   POST /api/admin/db/grant-test-balance
//   body: { telegramId, amountRub? = 500 }
//
// We deliberately DO NOT write a row to `referral_balance_transactions`
// here: that table has a CHECK (inviter_user_id <> invitee_user_id) so
// self-credits would violate it, and faking another invitee would
// pollute the analytics that the admin /referrals view runs against
// this ledger. The wallet column itself has no FK constraint to the
// ledger — they are loosely coupled by design — so a manual UPDATE
// keeps everything else honest while letting us exercise the
// withdrawal UI. The "lifetime earned" metric will be slightly lower
// than the wallet because of this, which is fine for test grants.
// ────────────────────────────────────────────────────────────────────────────

type Body = { telegramId?: number; amountRub?: number };

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const telegramId = body.telegramId;
    if (!telegramId || !Number.isFinite(telegramId) || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Cap test grants at 50 000 ₽ per call so a misclick can't blow up
    // the journal with absurd numbers. Default = 500 ₽ (matches the
    // production min withdrawal so the first click immediately unlocks
    // a real test request).
    const amount = Math.min(50000, Math.max(1, Math.round(Number(body.amountRub ?? 500) * 100) / 100));

    const pool = getDbPool();
    const result = await pool.query<{ balance: string }>(
      `UPDATE users
          SET referral_balance_rub = referral_balance_rub + $2::numeric
        WHERE telegram_id = $1
        RETURNING referral_balance_rub::text AS balance;`,
      [telegramId, amount],
    );
    if (!result.rows[0]) {
      return NextResponse.json({ error: 'Admin user not found in DB' }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      granted: amount,
      balanceRub: Number(result.rows[0].balance),
    });
  } catch (error) {
    console.error('[grant-test-balance] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
