import { NextResponse } from 'next/server';
import { dbQuery, getDbPool } from '@/lib/db';

type IdentityResolution =
  | { ok: true; field: 'telegram_id' | 'id'; value: number }
  | { ok: false; error: string };

type TicketDetailsRow = {
  id: string;
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
    const identity = resolveIdentity(url.searchParams.get('telegramId'), url.searchParams.get('userId'));

    if (!identity.ok) {
      return NextResponse.json({ error: identity.error }, { status: 400 });
    }

    const ticketResult = await dbQuery<TicketDetailsRow>(
      `
      SELECT
        st.id::text AS id,
        st.subject,
        st.status,
        st.created_at,
        st.updated_at,
        st.closed_at
      FROM support_tickets st
      JOIN users u ON u.id = st.user_id
      WHERE st.id = $1
        AND u.${identity.field} = $2
      LIMIT 1;
      `,
      [ticketId, identity.value]
    );

    if (ticketResult.rows.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const messagesResult = await dbQuery<TicketMessageRow>(
      `
      SELECT
        id::text AS id,
        sender_type,
        message,
        created_at
      FROM support_ticket_messages
      WHERE ticket_id = $1
      ORDER BY created_at ASC;
      `,
      [ticketId]
    );

    return NextResponse.json({
      ok: true,
      ticket: ticketResult.rows[0],
      messages: messagesResult.rows,
    });
  } catch (error) {
    console.error('Ticket details error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type UserReplyBody = {
  telegramId?: number | string;
  userId?: number | string;
  message?: string;
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

    const body = (await req.json()) as UserReplyBody;
    const identity = resolveIdentity(body.telegramId, body.userId);

    if (!identity.ok) {
      return NextResponse.json({ error: identity.error }, { status: 400 });
    }

    const message = body.message?.trim() ?? '';

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    if (message.length > 4000) {
      return NextResponse.json({ error: 'message is too long' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const ticketResult = await client.query<{ id: string }>(
        `
        SELECT st.id::text AS id
        FROM support_tickets st
        JOIN users u ON u.id = st.user_id
        WHERE st.id = $1
          AND u.${identity.field} = $2
        LIMIT 1
        FOR UPDATE OF st;
        `,
        [ticketId, identity.value]
      );

      if (ticketResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      const messageResult = await client.query<TicketMessageRow>(
        `
        INSERT INTO support_ticket_messages (ticket_id, sender_type, message)
        VALUES ($1, 'user', $2)
        RETURNING id::text AS id, sender_type, message, created_at;
        `,
        [ticketId, message]
      );

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
    console.error('Ticket user reply error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type UserTicketStatusBody = {
  telegramId?: number | string;
  userId?: number | string;
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

    const body = (await req.json()) as UserTicketStatusBody;
    const identity = resolveIdentity(body.telegramId, body.userId);

    if (!identity.ok) {
      return NextResponse.json({ error: identity.error }, { status: 400 });
    }

    if (body.status !== 'open' && body.status !== 'closed') {
      return NextResponse.json({ error: 'status must be open or closed' }, { status: 400 });
    }

    const result = await dbQuery<TicketDetailsRow>(
      `
      UPDATE support_tickets st
      SET status = $3,
          closed_at = CASE WHEN $3 = 'closed' THEN NOW() ELSE NULL END,
          updated_at = NOW()
      FROM users u
      WHERE st.user_id = u.id
        AND st.id = $1
        AND u.${identity.field} = $2
      RETURNING
        st.id::text AS id,
        st.subject,
        st.status,
        st.created_at,
        st.updated_at,
        st.closed_at;
      `,
      [ticketId, identity.value, body.status]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ticket: result.rows[0] });
  } catch (error) {
    console.error('Ticket status update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
