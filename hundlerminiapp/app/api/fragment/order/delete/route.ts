import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, orderId } = body;

    if (!telegramId || !ADMIN_TELEGRAM_IDS.includes(Number(telegramId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    const pool = getDbPool();

    await pool.query(`DELETE FROM fragment_orders WHERE id = $1`, [orderId]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete order:', error);
    return NextResponse.json(
      { error: 'Failed to delete order' },
      { status: 500 }
    );
  }
}
