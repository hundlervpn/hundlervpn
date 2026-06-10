-- 2026-06-10: photo attachments for support tickets.
--
-- Stored as BYTEA directly in Postgres (NOT S3 / local disk). Rationale:
-- the app runs as a stateless Docker container on Hostman with NO mounted
-- volume, so anything written to the container filesystem is wiped on every
-- redeploy. The managed Postgres IS persistent, so bytea is the only
-- no-extra-infra option that survives deploys. Volume is small (few users,
-- images capped at 5 MB) and rows cascade-delete with their ticket/message,
-- which matches the owner's "I just delete chats and the photos go too"
-- mental model.
--
-- One row per attached image. A message may carry 0..N images.
CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES support_ticket_messages(id) ON DELETE CASCADE,
  ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  file_name TEXT,
  byte_size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_message
  ON support_ticket_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket
  ON support_ticket_attachments(ticket_id);
