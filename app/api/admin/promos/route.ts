import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await dbQuery<{
      id: number;
      code: string;
      days: number;
      max_uses: number;
      used_count: number;
      is_active: boolean;
      created_at: string;
      expires_at: string | null;
    }>(
      `SELECT id, code, days, max_uses, used_count, is_active, created_at, expires_at
       FROM promo_codes
       ORDER BY created_at DESC;`
    );

    return NextResponse.json({ ok: true, promos: result.rows });
  } catch (error) {
    console.error('Admin promos error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, code, days, maxUses, expiresAt } = body as {
      telegramId?: number;
      code?: string;
      days?: number;
      maxUses?: number;
      expiresAt?: string;
    };

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!code || !code.trim()) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }

    if (!days || !Number.isFinite(days) || days < 1) {
      return NextResponse.json({ error: 'days must be a positive integer' }, { status: 400 });
    }

    const uses = maxUses && Number.isFinite(maxUses) && maxUses > 0 ? maxUses : 1;

    const adminUser = await dbQuery<{ id: number }>(
      'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1;',
      [telegramId]
    );
    const createdBy = adminUser.rows[0]?.id ?? null;

    const result = await dbQuery<{ id: number; code: string }>(
      `INSERT INTO promo_codes (code, days, max_uses, is_active, created_by, expires_at)
       VALUES ($1, $2, $3, TRUE, $4, $5)
       RETURNING id, code;`,
      [
        code.trim().toUpperCase(),
        days,
        uses,
        createdBy,
        expiresAt || null,
      ]
    );

    return NextResponse.json({ ok: true, promo: result.rows[0] });
  } catch (error: any) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Promo code already exists' }, { status: 409 });
    }
    console.error('Admin create promo error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    const promoId = url.searchParams.get('promoId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!promoId) {
      return NextResponse.json({ error: 'promoId is required' }, { status: 400 });
    }

    const normalizedPromoId = Number(promoId);
    if (!Number.isFinite(normalizedPromoId) || normalizedPromoId < 1) {
      return NextResponse.json({ error: 'Invalid promoId' }, { status: 400 });
    }

    const result = await dbQuery<{ id: number }>(
      `
      DELETE FROM promo_codes
      WHERE id = $1
      RETURNING id;
      `,
      [normalizedPromoId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Promo code not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deletedPromoId: result.rows[0].id });
  } catch (error) {
    console.error('Admin delete promo error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
