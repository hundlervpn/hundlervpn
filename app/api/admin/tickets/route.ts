import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

type AdminTicketRow = {
  id: string;
  user_id: string;
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  subject: string | null;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string;
  messages_count: number;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const statusRaw = url.searchParams.get('status')?.trim().toLowerCase() || '';
    const searchRaw = url.searchParams.get('search')?.trim() || '';

    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (statusRaw === 'open' || statusRaw === 'closed') {
      whereClauses.push(`st.status = $${paramIndex}`);
      values.push(statusRaw);
      paramIndex++;
    }

    if (searchRaw) {
      whereClauses.push(`(
        u.telegram_id::text ILIKE $${paramIndex}
        OR u.username ILIKE $${paramIndex}
        OR u.first_name ILIKE $${paramIndex}
        OR u.last_name ILIKE $${paramIndex}
        OR st.subject ILIKE $${paramIndex}
      )`);
      values.push(`%${searchRaw}%`);
      paramIndex++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const result = await dbQuery<AdminTicketRow>(
      `
      SELECT
        st.id::text AS id,
        st.user_id::text AS user_id,
        u.telegram_id::text AS telegram_id,
        u.username,
        u.first_name,
        u.last_name,
        st.subject,
        st.status,
        st.created_at,
        st.updated_at,
        last_msg.message AS last_message,
        COALESCE(last_msg.created_at, st.created_at) AS last_message_at,
        (SELECT COUNT(*)::int FROM support_ticket_messages stm WHERE stm.ticket_id = st.id) AS messages_count
      FROM support_tickets st
      JOIN users u ON u.id = st.user_id
      LEFT JOIN LATERAL (
        SELECT message, created_at
        FROM support_ticket_messages
        WHERE ticket_id = st.id
        ORDER BY created_at DESC
        LIMIT 1
      ) last_msg ON TRUE
      ${whereSql}
      ORDER BY CASE WHEN st.status = 'open' THEN 0 ELSE 1 END, COALESCE(last_msg.created_at, st.created_at) DESC
      LIMIT 200;
      `,
      values
    );

    return NextResponse.json({ ok: true, tickets: result.rows });
  } catch (error) {
    console.error('Admin tickets list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
