/**
 * Admin endpoint to manually recover a Platega SBP payment that was
 * confirmed on Platega's side but whose webhook callback failed (typically
 * 401 Unauthorized due to env-var drift).
 *
 * Reuses the EXACT same `confirmSbpPayment` flow the webhook uses, so the
 * resulting state is identical to a successful auto-callback.
 *
 * Auth: token shared with xray sync (XRAY_SYNC_TOKEN), passed as
 *   ?token=… query param, or as `x-xray-sync-token` header.
 *
 * Usage:
 *   POST /api/admin/payments/recover
 *     ?token=…
 *     ?payment_id=50           — internal payments.id
 *     ?transaction_id=…        — Platega transaction id (defaults to
 *                                payments.external_payment_id)
 *
 *   GET /api/admin/payments/recover?token=…&pending=1
 *     → list of pending Platega payments older than 5 minutes
 *
 *   GET /api/admin/payments/recover?token=…&payment_id=50
 *     → preview what would happen, no DB writes
 */

import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { getTransactionStatus } from '@/lib/platega';
import {
  confirmSbpPayment,
  notifySbpSuccessViaTelegram,
  type SbpPaymentRow,
} from '@/lib/sbp-confirm';

function authorized(req: Request): boolean {
  const url = new URL(req.url);
  const token =
    url.searchParams.get('token') || req.headers.get('x-xray-sync-token') || '';
  const expected = process.env.XRAY_SYNC_TOKEN;
  return !!expected && token === expected;
}

async function loadPayment(paymentId: number): Promise<SbpPaymentRow & {
  amount: string;
  external_payment_id: string | null;
  provider: string;
} | null> {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT id, user_id, status, metadata, amount::text, external_payment_id, provider
     FROM payments WHERE id = $1`,
    [paymentId],
  );
  return r.rows[0] ?? null;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);

  // List all pending Platega payments older than 5 min — these are the
  // candidates that may need recovery. With ?probe=1 also calls Platega API
  // for each and reports the canonical status, so we can tell at a glance
  // which payments are real (CONFIRMED but stuck) vs dead (CANCELED).
  if (url.searchParams.get('pending') === '1') {
    const pool = getDbPool();
    const r = await pool.query(
      `SELECT p.id, p.user_id, u.username, u.first_name, u.telegram_id,
              p.amount::text, p.status, p.provider, p.external_payment_id,
              p.created_at, p.metadata
       FROM payments p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.status = 'pending'
         AND p.provider IN ('platega_sbp', 'platega')
         AND p.created_at < NOW() - INTERVAL '5 minutes'
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );

    const probe = url.searchParams.get('probe') === '1';
    let payments: any[] = r.rows;
    if (probe) {
      payments = await Promise.all(
        r.rows.map(async (p: any) => {
          if (!p.external_payment_id) {
            return { ...p, platega_status: '(no_external_id)' };
          }
          try {
            const fresh = await getTransactionStatus(p.external_payment_id);
            return { ...p, platega_status: fresh.status };
          } catch (e) {
            return { ...p, platega_status: `(error: ${(e as Error).message.slice(0, 60)})` };
          }
        })
      );
    }

    return NextResponse.json({ ok: true, count: r.rows.length, payments });
  }

  const paymentId = parseInt(url.searchParams.get('payment_id') || '', 10);
  if (!paymentId) {
    return NextResponse.json({
      error: 'Missing payment_id (or use ?pending=1 to list candidates)',
    }, { status: 400 });
  }

  const p = await loadPayment(paymentId);
  if (!p) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  const meta = (p.metadata || {}) as Record<string, unknown>;
  return NextResponse.json({
    ok: true,
    preview: true,
    payment: {
      id: p.id,
      user_id: p.user_id,
      status: p.status,
      amount: p.amount,
      provider: p.provider,
      external_payment_id: p.external_payment_id,
      metadata_days: meta.days,
      metadata_months: meta.months,
    },
    would_activate_days:
      (typeof meta.days === 'number' && (meta.days as number) > 0 && meta.days as number) ||
      (typeof meta.months === 'number' && (meta.months as number) > 0 && (meta.months as number) * 30) ||
      30,
    note: 'POST to actually recover.',
  });
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const paymentId = parseInt(url.searchParams.get('payment_id') || '', 10);
  if (!paymentId) {
    return NextResponse.json({ error: 'Missing payment_id' }, { status: 400 });
  }
  const transactionIdOverride = url.searchParams.get('transaction_id');
  // ?force=1 skips the Platega status check (use only when API verification
  // is impossible, e.g. payment created without external_payment_id and you
  // have manually verified it via the Platega dashboard).
  const force = url.searchParams.get('force') === '1';

  try {
    const p = await loadPayment(paymentId);
    if (!p) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }
    if (p.status === 'paid') {
      return NextResponse.json({
        ok: true,
        already_paid: true,
        payment_id: paymentId,
      });
    }

    const transactionId = transactionIdOverride || p.external_payment_id || `manual-${paymentId}`;
    let amountRub = parseFloat(p.amount);

    // SAFETY CHECK: verify with Platega API that this transaction is
    // actually CONFIRMED before activating. Without this, an admin could
    // accidentally grant a subscription for a canceled/expired/never-paid
    // payment.
    if (!force && p.external_payment_id) {
      try {
        const fresh = await getTransactionStatus(p.external_payment_id);
        if (fresh.status !== 'CONFIRMED') {
          return NextResponse.json({
            ok: false,
            error: 'platega_not_confirmed',
            platega_status: fresh.status,
            payment_id: paymentId,
            transaction_id: p.external_payment_id,
            note: 'Refusing to activate — Platega does not show this as CONFIRMED. Use ?force=1 only if you are absolutely sure (e.g. verified manually in dashboard).',
          }, { status: 409 });
        }
        // Use Platega's amount as the source of truth.
        amountRub = fresh.paymentDetails?.amount ?? amountRub;
      } catch (apiErr) {
        return NextResponse.json({
          ok: false,
          error: 'platega_api_unreachable',
          message: (apiErr as Error).message,
          payment_id: paymentId,
          note: 'Could not verify with Platega API. Use ?force=1 if you have manually confirmed payment.',
        }, { status: 502 });
      }
    }

    const pool = getDbPool();
    const outcome = await confirmSbpPayment(
      pool,
      {
        id: p.id,
        user_id: p.user_id,
        status: p.status,
        metadata: p.metadata,
      },
      transactionId,
      amountRub,
    );

    if (outcome.activated) {
      // Best-effort Telegram notification (skips silently for email-only users).
      void notifySbpSuccessViaTelegram(pool, p.user_id).catch((e) => {
        console.warn('[admin/payments/recover] telegram notify failed:', e);
      });
    }

    return NextResponse.json({
      ok: true,
      activated: outcome.activated,
      payment_id: paymentId,
      transaction_id: transactionId,
      subscription_id: outcome.subscriptionId,
      end_date: outcome.endDate,
      days: outcome.days,
    });
  } catch (err) {
    console.error('[admin/payments/recover] error:', err);
    return NextResponse.json(
      { error: (err as Error).message ?? 'Internal error' },
      { status: 500 },
    );
  }
}
