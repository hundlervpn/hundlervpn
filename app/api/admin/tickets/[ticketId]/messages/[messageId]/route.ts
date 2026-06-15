import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { isAllowedReactionEmoji, toggleReaction } from '@/lib/ticket-message-actions';

function parsePositiveNumber(raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return null;
  return value;
}

type ReactionBody = {
  telegramId?: number | string;
  emoji?: string;
};

// Set / replace / toggle-off the admin's reaction on a message.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ ticketId: string; messageId: string }> }
) {
  try {
    const { ticketId: ticketIdRaw, messageId: messageIdRaw } = await params;
    const ticketId = parsePositiveNumber(ticketIdRaw);
    const messageId = parsePositiveNumber(messageIdRaw);

    if (!ticketId || !messageId) {
      return NextResponse.json({ error: 'Invalid ticketId or messageId' }, { status: 400 });
    }

    const body = (await req.json()) as ReactionBody;

    if (!isAdmin(body.telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!isAllowedReactionEmoji(body.emoji)) {
      return NextResponse.json({ error: 'Unsupported emoji' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      const result = await toggleReaction(client, ticketId, messageId, 'admin', body.emoji);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ ok: true, messageId: String(messageId), reactions: result.reactions });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin ticket reaction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ ticketId: string; messageId: string }> }
) {
  try {
    const { ticketId: ticketIdRaw, messageId: messageIdRaw } = await params;
    const ticketId = parsePositiveNumber(ticketIdRaw);
    const messageId = parsePositiveNumber(messageIdRaw);

    if (!ticketId || !messageId) {
      return NextResponse.json({ error: 'Invalid ticketId or messageId' }, { status: 400 });
    }

    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const ticketResult = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM support_tickets WHERE id = $1 LIMIT 1 FOR UPDATE;`,
        [ticketId]
      );

      if (ticketResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      const deleteResult = await client.query<{ id: string }>(
        `
        DELETE FROM support_ticket_messages
        WHERE id = $1 AND ticket_id = $2
        RETURNING id::text AS id;
        `,
        [messageId, ticketId]
      );

      if (deleteResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      }

      await client.query('UPDATE support_tickets SET updated_at = NOW() WHERE id = $1;', [ticketId]);

      await client.query('COMMIT');

      return NextResponse.json({ ok: true, deletedMessageId: deleteResult.rows[0].id });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin ticket message delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
