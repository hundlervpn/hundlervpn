import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code')?.trim().toUpperCase();

    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }

    const result = await dbQuery<{
      id: number;
      code: string;
      days: number;
      discount_percent: number | null;
      max_uses: number;
      used_count: number;
    }>(
      `SELECT id, code, days, discount_percent, max_uses, used_count
       FROM promo_codes
       WHERE code = $1
         AND is_active = TRUE
         AND used_count < max_uses
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [code]
    );

    if (!result.rows[0]) {
      return NextResponse.json(
        { error: 'Промокод недействителен или исчерпан' },
        { status: 404 }
      );
    }

    const promo = result.rows[0];
    return NextResponse.json({
      ok: true,
      promoId: promo.id,
      code: promo.code,
      days: promo.days || 0,
      discountPercent: promo.discount_percent || 0,
    });
  } catch (error) {
    console.error('Promo validate error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
