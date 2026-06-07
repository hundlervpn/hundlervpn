import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, requestId } = body;
    if (!telegramId || !requestId) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const pool = getDbPool();
    const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1 LIMIT 1', [telegramId]);
    const user = userRes.rows[0];
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const reqRes = await pool.query(
      `SELECT id, amount, currency, status, service_name FROM service_requests 
       WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [requestId, user.id]
    );
    const serviceReq = reqRes.rows[0];
    if (!serviceReq) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (serviceReq.status !== 'awaiting_payment') {
      return NextResponse.json({ error: 'Request is not awaiting payment' }, { status: 400 });
    }
    if (!serviceReq.amount || Number(serviceReq.amount) <= 0) {
      return NextResponse.json({ error: 'No amount set' }, { status: 400 });
    }

    const appUrl = process.env.APP_URL || 'https://hundlervpn.xyz';
    const oxapayKey = process.env.OXAPAY_API_KEY;
    if (!oxapayKey) return NextResponse.json({ error: 'Payment not configured' }, { status: 500 });

    const paymentRes = await pool.query(
      `INSERT INTO payments (user_id, amount, currency, status, provider, metadata)
       VALUES ($1, $2, $3, 'pending', 'oxapay', $4) RETURNING id`,
      [user.id, serviceReq.amount, serviceReq.currency || 'RUB', JSON.stringify({ service_request_id: serviceReq.id, service_name: serviceReq.service_name })]
    );
    const paymentId = paymentRes.rows[0].id;

    await pool.query(
      'UPDATE service_requests SET payment_id = $1 WHERE id = $2',
      [paymentId, serviceReq.id]
    );

    const oxapayPayload = {
      amount: Number(serviceReq.amount),
      currency: serviceReq.currency || 'RUB',
      lifetime: 30,
      callback_url: `${appUrl}/api/services/pay/callback`,
      return_url: `${appUrl}?service_payment=success&requestId=${serviceReq.id}`,
      order_id: `svc_${serviceReq.id}_${paymentId}`,
      description: `Payment for: ${serviceReq.service_name}`,
    };

    console.log('OxaPay service request payload:', oxapayPayload);

    const oxaRes = await fetch('https://api.oxapay.com/v1/payment/invoice', {
      method: 'POST',
      headers: {
        'merchant_api_key': oxapayKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(oxapayPayload),
    });

    const oxaData = await oxaRes.json();
    console.log('OxaPay service response:', oxaData);

    if (oxaData.status !== 200 || !oxaData.data?.payment_url) {
      await pool.query(
        `UPDATE payments SET status = 'failed', metadata = metadata || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ oxapay_error: oxaData }), paymentId]
      );
      return NextResponse.json({ error: 'Payment creation failed' }, { status: 500 });
    }

    await pool.query(
      `UPDATE payments SET external_payment_id = $1 WHERE id = $2`,
      [oxaData.data.track_id, paymentId]
    );

    return NextResponse.json({ ok: true, paymentUrl: oxaData.data.payment_url });
  } catch (error) {
    console.error('Service pay error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
