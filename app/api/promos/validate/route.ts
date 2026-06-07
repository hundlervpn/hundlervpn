import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code')?.trim().toUpperCase();
    const telegramId = url.searchParams.get('telegramId');
    const userId = url.searchParams.get('userId');

    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }

    type PromoRow = {
      id: number;
      code: string;
      days: number;
      discount_percent: number | null;
      max_uses: number;
      used_count: number;
    };

    // 2026-05-13: try the soft-delete-aware query first; if the column
    // hasn't been migrated yet on this DB (Postgres error 42703), fall
    // back to the legacy filter so promo validation still works for
    // users right after deploy. The admin endpoints proactively run
    // `ensurePromoSchema` so this fallback is only hit during the first
    // few seconds before the migration races through.
    let result;
    try {
      result = await dbQuery<PromoRow>(
        `SELECT id, code, days, discount_percent, max_uses, used_count
         FROM promo_codes
         WHERE code = $1
           AND is_active = TRUE
           AND deleted_at IS NULL
           AND used_count < max_uses
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [code]
      );
    } catch (e: any) {
      if (e?.code !== '42703') throw e;
      result = await dbQuery<PromoRow>(
        `SELECT id, code, days, discount_percent, max_uses, used_count
         FROM promo_codes
         WHERE code = $1
           AND is_active = TRUE
           AND used_count < max_uses
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [code]
      );
    }

    if (!result.rows[0]) {
      return NextResponse.json(
        { error: 'Промокод недействителен или исчерпан' },
        { status: 404 }
      );
    }

    const promo = result.rows[0];

    // Проверяем использование промокода этим пользователем
    let dbUserId: number | null = null;
    if (telegramId) {
      const userRes = await dbQuery<{ id: number }>('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
      dbUserId = userRes.rows[0]?.id || null;
    } else if (userId) {
      dbUserId = parseInt(userId, 10);
    }

    if (dbUserId) {
      const usageRes = await dbQuery<{ id: number }>(
        'SELECT id FROM promo_code_uses WHERE promo_code_id = $1 AND user_id = $2 LIMIT 1',
        [promo.id, dbUserId]
      );
      if (usageRes.rows[0]) {
        return NextResponse.json(
          { error: 'Вы уже использовали этот промокод' },
          { status: 400 }
        );
      }
    }

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
