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

    const [usersResult, paymentsResult, subsResult] = await Promise.all([
      dbQuery<{ total: string; today: string; banned: string }>(`
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::text AS today,
          COUNT(*) FILTER (WHERE is_banned = TRUE)::text AS banned
        FROM users;
      `),
      dbQuery<{ total_amount: string; total_count: string; paid_count: string }>(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::text AS total_amount,
          COUNT(*)::text AS total_count,
          COUNT(*) FILTER (WHERE status = 'paid')::text AS paid_count
        FROM payments;
      `),
      dbQuery<{ active: string }>(`
        SELECT COUNT(*) FILTER (WHERE status = 'active' AND end_date > NOW())::text AS active
        FROM subscriptions;
      `),
    ]);

    return NextResponse.json({
      ok: true,
      stats: {
        totalUsers: Number(usersResult.rows[0]?.total ?? 0),
        todayUsers: Number(usersResult.rows[0]?.today ?? 0),
        bannedUsers: Number(usersResult.rows[0]?.banned ?? 0),
        totalRevenue: Number(paymentsResult.rows[0]?.total_amount ?? 0),
        totalPayments: Number(paymentsResult.rows[0]?.total_count ?? 0),
        paidPayments: Number(paymentsResult.rows[0]?.paid_count ?? 0),
        activeSubscriptions: Number(subsResult.rows[0]?.active ?? 0),
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
