import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { createSbpTransaction } from '@/lib/platega';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { months, amount, telegramId, userId } = body;

    if (!months || !amount) {
      return NextResponse.json(
        { error: 'months and amount are required' },
        { status: 400 }
      );
    }

    if (!telegramId && !userId) {
      return NextResponse.json(
        { error: 'telegramId or userId is required' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    const userQuery = telegramId
      ? 'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1'
      : 'SELECT id FROM users WHERE id = $1 LIMIT 1';
    const userResult = await pool.query<{ id: number }>(
      userQuery,
      [telegramId ?? userId]
    );

    const dbUserId = userResult.rows[0]?.id;
    if (!dbUserId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const paymentResult = await pool.query<{ id: number }>(
      `INSERT INTO payments (user_id, amount, currency, status, provider, metadata)
       VALUES ($1, $2, 'RUB', 'pending', 'platega_sbp', $3::jsonb)
       RETURNING id`,
      [
        dbUserId,
        amount,
        JSON.stringify({ months, telegramId: telegramId ?? null }),
      ]
    );
    const paymentId = paymentResult.rows[0].id;

    const appUrl = process.env.APP_URL || '';

    const transaction = await createSbpTransaction({
      amount,
      description: `Hundler VPN Premium ${months} мес.`,
      returnUrl: `${appUrl}?sbp_payment=success&paymentId=${paymentId}`,
      failedUrl: `${appUrl}?sbp_payment=failed&paymentId=${paymentId}`,
      payload: JSON.stringify({ paymentId, userId: dbUserId, months }),
    });

    await pool.query(
      `UPDATE payments SET external_payment_id = $1 WHERE id = $2`,
      [transaction.transactionId, paymentId]
    );

    return NextResponse.json({
      ok: true,
      paymentId,
      transactionId: transaction.transactionId,
      redirect: transaction.redirect,
      expiresIn: transaction.expiresIn,
    });
  } catch (error) {
    console.error('SBP payment create error:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}
