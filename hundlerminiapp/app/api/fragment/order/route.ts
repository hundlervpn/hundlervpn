import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { createSbpTransaction } from '@/lib/platega';

const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, productType, period, starsAmount, telegramUsername } = body;

    if (!telegramId) {
      return NextResponse.json({ error: 'telegramId required' }, { status: 400 });
    }

    if (!productType || !['stars', 'premium'].includes(productType)) {
      return NextResponse.json({ error: 'Invalid product type' }, { status: 400 });
    }

    if (!period) {
      return NextResponse.json({ error: 'Period required' }, { status: 400 });
    }

    const pool = getDbPool();

    // Find user
    const userResult = await pool.query<{ id: number; username: string | null }>(
      'SELECT id, username FROM users WHERE telegram_id = $1 LIMIT 1',
      [telegramId]
    );

    const dbUser = userResult.rows[0];
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get price
    const priceResult = await pool.query<{ price_rub: string; stars_amount: number | null }>(
      `SELECT price_rub, stars_amount FROM fragment_prices 
       WHERE product_type = $1 AND period = $2 AND is_active = true LIMIT 1`,
      [productType, period]
    );

    if (priceResult.rows.length === 0) {
      return NextResponse.json({ error: 'Price not found for this product' }, { status: 404 });
    }

    const priceRub = parseFloat(priceResult.rows[0].price_rub);
    // Authoritative stars amount comes from the DB row matched by `period`,
    // NOT from `body.starsAmount` — the UI keeps a stale default that does
    // not track period selection, so the client value would mislabel orders
    // (e.g. "100 stars" at the 1000-stars price). Daria's order #11 was a
    // real instance of this. Using the DB value also closes a paid-less
    // exploit (mismatch client stars + paid price).
    const dbStarsAmount = priceResult.rows[0].stars_amount;
    const actualStarsAmount = productType === 'stars' ? dbStarsAmount : null;

    // Validate stars amount for stars product
    if (productType === 'stars' && (actualStarsAmount === null || actualStarsAmount === undefined)) {
      return NextResponse.json({ error: 'Stars amount not configured for this period' }, { status: 400 });
    }

    // Create payment record
    const paymentResult = await pool.query<{ id: number }>(
      `INSERT INTO payments (user_id, amount, currency, status, provider, metadata)
       VALUES ($1, $2, 'RUB', 'pending', 'platega_sbp', $3::jsonb)
       RETURNING id`,
      [
        dbUser.id,
        priceRub,
        JSON.stringify({
          type: 'fragment_order',
          productType,
          period,
          starsAmount: actualStarsAmount,
          telegramUsername: telegramUsername || dbUser.username,
        }),
      ]
    );
    const paymentId = paymentResult.rows[0].id;

    // Create fragment order
    const orderResult = await pool.query<{ id: number }>(
      `INSERT INTO fragment_orders (user_id, payment_id, product_type, period, stars_amount, price_rub, telegram_username, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id`,
      [
        dbUser.id,
        paymentId,
        productType,
        period,
        actualStarsAmount,
        priceRub,
        telegramUsername || dbUser.username,
      ]
    );
    const orderId = orderResult.rows[0].id;

    // Update payment metadata with order id
    await pool.query(
      `UPDATE payments SET metadata = metadata || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ fragmentOrderId: orderId }), paymentId]
    );

    const appUrl = process.env.APP_URL || '';

    // Create SBP transaction
    const transaction = await createSbpTransaction({
      amount: priceRub,
      description: 'Оплата',
      returnUrl: `${appUrl}?fragment_payment=success&orderId=${orderId}`,
      failedUrl: `${appUrl}?fragment_payment=failed&orderId=${orderId}`,
      payload: JSON.stringify({ paymentId, orderId, userId: dbUser.id, type: 'fragment_order' }),
    });

    await pool.query(
      `UPDATE payments SET external_payment_id = $1 WHERE id = $2`,
      [transaction.transactionId, paymentId]
    );

    return NextResponse.json({
      ok: true,
      orderId,
      paymentId,
      transactionId: transaction.transactionId,
      redirect: transaction.redirect,
      expiresIn: transaction.expiresIn,
    });
  } catch (error) {
    console.error('Fragment order creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    );
  }
}

// Get orders for admin
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const telegramId = searchParams.get('telegramId');

    if (!telegramId || !ADMIN_TELEGRAM_IDS.includes(Number(telegramId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const pool = getDbPool();

    const result = await pool.query(`
      SELECT fo.*, u.telegram_id, u.username, u.first_name, p.status as payment_status
      FROM fragment_orders fo
      JOIN users u ON fo.user_id = u.id
      LEFT JOIN payments p ON fo.payment_id = p.id
      ORDER BY fo.created_at DESC
      LIMIT 100
    `);

    return NextResponse.json({ orders: result.rows });
  } catch (error) {
    console.error('Failed to fetch fragment orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
