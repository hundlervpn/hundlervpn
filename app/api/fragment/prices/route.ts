import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

export async function GET() {
  try {
    const pool = getDbPool();
    
    const result = await pool.query(`
      SELECT id, product_type, period, stars_amount, price_rub, is_active
      FROM fragment_prices
      WHERE is_active = true
      ORDER BY product_type, 
        CASE period 
          WHEN '3 months' THEN 1 
          WHEN '6 months' THEN 2 
          WHEN '12 months' THEN 3 
          WHEN '100 stars' THEN 1
          WHEN '500 stars' THEN 2
          WHEN '1000 stars' THEN 3
          ELSE 4 
        END
    `);

    return NextResponse.json({ prices: result.rows });
  } catch (error) {
    console.error('Failed to fetch fragment prices:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prices' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, prices } = body;

    // Admin check
    const ADMIN_IDS = [2029065770, 1483598839];
    if (!telegramId || !ADMIN_IDS.includes(Number(telegramId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!Array.isArray(prices)) {
      return NextResponse.json({ error: 'prices array required' }, { status: 400 });
    }

    const pool = getDbPool();

    for (const price of prices) {
      const { product_type, period, stars_amount, price_rub, is_active } = price;
      
      await pool.query(`
        INSERT INTO fragment_prices (product_type, period, stars_amount, price_rub, is_active)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (product_type, period) 
        DO UPDATE SET 
          stars_amount = EXCLUDED.stars_amount,
          price_rub = EXCLUDED.price_rub,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
      `, [product_type, period, stars_amount || null, price_rub, is_active ?? true]);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to update fragment prices:', error);
    return NextResponse.json(
      { error: 'Failed to update prices' },
      { status: 500 }
    );
  }
}
