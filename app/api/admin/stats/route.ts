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

    const [usersResult, paymentsResult, subsResult, monthlyResult] = await Promise.all([
      dbQuery<{ total: string; today: string; banned: string }>(`
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::text AS today,
          COUNT(*) FILTER (WHERE is_banned = TRUE)::text AS banned
        FROM users;
      `),
      dbQuery<{ total_amount: string; total_count: string; paid_count: string; current_month: string }>(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::text AS total_amount,
          COUNT(*)::text AS total_count,
          COUNT(*) FILTER (WHERE status = 'paid')::text AS paid_count,
          COALESCE(SUM(amount) FILTER (
            WHERE status = 'paid'
              AND date_trunc('month', COALESCE(paid_at, created_at)) = date_trunc('month', NOW())
          ), 0)::text AS current_month
        FROM payments;
      `),
      dbQuery<{ active: string }>(`
        SELECT COUNT(*) FILTER (WHERE status = 'active' AND end_date > NOW())::text AS active
        FROM subscriptions;
      `),
      // Monthly revenue breakdown — attributed to the month a payment was paid
      // (falls back to created_at on the rare row without paid_at). Last 24 months.
      dbQuery<{ month: string; revenue: string; paid_count: string }>(`
        SELECT
          to_char(date_trunc('month', COALESCE(paid_at, created_at)), 'YYYY-MM') AS month,
          COALESCE(SUM(amount), 0)::text AS revenue,
          COUNT(*)::text AS paid_count
        FROM payments
        WHERE status = 'paid'
        GROUP BY date_trunc('month', COALESCE(paid_at, created_at))
        ORDER BY date_trunc('month', COALESCE(paid_at, created_at)) DESC
        LIMIT 24;
      `),
    ]);

    return NextResponse.json({
      ok: true,
      stats: {
        totalUsers: Number(usersResult.rows[0]?.total ?? 0),
        todayUsers: Number(usersResult.rows[0]?.today ?? 0),
        bannedUsers: Number(usersResult.rows[0]?.banned ?? 0),
        totalRevenue: Number(paymentsResult.rows[0]?.total_amount ?? 0),
        currentMonthRevenue: Number(paymentsResult.rows[0]?.current_month ?? 0),
        totalPayments: Number(paymentsResult.rows[0]?.total_count ?? 0),
        paidPayments: Number(paymentsResult.rows[0]?.paid_count ?? 0),
        activeSubscriptions: Number(subsResult.rows[0]?.active ?? 0),
        monthlyRevenue: monthlyResult.rows.map((r) => ({
          month: r.month,
          revenue: Number(r.revenue ?? 0),
          paidCount: Number(r.paid_count ?? 0),
        })),
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
