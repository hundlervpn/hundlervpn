import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/withdrawals?telegramId=…&status=pending|in_progress|paid|rejected|cancelled&limit=…&offset=…
//
// Owner-only listing of every withdrawal request across all users. Shows
// the requester's identity, amount, method, status, last-message preview
// and unread counter so the admin can triage a chat queue at a glance.
//
// Response:
//   { ok, totals: { pending, in_progress, paid, rejected, cancelled, totalRub },
//     items: [ {...withdrawal, user, lastMessage} ], hasMore }
// ────────────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  user_id: number;
  amount_rub: number;
  method: string;
  destination: Record<string, unknown>;
  status: string;
  payout_note: string | null;
  processed_at: Date | null;
  processed_by_user_id: number | null;
  created_at: Date;
  updated_at: Date;
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  last_message_body: string | null;
  last_message_at: Date | null;
  last_message_role: string | null;
  message_count: string;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    if (!telegramId || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const status = url.searchParams.get('status');
    const validStatuses = ['pending', 'in_progress', 'paid', 'rejected', 'cancelled'];
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

    const params: any[] = [];
    let where = '';
    if (status && validStatuses.includes(status)) {
      params.push(status);
      where = `WHERE w.status = $${params.length}`;
    }

    const pool = getDbPool();

    // Per-status totals (always over the full table, ignoring filters)
    // so the admin can see queue health at a glance. Amount sum is RUB-
    // only because that's the only currency we settle in.
    const totalsRow = await pool.query<{
      pending: string;
      in_progress: string;
      paid: string;
      rejected: string;
      cancelled: string;
      total_rub: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::text     AS pending,
        COUNT(*) FILTER (WHERE status = 'in_progress')::text AS in_progress,
        COUNT(*) FILTER (WHERE status = 'paid')::text        AS paid,
        COUNT(*) FILTER (WHERE status = 'rejected')::text    AS rejected,
        COUNT(*) FILTER (WHERE status = 'cancelled')::text   AS cancelled,
        COALESCE(SUM(amount_rub) FILTER (WHERE status IN ('pending','in_progress')), 0)::text AS total_rub
      FROM referral_withdrawals;
    `);

    // Listing — joined with users for display + LATERAL pull of the most
    // recent chat message so the row can show a preview ("админ: вышлите
    // фото карты, пожалуйста") and unread badge.
    const itemsSql = `
      SELECT
        w.id::text AS id,
        w.user_id,
        w.amount_rub::float8 AS amount_rub,
        w.method,
        w.destination,
        w.status,
        w.payout_note,
        w.processed_at,
        w.processed_by_user_id,
        w.created_at,
        w.updated_at,
        u.telegram_id::text AS telegram_id,
        u.username,
        u.first_name,
        u.last_name,
        u.email,
        last_msg.body            AS last_message_body,
        last_msg.created_at      AS last_message_at,
        last_msg.author_role     AS last_message_role,
        COALESCE(msg_count.count, 0)::text AS message_count
      FROM referral_withdrawals w
      JOIN users u ON u.id = w.user_id
      LEFT JOIN LATERAL (
        SELECT body, created_at, author_role
        FROM referral_withdrawal_messages
        WHERE withdrawal_id = w.id
        ORDER BY created_at DESC
        LIMIT 1
      ) last_msg ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS count
        FROM referral_withdrawal_messages
        WHERE withdrawal_id = w.id
      ) msg_count ON TRUE
      ${where}
      ORDER BY
        CASE w.status
          WHEN 'pending'     THEN 0
          WHEN 'in_progress' THEN 1
          WHEN 'paid'        THEN 2
          WHEN 'rejected'    THEN 3
          WHEN 'cancelled'   THEN 4
          ELSE 5
        END,
        w.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;

    const rows = await pool.query<Row>(itemsSql, [...params, limit + 1, offset]);
    const sliced = rows.rows.slice(0, limit);
    const hasMore = rows.rowCount! > limit;

    const items = sliced.map((r) => ({
      id: r.id,
      userId: r.user_id,
      amountRub: Number(r.amount_rub),
      method: r.method,
      destination: r.destination ?? {},
      status: r.status,
      payoutNote: r.payout_note,
      processedAt: r.processed_at ? new Date(r.processed_at).toISOString() : null,
      processedByUserId: r.processed_by_user_id,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      messageCount: Number(r.message_count) || 0,
      lastMessage: r.last_message_body
        ? {
            body: r.last_message_body,
            authorRole: r.last_message_role,
            createdAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
          }
        : null,
      user: {
        id: r.user_id,
        telegramId: r.telegram_id,
        username: r.username,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        displayName:
          [r.first_name, r.last_name].filter(Boolean).join(' ').trim() ||
          r.username ||
          r.email ||
          (r.telegram_id ? `tg:${r.telegram_id}` : `user#${r.user_id}`),
      },
    }));

    const t = totalsRow.rows[0];
    return NextResponse.json({
      ok: true,
      items,
      hasMore,
      totals: {
        pending: parseInt(t?.pending ?? '0', 10),
        inProgress: parseInt(t?.in_progress ?? '0', 10),
        paid: parseInt(t?.paid ?? '0', 10),
        rejected: parseInt(t?.rejected ?? '0', 10),
        cancelled: parseInt(t?.cancelled ?? '0', 10),
        openAmountRub: Number(t?.total_rub ?? '0'),
      },
    });
  } catch (error) {
    console.error('[admin/withdrawals/GET] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
