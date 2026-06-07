import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/withdrawals/balances?telegramId=…&limit=…&offset=…&q=…
//
// 2026-05-23: список всех юзеров с НЕНУЛЕВЫМ реферальным балансом
// (`users.referral_balance_rub > 0`) — для админ-вкладки "Балансы".
// Позволяет видеть кто заработал но ещё не вывел / не запросил вывод.
//
// Каждой записи возвращаем:
//   • balanceRub          — текущий баланс кошелька (рубли)
//   • lifetimeEarnedRub   — суммарно начислено за всю историю
//   • paidOutRub          — сумма выплаченных заявок (status='paid')
//   • openRequestRub      — сумма открытых заявок (pending+in_progress)
//   • lastAccrualAt       — дата последнего начисления (для сортировки
//                           "недавняя активность")
//
// Сортировка: balance DESC, затем lifetime DESC.
//
// Параметры:
//   q       — подстрока для фильтра (по username/firstName/lastName/email).
//   limit   — макс 200, по умолчанию 100.
//   offset  — для пагинации (если когда-то понадобится).
// ────────────────────────────────────────────────────────────────────────────

type Row = {
  id: number;
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  photo_url: string | null;
  balance_rub: number;
  lifetime_earned_rub: number;
  paid_out_rub: number;
  open_request_rub: number;
  last_accrual_at: Date | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    if (!telegramId || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') ?? '100', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

    const params: any[] = [];
    let searchWhere = '';
    if (q.length > 0) {
      // Регистронезависимый ILIKE по нескольким полям. Для длинных
      // подстрок (5+ символов) и telegram_id-числа можно расширить до
      // полнотекстового, но текущий объём (100-500 записей) явно нет
      // смысла усложнять.
      params.push(`%${q}%`);
      searchWhere = `AND (
        LOWER(COALESCE(u.username, '')) LIKE $${params.length}
        OR LOWER(COALESCE(u.first_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(u.last_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(u.email, '')) LIKE $${params.length}
        OR CAST(u.telegram_id AS TEXT) LIKE $${params.length}
      )`;
    }

    params.push(limit);
    const limitParamIdx = params.length;
    params.push(offset);
    const offsetParamIdx = params.length;

    // Один запрос — LEFT JOIN-ы на агрегаты. На текущем объёме это
    // быстрее чем сериальные запросы, и Postgres хорошо параллелит
    // подзапросы. Если когда-то users.referral_balance_rub > 0 будет
    // содержать тысячи строк — пересмотреть на materialized view.
    const pool = getDbPool();
    const client = await pool.connect();
    try {
      const sql = `
        SELECT
          u.id,
          u.telegram_id::text,
          u.username,
          u.first_name,
          u.last_name,
          u.email,
          u.photo_url,
          u.referral_balance_rub::float8 AS balance_rub,
          COALESCE(life.total, 0)::float8 AS lifetime_earned_rub,
          COALESCE(paid.total, 0)::float8 AS paid_out_rub,
          COALESCE(open_req.total, 0)::float8 AS open_request_rub,
          life.last_at AS last_accrual_at
        FROM users u
        LEFT JOIN (
          SELECT inviter_user_id,
                 SUM(amount_rub) AS total,
                 MAX(created_at) AS last_at
            FROM referral_balance_transactions
           GROUP BY inviter_user_id
        ) life ON life.inviter_user_id = u.id
        LEFT JOIN (
          SELECT user_id, SUM(amount_rub) AS total
            FROM referral_withdrawals
           WHERE status = 'paid'
           GROUP BY user_id
        ) paid ON paid.user_id = u.id
        LEFT JOIN (
          SELECT user_id, SUM(amount_rub) AS total
            FROM referral_withdrawals
           WHERE status IN ('pending', 'in_progress')
           GROUP BY user_id
        ) open_req ON open_req.user_id = u.id
        WHERE u.referral_balance_rub > 0
          ${searchWhere}
        ORDER BY u.referral_balance_rub DESC, life.total DESC NULLS LAST
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx};
      `;

      const res = await client.query<Row>(sql, params);

      // Сумма всех висящих балансов — полезный totals-индикатор сверху
      // ("сколько денег зависло на кошельках без заявки на вывод").
      const totalsRes = await client.query<{ count: string; sum_balance: number; sum_lifetime: number }>(
        `SELECT
           COUNT(*)::text AS count,
           COALESCE(SUM(referral_balance_rub), 0)::float8 AS sum_balance,
           COALESCE((SELECT SUM(amount_rub) FROM referral_balance_transactions), 0)::float8 AS sum_lifetime
         FROM users
         WHERE referral_balance_rub > 0;`
      );
      const totals = {
        usersWithBalance: parseInt(totalsRes.rows[0]?.count ?? '0', 10),
        totalBalanceRub: Number(totalsRes.rows[0]?.sum_balance ?? 0),
        lifetimeAccruedRub: Number(totalsRes.rows[0]?.sum_lifetime ?? 0),
      };

      const items = res.rows.map((r) => {
        const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
        const displayName = (
          fullName ||
          (r.username ? `@${r.username}` : null) ||
          r.email ||
          (r.telegram_id ? `tg:${r.telegram_id}` : `id:${r.id}`)
        );
        return {
          id: r.id,
          telegramId: r.telegram_id,
          username: r.username,
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.email,
          photoUrl: r.photo_url,
          displayName,
          balanceRub: Number(r.balance_rub),
          lifetimeEarnedRub: Number(r.lifetime_earned_rub),
          paidOutRub: Number(r.paid_out_rub),
          openRequestRub: Number(r.open_request_rub),
          lastAccrualAt: r.last_accrual_at ? r.last_accrual_at.toISOString() : null,
        };
      });

      return NextResponse.json({ ok: true, items, totals });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[api/admin/withdrawals/balances] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
