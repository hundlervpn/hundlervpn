import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { applyReferralCashReward } from '@/lib/referral-cash';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// One-shot backfill of the referral CASH wallet (2026-05-23).
//
// `applyReferralCashReward` was added on 2026-05-22 and is wired only into
// `lib/sbp-confirm.ts`. Every SBP payment processed BEFORE that date never
// hit the cash flow, so inviters whose friends paid in the past have empty
// wallets even though the day-bonus side credited them correctly.
//
// This endpoint walks every `payments` row that should have credited the
// inviter — `status='paid'`, `currency='RUB'`, invitee has a non-self
// `referred_by_user_id` — and re-runs `applyReferralCashReward` for it.
//
// Idempotency:
//   • The ledger table has a partial UNIQUE(payment_id) (created in the
//     2026-05-22 migration). `INSERT … ON CONFLICT DO NOTHING` short-
//     circuits any payment that already has a journal row, so this is
//     safe to run any number of times.
//   • For payments processed AFTER the cash flow was live, the journal
//     row already exists and we skip them — the wallet stays consistent.
//
// Owner / admin only. POST body:
//   { telegramId: number, dryRun?: boolean }
//
// Response:
//   { ok, scanned, credited, totalAmountRub, skipped }
//     scanned        — how many candidate payments we looked at
//     credited       — how many actually added a new ledger row + bumped
//                      a wallet on this run
//     totalAmountRub — sum of `amount_rub` across the credited rows
//     skipped        — scanned − credited (already-journaled or zero
//                      after rounding)
// ────────────────────────────────────────────────────────────────────────────

type Body = { telegramId?: number; dryRun?: boolean };

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const telegramId = body.telegramId;
    if (!telegramId || !Number.isFinite(telegramId) || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const dryRun = body.dryRun === true;

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      // Pull only candidate payments. Filter at SQL level so we don't
      // ship gigabytes of unrelated rows over the wire when the table
      // grows. ORDER BY id keeps the run deterministic across retries.
      const candidates = await client.query<{ id: number; user_id: number }>(
        `SELECT p.id, p.user_id
           FROM payments p
           JOIN users u ON u.id = p.user_id
          WHERE p.status = 'paid'
            AND p.currency = 'RUB'
            AND u.referred_by_user_id IS NOT NULL
            AND u.referred_by_user_id <> p.user_id
          ORDER BY p.id ASC;`
      );

      let credited = 0;
      let totalAmountRub = 0;

      // Dry-run path: only report what WOULD be backfilled — useful for
      // an admin to sanity-check before pulling the trigger.
      if (dryRun) {
        // Count payments without an existing journal row. We can do this
        // in a single SQL but the per-id loop matches the live path's
        // semantics exactly, so the numbers we report match what a real
        // run would produce.
        for (const row of candidates.rows) {
          const existing = await client.query<{ id: string }>(
            `SELECT id::text AS id
               FROM referral_balance_transactions
              WHERE payment_id = $1
              LIMIT 1;`,
            [row.id]
          );
          if (existing.rowCount === 0) {
            // Estimate amount the same way `applyReferralCashReward`
            // does: 10% of payment amount, rounded to 2 decimals.
            const amt = await client.query<{ amount: number }>(
              'SELECT amount::float8 AS amount FROM payments WHERE id = $1 LIMIT 1;',
              [row.id]
            );
            const paid = Number(amt.rows[0]?.amount ?? 0);
            const accrual = Math.round((paid * 10) / 100 * 100) / 100;
            if (accrual > 0) {
              credited += 1;
              totalAmountRub += accrual;
            }
          }
        }
        return NextResponse.json({
          ok: true,
          dryRun: true,
          scanned: candidates.rowCount ?? 0,
          credited,
          totalAmountRub: Math.round(totalAmountRub * 100) / 100,
          skipped: (candidates.rowCount ?? 0) - credited,
        });
      }

      // Real run — wrap in a single transaction so the wallet bumps and
      // ledger inserts are committed atomically. If anything fails mid-
      // way we'd rather no-op than leave the wallet partially synced.
      await client.query('BEGIN');
      try {
        for (const row of candidates.rows) {
          const result = await applyReferralCashReward(client, row.user_id, row.id);
          if (result.credited) {
            credited += 1;
            totalAmountRub += result.amountRub;
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }

      return NextResponse.json({
        ok: true,
        dryRun: false,
        scanned: candidates.rowCount ?? 0,
        credited,
        totalAmountRub: Math.round(totalAmountRub * 100) / 100,
        skipped: (candidates.rowCount ?? 0) - credited,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[backfill-referral-cash] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
