import { NextResponse } from 'next/server';
import { dbQuery, getDbPool } from '@/lib/db';
import { parseIncomingAttachments, insertAttachments } from '@/lib/ticket-attachments';

type IdentityResolution =
  | { ok: true; field: 'telegram_id' | 'id'; value: number }
  | { ok: false; error: string };

type TicketRow = {
  id: string;
  subject: string | null;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string;
  messages_count: number;
  unread_count: number;
};

function hasValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function resolveIdentity(telegramIdRaw: unknown, userIdRaw: unknown): IdentityResolution {
  const hasTelegramId = hasValue(telegramIdRaw);
  const hasUserId = hasValue(userIdRaw);

  if (!hasTelegramId && !hasUserId) {
    return { ok: false, error: 'telegramId or userId is required' };
  }

  if (hasTelegramId) {
    const telegramId = Number(telegramIdRaw);
    if (!Number.isFinite(telegramId)) {
      return { ok: false, error: 'Invalid telegramId' };
    }
    return { ok: true, field: 'telegram_id', value: telegramId };
  }

  const userId = Number(userIdRaw);
  if (!Number.isFinite(userId)) {
    return { ok: false, error: 'Invalid userId' };
  }

  return { ok: true, field: 'id', value: userId };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const identity = resolveIdentity(url.searchParams.get('telegramId'), url.searchParams.get('userId'));

    if (!identity.ok) {
      return NextResponse.json({ error: identity.error }, { status: 400 });
    }

    const result = await dbQuery<TicketRow>(
      `
      SELECT
        st.id::text AS id,
        st.subject,
        st.status,
        st.created_at,
        st.updated_at,
        COALESCE(
          NULLIF(last_msg.message, ''),
          CASE WHEN last_msg.attachments_count > 0 THEN '📷 Фото' ELSE NULL END
        ) AS last_message,
        COALESCE(last_msg.created_at, st.created_at) AS last_message_at,
        (SELECT COUNT(*)::int FROM support_ticket_messages stm WHERE stm.ticket_id = st.id) AS messages_count,
        (
          SELECT COUNT(*)::int FROM support_ticket_messages stm
          WHERE stm.ticket_id = st.id
            AND stm.sender_type IN ('admin', 'system')
            AND (st.last_user_read_at IS NULL OR stm.created_at > st.last_user_read_at)
        ) AS unread_count
      FROM support_tickets st
      JOIN users u ON u.id = st.user_id
      LEFT JOIN LATERAL (
        SELECT
          stm.message,
          stm.created_at,
          (SELECT COUNT(*)::int FROM support_ticket_attachments sta WHERE sta.message_id = stm.id) AS attachments_count
        FROM support_ticket_messages stm
        WHERE stm.ticket_id = st.id
        ORDER BY stm.created_at DESC
        LIMIT 1
      ) last_msg ON TRUE
      WHERE u.${identity.field} = $1
      ORDER BY COALESCE(last_msg.created_at, st.created_at) DESC;
      `,
      [identity.value]
    );

    return NextResponse.json({ ok: true, tickets: result.rows });
  } catch (error) {
    console.error('Tickets fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type CreateTicketBody = {
  telegramId?: number | string;
  userId?: number | string;
  subject?: string;
  message?: string;
  attachments?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateTicketBody;
    const identity = resolveIdentity(body.telegramId, body.userId);

    if (!identity.ok) {
      return NextResponse.json({ error: identity.error }, { status: 400 });
    }

    const subject = body.subject?.trim() ?? '';
    const message = body.message?.trim() ?? '';

    const attachmentsParse = parseIncomingAttachments(body.attachments);
    if (!attachmentsParse.ok) {
      return NextResponse.json({ error: attachmentsParse.error }, { status: 400 });
    }
    const attachments = attachmentsParse.attachments;

    if (!message && attachments.length === 0) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    if (subject.length > 120) {
      return NextResponse.json({ error: 'subject is too long' }, { status: 400 });
    }

    if (message.length > 4000) {
      return NextResponse.json({ error: 'message is too long' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const userResult = await client.query<{ id: number }>(
        `SELECT id FROM users WHERE ${identity.field} = $1 LIMIT 1;`,
        [identity.value]
      );

      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const ticketResult = await client.query<TicketRow>(
        `
        INSERT INTO support_tickets (user_id, subject, last_user_read_at)
        VALUES ($1, $2, NOW())
        RETURNING
          id::text AS id,
          subject,
          status,
          created_at,
          updated_at,
          NULL::text AS last_message,
          created_at AS last_message_at,
          1::int AS messages_count,
          0::int AS unread_count;
        `,
        [userResult.rows[0].id, subject || null]
      );

      const ticket = ticketResult.rows[0];

      const insertedMessage = await client.query<{ id: string }>(
        `
        INSERT INTO support_ticket_messages (ticket_id, sender_type, message)
        VALUES ($1, 'user', $2)
        RETURNING id::text AS id;
        `,
        [ticket.id, message]
      );

      await insertAttachments(client, ticket.id, insertedMessage.rows[0].id, attachments);

      await client.query('UPDATE support_tickets SET updated_at = NOW() WHERE id = $1;', [ticket.id]);

      await client.query('COMMIT');

      return NextResponse.json({
        ok: true,
        ticket: {
          ...ticket,
          last_message: message || (attachments.length > 0 ? '📷 Фото' : null),
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Ticket create error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
