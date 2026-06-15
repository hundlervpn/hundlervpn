-- 2026-06-16: message-level actions for support tickets (reply + reactions).
--
-- Adds messenger-style reply (quote an earlier message) and one-emoji-per-side
-- reactions to the support-ticket chat (mini-app + admin).
--
-- reply_to_id: self-reference on support_ticket_messages. ON DELETE SET NULL so
-- deleting a quoted message keeps the reply, just drops the dangling quote.
--
-- support_ticket_message_reactions: one emoji per side (user/admin) per message
-- (UNIQUE (message_id, reactor_type)). The API replaces the row on a new emoji
-- and deletes it when the same emoji is tapped again (toggle off).
--
-- Idempotent — safe to re-run. Also lives in app/api/admin/migrate/route.ts.

ALTER TABLE support_ticket_messages
  ADD COLUMN IF NOT EXISTS reply_to_id BIGINT REFERENCES support_ticket_messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_reply_to
  ON support_ticket_messages(reply_to_id);

CREATE TABLE IF NOT EXISTS support_ticket_message_reactions (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES support_ticket_messages(id) ON DELETE CASCADE,
  ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  reactor_type TEXT NOT NULL CHECK (reactor_type IN ('user', 'admin')),
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, reactor_type)
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_message_reactions_message
  ON support_ticket_message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_message_reactions_ticket
  ON support_ticket_message_reactions(ticket_id);
