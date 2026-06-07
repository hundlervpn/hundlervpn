import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { ensurePromoSchema } from '@/lib/promo-schema';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await ensurePromoSchema();

    const result = await dbQuery<{
      id: number;
      code: string;
      days: number;
      discount_percent: number | null;
      max_uses: number;
      used_count: number;
      is_active: boolean;
      created_at: string;
      expires_at: string | null;
    }>(
      `SELECT id, code, days, discount_percent, max_uses, used_count, is_active, created_at, expires_at
       FROM promo_codes
       WHERE deleted_at IS NULL
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
    const { telegramId, code, days, discountPercent, maxUses, expiresAt } = body as {
      telegramId?: number;
      code?: string;
      days?: number;
      discountPercent?: number;
      maxUses?: number;
      expiresAt?: string;
    };

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await ensurePromoSchema();

    if (!code || !code.trim()) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }

    const hasDays = days && Number.isFinite(days) && days >= 1;
    const hasDiscount = discountPercent && Number.isFinite(discountPercent) && discountPercent >= 1 && discountPercent <= 100;

    if (!hasDays && !hasDiscount) {
      return NextResponse.json({ error: 'days or discountPercent is required' }, { status: 400 });
    }

    const uses = maxUses && Number.isFinite(maxUses) && maxUses > 0 ? maxUses : 1;

    const adminUser = await dbQuery<{ id: number }>(
      'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1;',
      [telegramId]
    );
    const createdBy = adminUser.rows[0]?.id ?? null;

    // ON CONFLICT (code) — if a previous version of the promo was
    // soft-deleted we resurrect the row (clear deleted_at, refresh all
    // parameters, reset used_count and re-activate). If the existing
    // row is still active (deleted_at IS NULL) we reject as a duplicate.
    // 2026-05-13: keeps the FK target stable so old activations still
    // point at the same promo_id after the admin recreates a code.
    const normalizedCode = code.trim().toUpperCase();
    const result = await dbQuery<{ id: number; code: string; resurrected: boolean }>(
      `
      INSERT INTO promo_codes (code, days, discount_percent, max_uses, is_active, created_by, expires_at)
      VALUES ($1, $2, $3, $4, TRUE, $5, $6)
      ON CONFLICT (code) DO UPDATE
        SET days = EXCLUDED.days,
            discount_percent = EXCLUDED.discount_percent,
            max_uses = EXCLUDED.max_uses,
            is_active = TRUE,
            created_by = EXCLUDED.created_by,
            expires_at = EXCLUDED.expires_at,
            used_count = 0,
            deleted_at = NULL
        WHERE promo_codes.deleted_at IS NOT NULL
      RETURNING id, code, (xmax <> 0) AS resurrected;
      `,
      [
        normalizedCode,
        hasDays ? days : 0,
        hasDiscount ? discountPercent : null,
        uses,
        createdBy,
        expiresAt || null,
      ]
    );

    if (result.rows.length === 0) {
      // ON CONFLICT matched but WHERE deleted_at IS NOT NULL filtered it
      // out → the existing row is still active. Treat as duplicate.
      return NextResponse.json({ error: 'Promo code already exists' }, { status: 409 });
    }

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

    await ensurePromoSchema();

    if (!promoId) {
      return NextResponse.json({ error: 'promoId is required' }, { status: 400 });
    }

    const normalizedPromoId = Number(promoId);
    if (!Number.isFinite(normalizedPromoId) || normalizedPromoId < 1) {
      return NextResponse.json({ error: 'Invalid promoId' }, { status: 400 });
    }

    // 2026-05-13: soft delete instead of DROP. The previous hard DELETE
    // cascaded into `promo_code_uses` (FK is ON DELETE CASCADE) and wiped
    // out the entire activation history for the promo, which the owner
    // panel uses to see who applied which code. We now flip `is_active`
    // off and stamp `deleted_at` so the promo:
    //   • disappears from /api/admin/promos (filtered above);
    //   • cannot be applied (validate/applyPromoCode/payments filter it);
    //   • but stays in the row so /api/admin/promos/activations can keep
    //     joining `promo_code_uses → promo_codes` and the owner still
    //     sees who used the deleted code (with a "deleted" badge in UI).
    // Re-running the request is idempotent (deleted_at gets refreshed,
    // which is harmless).
    const result = await dbQuery<{ id: number }>(
      `
      UPDATE promo_codes
      SET is_active = FALSE,
          deleted_at = COALESCE(deleted_at, NOW())
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
