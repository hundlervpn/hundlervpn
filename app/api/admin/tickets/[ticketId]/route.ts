import { NextResponse } from 'next/server';
import { getDbPool, dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import {
  parseIncomingAttachments,
  insertAttachments,
  fetchAttachmentsByMessage,
  type AttachmentMeta,
} from '@/lib/ticket-attachments';
import {
  fetchReactionsByMessage,
  resolveReplyToId,
  type ReactionMeta,
} from '@/lib/ticket-message-actions';

type TicketDetailsRow = {
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
  closed_at: string | null;
};

type TicketMessageRow = {
  id: string;
  sender_type: 'user' | 'admin' | 'system';
  message: string;
  created_at: string;
  reply_to_id: string | null;
};

function parseTicketId(raw: string) {
  const id = Number(raw);
  if (!Number.isFinite(id) || id < 1) return null;
  return id;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { ticketId: ticketIdRaw } = await params;
    const ticketId = parseTicketId(ticketIdRaw);

    if (!ticketId) {
      return NextResponse.json({ error: 'Invalid ticketId' }, { status: 400 });
    }

    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Mark-read-on-open for admin: bump last_admin_read_at to NOW(). Same
    // RETURNING pattern keeps it as a single round-trip.
    const [ticketResult, messagesResult] = await Promise.all([
      dbQuery<TicketDetailsRow>(
        `
        UPDATE support_tickets st
        SET last_admin_read_at = NOW()
        FROM users u
        WHERE st.user_id = u.id
          AND st.id = $1
        RETURNING
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
          st.closed_at;
        `,
        [ticketId]
      ),
      dbQuery<TicketMessageRow>(
        `
        SELECT
          id::text AS id,
          sender_type,
          message,
          created_at,
          reply_to_id::text AS reply_to_id
        FROM support_ticket_messages
        WHERE ticket_id = $1
        ORDER BY created_at ASC;
        `,
        [ticketId]
      ),
    ]);

    if (ticketResult.rows.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const [attachmentsByMessage, reactionsByMessage] = await Promise.all([
      fetchAttachmentsByMessage(dbQuery, ticketId),
      fetchReactionsByMessage(dbQuery, ticketId),
    ]);
    const messages = messagesResult.rows.map((msg) => ({
      ...msg,
      attachments: attachmentsByMessage.get(msg.id) ?? ([] as AttachmentMeta[]),
      reactions: reactionsByMessage.get(msg.id) ?? ([] as ReactionMeta[]),
    }));

    return NextResponse.json({
      ok: true,
      ticket: ticketResult.rows[0],
      messages,
    });
  } catch (error) {
    console.error('Admin ticket details error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type ReplyBody = {
  telegramId?: number | string;
  message?: string;
  attachments?: unknown;
  replyToId?: number | string | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { ticketId: ticketIdRaw } = await params;
    const ticketId = parseTicketId(ticketIdRaw);

    if (!ticketId) {
      return NextResponse.json({ error: 'Invalid ticketId' }, { status: 400 });
    }

    const body = (await req.json()) as ReplyBody;
    const message = body.message?.trim() ?? '';

    if (!isAdmin(body.telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const attachmentsParse = parseIncomingAttachments(body.attachments);
    if (!attachmentsParse.ok) {
      return NextResponse.json({ error: attachmentsParse.error }, { status: 400 });
    }
    const attachments = attachmentsParse.attachments;

    if (!message && attachments.length === 0) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    if (message.length > 4000) {
      return NextResponse.json({ error: 'message is too long' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const ticketExists = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM support_tickets WHERE id = $1 FOR UPDATE;`,
        [ticketId]
      );

      if (ticketExists.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      const replyResolution = await resolveReplyToId(client, ticketId, body.replyToId);
      if (!replyResolution.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: replyResolution.error }, { status: 400 });
      }

      const messageResult = await client.query<TicketMessageRow>(
        `
        INSERT INTO support_ticket_messages (ticket_id, sender_type, message, reply_to_id)
        VALUES ($1, 'admin', $2, $3)
        RETURNING id::text AS id, sender_type, message, created_at, reply_to_id::text AS reply_to_id;
        `,
        [ticketId, message, replyResolution.replyToId]
      );

      await insertAttachments(client, ticketId, messageResult.rows[0].id, attachments);

      await client.query(
        `
        UPDATE support_tickets
        SET status = 'open',
            closed_at = NULL,
            updated_at = NOW()
        WHERE id = $1;
        `,
        [ticketId]
      );

      await client.query('COMMIT');

      return NextResponse.json({ ok: true, message: messageResult.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin ticket reply error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type UpdateTicketBody = {
  telegramId?: number | string;
  status?: 'open' | 'closed';
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { ticketId: ticketIdRaw } = await params;
    const ticketId = parseTicketId(ticketIdRaw);

    if (!ticketId) {
      return NextResponse.json({ error: 'Invalid ticketId' }, { status: 400 });
    }

    const body = (await req.json()) as UpdateTicketBody;

    if (!isAdmin(body.telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (body.status !== 'open' && body.status !== 'closed') {
      return NextResponse.json({ error: 'status must be open or closed' }, { status: 400 });
    }

    const result = await dbQuery<{ id: string; status: 'open' | 'closed'; updated_at: string; closed_at: string | null }>(
      `
      UPDATE support_tickets
      SET status = $2,
          closed_at = CASE WHEN $2 = 'closed' THEN NOW() ELSE NULL END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id::text AS id, status, updated_at, closed_at;
      `,
      [ticketId, body.status]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ticket: result.rows[0] });
  } catch (error) {
    console.error('Admin ticket update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { ticketId: ticketIdRaw } = await params;
    const ticketId = parseTicketId(ticketIdRaw);

    if (!ticketId) {
      return NextResponse.json({ error: 'Invalid ticketId' }, { status: 400 });
    }

    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await dbQuery<{ id: string }>(
      `
      DELETE FROM support_tickets
      WHERE id = $1
      RETURNING id::text AS id;
      `,
      [ticketId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deletedTicketId: result.rows[0].id });
  } catch (error) {
    console.error('Admin ticket delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
