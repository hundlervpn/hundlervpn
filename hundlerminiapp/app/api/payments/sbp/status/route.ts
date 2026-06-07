import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { getTransactionStatus } from '@/lib/platega';
import { confirmSbpPayment, notifySbpSuccessViaTelegram } from '@/lib/sbp-confirm';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const paymentId = url.searchParams.get('paymentId');

    if (!paymentId) {
      return NextResponse.json(
        { error: 'paymentId is required' },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    const result = await pool.query<{
      id: number;
      user_id: number;
      status: string;
      paid_at: Date | null;
      external_payment_id: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT id, user_id, status, paid_at, external_payment_id, metadata
       FROM payments WHERE id = $1 LIMIT 1`,
      [paymentId]
    );

    const payment = result.rows[0];
    if (!payment) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      );
    }

    // Self-heal path: if local row is still pending but Platega already
    // confirmed / canceled the transaction (for example because our callback
    // URL isn't configured in the Platega dashboard, or env signature was
    // mismatched), probe Platega directly and process the payment now.
    if (payment.status === 'pending' && payment.external_payment_id) {
      const isFragmentOrder =
        (payment.metadata as Record<string, unknown> | null)?.type ===
        'fragment_order';

      try {
        const remote = await getTransactionStatus(payment.external_payment_id);

        if (remote.status === 'CONFIRMED' && !isFragmentOrder) {
          const amountRub =
            typeof remote.paymentDetails?.amount === 'number'
              ? remote.paymentDetails.amount
              : 0;
          const outcome = await confirmSbpPayment(
            pool,
            {
              id: payment.id,
              user_id: payment.user_id,
              status: payment.status,
              metadata: payment.metadata,
            },
            payment.external_payment_id,
            amountRub
          );
          if (outcome.activated) {
            await notifySbpSuccessViaTelegram(pool, payment.user_id);
          }
          const fresh = await pool.query<{ status: string; paid_at: Date | null }>(
            `SELECT status, paid_at FROM payments WHERE id = $1 LIMIT 1`,
            [payment.id]
          );
          if (fresh.rows[0]) {
            return NextResponse.json({
              ok: true,
              status: fresh.rows[0].status,
              paidAt: fresh.rows[0].paid_at,
            });
          }
        } else if (
          remote.status === 'CANCELED' ||
          remote.status === 'CHARGEBACKED'
        ) {
          await pool.query(
            `UPDATE payments
             SET status = 'failed',
                 metadata = metadata || $1::jsonb
             WHERE id = $2`,
            [
              JSON.stringify({
                platega_transaction_id: payment.external_payment_id,
                platega_status: remote.status,
              }),
              payment.id,
            ]
          );
          return NextResponse.json({
            ok: true,
            status: 'failed',
            paidAt: null,
          });
        }
      } catch (probeErr) {
        console.error('SBP status: platega probe failed', probeErr);
      }
    }

    return NextResponse.json({
      ok: true,
      status: payment.status,
      paidAt: payment.paid_at,
    });
  } catch (error) {
    console.error('SBP status check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
