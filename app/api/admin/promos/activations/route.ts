import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { ensurePromoSchema } from '@/lib/promo-schema';

/**
 * GET /api/admin/promos/activations?telegramId=<adminId>&limit=&offset=&search=
 *
 * Returns the latest promo-code activations across all users so the admin
 * (currently the single owner account, see `lib/admin.ts`) can monitor who
 * used which promo and when.
 *
 * Data source: `promo_code_uses` — populated by:
 *   - `lib/access.ts::applyPromoCode` (free-days promos, applied instantly)
 *   - `app/api/payments/sbp/create/route.ts`     (discount promos on SBP)
 *   - `app/api/crypto-invoice/route.ts`          (discount promos on crypto)
 * so the table reflects every promo activation regardless of flow.
 *
 * Optional `search` matches either the promo code (uppercase, partial) or
 * the user's telegram_id / username / email / referral_code.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await ensurePromoSchema();

    const limitParam = Number(url.searchParams.get('limit') ?? 100);
    const offsetParam = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, Math.trunc(limitParam))) : 100;
    const offset = Number.isFinite(offsetParam) ? Math.max(0, Math.trunc(offsetParam)) : 0;
    const search = (url.searchParams.get('search') ?? '').trim();

    const params: unknown[] = [];
    let whereClause = '';
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      params.push(like, search);
      whereClause = `
        WHERE LOWER(pc.code) LIKE $1
           OR LOWER(COALESCE(u.username, '')) LIKE $1
           OR LOWER(COALESCE(u.email, '')) LIKE $1
           OR LOWER(COALESCE(u.referral_code, '')) LIKE $1
           OR LOWER(COALESCE(u.first_name, '')) LIKE $1
           OR LOWER(COALESCE(u.last_name, '')) LIKE $1
           OR CAST(COALESCE(u.telegram_id, 0) AS TEXT) = $2
      `;
    }

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(limit, offset);

    const rowsRes = await dbQuery<{
      activation_id: string;
      used_at: string;
      promo_id: string;
      promo_code: string;
      promo_days: number;
      promo_discount_percent: number | null;
      promo_deleted_at: string | null;
      user_id: string;
      telegram_id: string | null;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      referral_code: string | null;
      photo_url: string | null;
    }>(
      `
      SELECT
        pcu.id        AS activation_id,
        pcu.used_at   AS used_at,
        pc.id         AS promo_id,
        pc.code       AS promo_code,
        pc.days       AS promo_days,
        pc.discount_percent AS promo_discount_percent,
        pc.deleted_at AS promo_deleted_at,
        u.id          AS user_id,
        u.telegram_id AS telegram_id,
        u.username    AS username,
        u.first_name  AS first_name,
        u.last_name   AS last_name,
        u.email       AS email,
        u.referral_code AS referral_code,
        u.photo_url   AS photo_url
      FROM promo_code_uses pcu
      JOIN promo_codes pc ON pc.id = pcu.promo_code_id
      JOIN users u        ON u.id  = pcu.user_id
      ${whereClause}
      ORDER BY pcu.used_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
      `,
      params,
    );

    const countParams: unknown[] = [];
    let countWhere = '';
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      countParams.push(like, search);
      countWhere = `
        WHERE LOWER(pc.code) LIKE $1
           OR LOWER(COALESCE(u.username, '')) LIKE $1
           OR LOWER(COALESCE(u.email, '')) LIKE $1
           OR LOWER(COALESCE(u.referral_code, '')) LIKE $1
           OR LOWER(COALESCE(u.first_name, '')) LIKE $1
           OR LOWER(COALESCE(u.last_name, '')) LIKE $1
           OR CAST(COALESCE(u.telegram_id, 0) AS TEXT) = $2
      `;
    }

    const totalRes = await dbQuery<{ total: string }>(
      `
      SELECT COUNT(*)::bigint AS total
      FROM promo_code_uses pcu
      JOIN promo_codes pc ON pc.id = pcu.promo_code_id
      JOIN users u        ON u.id  = pcu.user_id
      ${countWhere};
      `,
      countParams,
    );

    const total = Number(totalRes.rows[0]?.total ?? 0);

    const activations = rowsRes.rows.map((row) => ({
      id: Number(row.activation_id),
      usedAt: row.used_at,
      promo: {
        id: Number(row.promo_id),
        code: row.promo_code,
        days: Number(row.promo_days),
        discountPercent: row.promo_discount_percent === null ? null : Number(row.promo_discount_percent),
        // When a promo is soft-deleted the row stays so the activation
        // still resolves, but the UI shows a "удалён" badge.
        deletedAt: row.promo_deleted_at,
      },
      user: {
        id: Number(row.user_id),
        telegramId: row.telegram_id ? Number(row.telegram_id) : null,
        username: row.username,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        referralCode: row.referral_code,
        photoUrl: row.photo_url,
      },
    }));

    return NextResponse.json({ ok: true, total, limit, offset, activations });
  } catch (error) {
    console.error('Admin promo activations error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/promos/activations?telegramId=<adminId>&activationId=<id>
 *
 * Removes a single row from `promo_code_uses` so the owner can clean up
 * the feed (e.g. test activations, accidentally applied codes). Also
 * decrements `promo_codes.used_count` so the same user could in theory
 * apply the promo again, and quota counters stay correct.
 *
 * Note: this does NOT undo whatever the activation granted (extra days,
 * VPN keys, subscription extension etc.). It only deletes the audit row.
 * If you need to reclaim days/keys, do it through the user-management
 * panel.
 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    const activationIdParam = url.searchParams.get('activationId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await ensurePromoSchema();

    if (!activationIdParam) {
      return NextResponse.json({ error: 'activationId is required' }, { status: 400 });
    }

    const activationId = Number(activationIdParam);
    if (!Number.isFinite(activationId) || activationId < 1) {
      return NextResponse.json({ error: 'Invalid activationId' }, { status: 400 });
    }

    const deleted = await dbQuery<{ id: string; promo_code_id: string }>(
      `
      DELETE FROM promo_code_uses
      WHERE id = $1
      RETURNING id, promo_code_id;
      `,
      [activationId],
    );

    if (deleted.rows.length === 0) {
      return NextResponse.json({ error: 'Activation not found' }, { status: 404 });
    }

    // Keep used_count consistent with the actual number of rows in
    // promo_code_uses. GREATEST(0, …) defends against drift (e.g. older
    // rows that were lost before we switched to soft-delete).
    await dbQuery(
      `
      UPDATE promo_codes
      SET used_count = GREATEST(0, used_count - 1)
      WHERE id = $1;
      `,
      [deleted.rows[0].promo_code_id],
    );

    return NextResponse.json({ ok: true, deletedActivationId: Number(deleted.rows[0].id) });
  } catch (error) {
    console.error('Admin promo activations DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
