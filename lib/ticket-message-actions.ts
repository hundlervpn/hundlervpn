// Shared helpers for support-ticket message actions (reply + reactions).
//
// Reply: support_ticket_messages.reply_to_id points at an earlier message in
// the SAME ticket. The detail GET routes return every message anyway, so the
// client resolves the quoted message locally — we only validate + persist the
// id here.
//
// Reactions: one emoji per side (user/admin) per message, stored in
// support_ticket_message_reactions with UNIQUE (message_id, reactor_type).
// Tapping a new emoji replaces the row; tapping the same emoji removes it.

import type { PoolClient } from 'pg';

// Emoji palette shown in the reaction picker (matches the mini-app/admin UI).
// Keep in sync with the REACTION_EMOJIS array in app/page.tsx.
export const ALLOWED_REACTION_EMOJIS = ['👍', '👎', '❤️', '😊', '😮', '🎉'] as const;
export type ReactionEmoji = (typeof ALLOWED_REACTION_EMOJIS)[number];

export function isAllowedReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === 'string' && (ALLOWED_REACTION_EMOJIS as readonly string[]).includes(value);
}

export type ReactorType = 'user' | 'admin';

// Reaction row returned to clients, grouped per message.
export type ReactionMeta = {
  reactor_type: ReactorType;
  emoji: string;
};

/**
 * Fetch reactions for every message in a ticket, grouped by message id.
 * Used by the ticket-detail GET routes to enrich each message with
 * `reactions[]`.
 */
export async function fetchReactionsByMessage(
  query: <T extends Record<string, unknown>>(text: string, params: unknown[]) => Promise<{ rows: T[] }>,
  ticketId: number | string,
): Promise<Map<string, ReactionMeta[]>> {
  const result = await query<{ message_id: string; reactor_type: ReactorType; emoji: string }>(
    `
    SELECT
      message_id::text AS message_id,
      reactor_type,
      emoji
    FROM support_ticket_message_reactions
    WHERE ticket_id = $1
    ORDER BY id ASC;
    `,
    [ticketId],
  );

  const map = new Map<string, ReactionMeta[]>();
  for (const row of result.rows) {
    const list = map.get(row.message_id) ?? [];
    list.push({ reactor_type: row.reactor_type, emoji: row.emoji });
    map.set(row.message_id, list);
  }
  return map;
}

/**
 * Validate that `replyToId` (if provided) is a real message in this ticket.
 * Returns the numeric id to store, null when absent, or an error string when
 * malformed / not in the ticket. Must run inside the same tx as the message
 * INSERT (uses the transaction client).
 */
export async function resolveReplyToId(
  client: PoolClient,
  ticketId: number | string,
  rawReplyToId: unknown,
): Promise<{ ok: true; replyToId: number | null } | { ok: false; error: string }> {
  if (rawReplyToId === undefined || rawReplyToId === null || rawReplyToId === '') {
    return { ok: true, replyToId: null };
  }
  const replyToId = Number(rawReplyToId);
  if (!Number.isFinite(replyToId) || replyToId < 1) {
    return { ok: false, error: 'Invalid replyToId' };
  }
  const res = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM support_ticket_messages WHERE id = $1 AND ticket_id = $2 LIMIT 1;`,
    [replyToId, ticketId],
  );
  if (res.rows.length === 0) {
    return { ok: false, error: 'Reply target message not found in this ticket' };
  }
  return { ok: true, replyToId };
}

export type ToggleReactionResult =
  | { ok: true; reactions: ReactionMeta[] }
  | { ok: false; status: number; error: string };

/**
 * Set / replace / toggle-off a reaction for one side on a message, then return
 * the message's full reaction list. Runs its own transaction on `client`.
 *
 *  - no existing reaction for this side        -> INSERT
 *  - existing reaction, different emoji         -> UPDATE (replace)
 *  - existing reaction, SAME emoji              -> DELETE (toggle off)
 */
export async function toggleReaction(
  client: PoolClient,
  ticketId: number,
  messageId: number,
  reactorType: ReactorType,
  emoji: string,
): Promise<ToggleReactionResult> {
  try {
    await client.query('BEGIN');

    // Lock the message row + confirm it belongs to the ticket.
    const msg = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM support_ticket_messages WHERE id = $1 AND ticket_id = $2 LIMIT 1 FOR UPDATE;`,
      [messageId, ticketId],
    );
    if (msg.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Message not found' };
    }

    const existing = await client.query<{ emoji: string }>(
      `SELECT emoji FROM support_ticket_message_reactions WHERE message_id = $1 AND reactor_type = $2 LIMIT 1;`,
      [messageId, reactorType],
    );

    if (existing.rows.length > 0 && existing.rows[0].emoji === emoji) {
      // Same emoji tapped again -> remove (toggle off).
      await client.query(
        `DELETE FROM support_ticket_message_reactions WHERE message_id = $1 AND reactor_type = $2;`,
        [messageId, reactorType],
      );
    } else {
      // Insert or replace with the new emoji.
      await client.query(
        `
        INSERT INTO support_ticket_message_reactions (message_id, ticket_id, reactor_type, emoji)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (message_id, reactor_type)
        DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW();
        `,
        [messageId, ticketId, reactorType, emoji],
      );
    }

    const after = await client.query<{ reactor_type: ReactorType; emoji: string }>(
      `SELECT reactor_type, emoji FROM support_ticket_message_reactions WHERE message_id = $1 ORDER BY id ASC;`,
      [messageId],
    );

    await client.query('COMMIT');
    return { ok: true, reactions: after.rows.map((r) => ({ reactor_type: r.reactor_type, emoji: r.emoji })) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
