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

    const [usersResult, paymentsResult, subsResult, monthlyResult, trafficTotalResult, monthlyTrafficResult] = await Promise.all([
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
      // All-time total traffic consumed by users. subscriptions.traffic_used_bytes
      // is a lifetime per-subscription counter that never resets (a new sub starts
      // at 0, expired subs keep their value), so SUM across ALL rows ≈ lifetime
      // bytes through the tunnels. This includes history from before the monthly
      // bucket table existed, so it can legitimately exceed the sum of the bars.
      dbQuery<{ total_bytes: string }>(`
        SELECT COALESCE(SUM(traffic_used_bytes), 0)::text AS total_bytes
        FROM subscriptions;
      `),
      // Monthly traffic histogram (2026-06-11). Accumulated forward by
      // /api/xray/traffic — past months before the table existed are absent.
      dbQuery<{ month: string; bytes: string }>(`
        SELECT
          to_char(month, 'YYYY-MM') AS month,
          bytes_total::text AS bytes
        FROM traffic_monthly
        ORDER BY month DESC
        LIMIT 24;
      `),
    ]);

    // Load stat overrides (owner may override displayed values).
    let overrides: Record<string, any> = {};
    try {
      const ovResult = await dbQuery<{ overrides: any }>(
        'SELECT overrides FROM stat_overrides WHERE id = 1'
      );
      overrides = ovResult.rows[0]?.overrides ?? {};
    } catch { /* table may not exist yet — ignore */ }

    const monthlyRevData = monthlyResult.rows.map((r) => ({
      month: r.month,
      revenue: Number(r.revenue ?? 0),
      paidCount: Number(r.paid_count ?? 0),
    }));

    // Apply monthly overrides if present.
    const monthlyOverrides = overrides.monthlyRevenue as Record<string, { revenue?: number; paidCount?: number }> | undefined;
    if (monthlyOverrides) {
      for (const m of monthlyRevData) {
        const ov = monthlyOverrides[m.month];
        if (ov) {
          if (typeof ov.revenue === 'number') m.revenue = ov.revenue;
          if (typeof ov.paidCount === 'number') m.paidCount = ov.paidCount;
        }
      }
    }

    const ov = (key: string, real: number) => {
      const val = overrides[key];
      return typeof val === 'number' ? val : real;
    };

    return NextResponse.json({
      ok: true,
      stats: {
        totalUsers: ov('totalUsers', Number(usersResult.rows[0]?.total ?? 0)),
        todayUsers: ov('todayUsers', Number(usersResult.rows[0]?.today ?? 0)),
        bannedUsers: ov('bannedUsers', Number(usersResult.rows[0]?.banned ?? 0)),
        totalRevenue: ov('totalRevenue', Number(paymentsResult.rows[0]?.total_amount ?? 0)),
        currentMonthRevenue: ov('currentMonthRevenue', Number(paymentsResult.rows[0]?.current_month ?? 0)),
        totalPayments: ov('totalPayments', Number(paymentsResult.rows[0]?.total_count ?? 0)),
        paidPayments: ov('paidPayments', Number(paymentsResult.rows[0]?.paid_count ?? 0)),
        activeSubscriptions: ov('activeSubscriptions', Number(subsResult.rows[0]?.active ?? 0)),
        monthlyRevenue: monthlyRevData,
        totalTrafficBytes: Number(trafficTotalResult.rows[0]?.total_bytes ?? 0),
        monthlyTraffic: monthlyTrafficResult.rows.map((r) => ({
          month: r.month,
          bytes: Number(r.bytes ?? 0),
        })),
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
