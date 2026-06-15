import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAllowedReactionEmoji, toggleReaction } from '@/lib/ticket-message-actions';

type IdentityResolution =
  | { ok: true; field: 'telegram_id' | 'id'; value: number }
  | { ok: false; error: string };

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

function parsePositiveNumber(raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return null;
  return value;
}

type ReactionBody = {
  telegramId?: number | string;
  userId?: number | string;
  emoji?: string;
};

// Set / replace / toggle-off the requesting user's reaction on a message.
// The user must own the parent ticket.
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
    const identity = resolveIdentity(body.telegramId, body.userId);

    if (!identity.ok) {
      return NextResponse.json({ error: identity.error }, { status: 400 });
    }

    if (!isAllowedReactionEmoji(body.emoji)) {
      return NextResponse.json({ error: 'Unsupported emoji' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      // Ownership check: ticket must belong to the requesting user.
      const owns = await client.query<{ id: string }>(
        `
        SELECT st.id::text AS id
        FROM support_tickets st
        JOIN users u ON u.id = st.user_id
        WHERE st.id = $1
          AND u.${identity.field} = $2
        LIMIT 1;
        `,
        [ticketId, identity.value]
      );

      if (owns.rows.length === 0) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      const result = await toggleReaction(client, ticketId, messageId, 'user', body.emoji);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      return NextResponse.json({ ok: true, messageId: String(messageId), reactions: result.reactions });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Ticket user reaction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
