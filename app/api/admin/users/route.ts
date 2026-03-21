import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

type AdminUser = {
  id: number;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  is_banned: boolean;
  ban_reason: string | null;
  created_at: string;
  last_seen_at: string;
  total_paid: string;
  payments_count: string;
  subscription_status: string | null;
  subscription_end: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const search = url.searchParams.get('search')?.trim() || '';
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = 50;
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause = `WHERE u.username ILIKE $${paramIndex} OR u.first_name ILIKE $${paramIndex} OR u.last_name ILIKE $${paramIndex} OR u.telegram_id::text LIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const countResult = await dbQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users u ${whereClause};`,
      params
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const result = await dbQuery<AdminUser>(
      `
      SELECT
        u.id,
        u.telegram_id::text AS telegram_id,
        u.username,
        u.first_name,
        u.last_name,
        u.status,
        u.is_banned,
        u.ban_reason,
        u.created_at,
        u.last_seen_at,
        COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'paid'), 0)::text AS total_paid,
        COUNT(p.id) FILTER (WHERE p.status = 'paid')::text AS payments_count,
        s.status AS subscription_status,
        s.end_date AS subscription_end
      FROM users u
      LEFT JOIN payments p ON p.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT status, end_date
        FROM subscriptions
        WHERE user_id = u.id
        ORDER BY end_date DESC NULLS LAST
        LIMIT 1
      ) s ON TRUE
      ${whereClause}
      GROUP BY u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.status, u.is_banned, u.ban_reason, u.created_at, u.last_seen_at, s.status, s.end_date
      ORDER BY u.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
      `,
      [...params, limit, offset]
    );

    return NextResponse.json({
      ok: true,
      users: result.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Admin users error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
