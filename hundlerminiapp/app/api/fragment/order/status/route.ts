import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, orderId, status } = body;

    if (!telegramId || !ADMIN_TELEGRAM_IDS.includes(Number(telegramId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!orderId || !status) {
      return NextResponse.json({ error: 'orderId and status required' }, { status: 400 });
    }

    const validStatuses = ['pending', 'paid', 'processing', 'completed', 'failed'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const pool = getDbPool();

    await pool.query(
      `UPDATE fragment_orders SET status = $1 WHERE id = $2`,
      [status, orderId]
    );

    // Notify user if completed
    if (status === 'completed') {
      const orderResult = await pool.query<{
        user_id: number;
        product_type: string;
        period: string;
        stars_amount: number | null;
      }>(
        `SELECT user_id, product_type, period, stars_amount FROM fragment_orders WHERE id = $1`,
        [orderId]
      );
      
      const order = orderResult.rows[0];
      if (order) {
        const userResult = await pool.query<{ telegram_id: number | null }>(
          'SELECT telegram_id FROM users WHERE id = $1',
          [order.user_id]
        );
        
        const telegramIdUser = userResult.rows[0]?.telegram_id;
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        
        if (botToken && telegramIdUser) {
          const productLabel = order.product_type === 'stars'
            ? `${order.stars_amount} Telegram Stars`
            : `Telegram Premium (${order.period.replace('_', ' ')})`;

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramIdUser,
              parse_mode: 'HTML',
              text: `🎉 <b>Ваш заказ выполнен!</b>\n\n${productLabel} успешно отправлен на ваш аккаунт.\n\nСпасибо за покупку!`,
            }),
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to update order status:', error);
    return NextResponse.json(
      { error: 'Failed to update status' },
      { status: 500 }
    );
  }
}
