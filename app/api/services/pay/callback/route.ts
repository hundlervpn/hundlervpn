import { createHmac } from 'crypto';
import { getDbPool } from '@/lib/db';

function okResponse() {
  return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const body = JSON.parse(rawBody);

    const hmacHeader = req.headers.get('hmac') || req.headers.get('HMAC');
    const apiKey = process.env.OXAPAY_API_KEY;

    if (apiKey && hmacHeader) {
      const calculatedHmac = createHmac('sha512', apiKey).update(rawBody).digest('hex');
      if (calculatedHmac !== hmacHeader) {
        console.error('Service OxaPay callback: Invalid HMAC');
        return new Response('Invalid HMAC', { status: 401 });
      }
    }

    const status = body.status;
    const trackId = body.track_id;
    const orderId = body.order_id;

    console.log('Service OxaPay callback:', { status, trackId, orderId });

    if (!trackId || !status) return okResponse();

    const pool = getDbPool();

    const paymentRes = await pool.query(
      `SELECT id, user_id, status, metadata FROM payments WHERE external_payment_id = $1 LIMIT 1`,
      [trackId]
    );
    const payment = paymentRes.rows[0];
    if (!payment) return okResponse();
    if (payment.status === 'paid') return okResponse();

    const serviceRequestId = (payment.metadata as Record<string, unknown>)?.service_request_id;
    const statusLower = status.toLowerCase();

    if (statusLower === 'paid') {
      await pool.query(
        `UPDATE payments SET status = 'paid', paid_at = NOW(), metadata = metadata || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ oxapay_track_id: trackId, oxapay_status: status }), payment.id]
      );

      // NOTE: referral cash (10%) is intentionally NOT accrued here.
      // Paid services are not subscriptions, and per product decision
      // referral cash is credited ONLY for subscription payments.

      if (serviceRequestId) {
        await pool.query(
          `UPDATE service_requests SET status = 'paid' WHERE id = $1`,
          [serviceRequestId]
        );

        await pool.query(
          `INSERT INTO service_request_messages (request_id, sender_type, message)
           VALUES ($1, 'admin', $2)`,
          [serviceRequestId, 'Оплата получена. Заявка передана в обработку.']
        );
      }

      console.log(`Service payment confirmed: payment=${payment.id}, request=${serviceRequestId}`);
    } else if (['expired', 'underpaid', 'refunded', 'failed'].includes(statusLower)) {
      await pool.query(
        `UPDATE payments SET status = 'failed', metadata = metadata || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ oxapay_track_id: trackId, oxapay_status: status }), payment.id]
      );
    }

    return okResponse();
  } catch (error) {
    console.error('Service OxaPay callback error:', error);
    return new Response('Error', { status: 500 });
  }
}
