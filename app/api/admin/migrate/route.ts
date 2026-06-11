import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

const migrationSQL = `
CREATE TABLE IF NOT EXISTS service_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(12, 2),
  currency VARCHAR(16) NOT NULL DEFAULT 'RUB',
  payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'awaiting_payment', 'paid', 'processing', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_request_messages (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_service_requests_set_updated_at ON service_requests;
CREATE TRIGGER trg_service_requests_set_updated_at
BEFORE UPDATE ON service_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_service_requests_user_status ON service_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_request_messages_request ON service_request_messages(request_id, created_at);

-- v41 (2026-04-19): per-session UUIDs + device kick enforcement.
-- kicked_at marks sessions whose device was explicitly removed from the UI;
-- rank/listing queries exclude these rows so the kicked device's hash can
-- never reclaim a slot (abuse prevention).
ALTER TABLE device_sessions ADD COLUMN IF NOT EXISTS kicked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_device_sessions_kicked ON device_sessions(user_id, kicked_at) WHERE kicked_at IS NOT NULL;

-- 2026-05-13: soft-delete for promos.
-- The DELETE button in the admin panel no longer wipes promo_code_uses
-- (FK is ON DELETE CASCADE) — instead we mark promo_codes.deleted_at and
-- filter it out everywhere a promo must be "usable". The activation feed
-- joins promo_code_uses → promo_codes and keeps showing the original
-- code. Idempotent.
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_promo_codes_deleted_at ON promo_codes(deleted_at);

-- 2026-06-10: photo attachments for support tickets (BYTEA in Postgres,
-- not S3/disk — the Hostman container FS is wiped on redeploy). Cascade
-- deletes with the parent message/ticket. Idempotent.
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
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_message ON support_ticket_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket ON support_ticket_attachments(ticket_id);

-- 2026-06-11: uploaded broadcast image (BYTEA in Postgres, same reasoning as
-- ticket attachments — container FS is wiped on redeploy). When set, the
-- broadcasts POST stores bytes here and points image_url at the public
-- serving route (/api/broadcasts/<id>/image) so the bot's URLInputFile flow
-- is unchanged. Idempotent.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS image_data BYTEA;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS image_mime TEXT;
`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, action, targetTelegramId } = body;
    if (!telegramId || !ADMIN_TELEGRAM_IDS.includes(Number(telegramId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();

    // Admin action: clear all kicked_at flags for a specific user (or the
    // admin themselves if no targetTelegramId). Use this after accidental
    // kicks in tests, or to "un-block" a user who kicked all their devices
    // and now can't re-register them.
    if (action === 'unkick') {
      const target = Number(targetTelegramId ?? telegramId);
      const res = await pool.query(
        `UPDATE device_sessions ds
            SET kicked_at = NULL
          FROM users u
          WHERE ds.user_id = u.id
            AND u.telegram_id = $1
            AND ds.kicked_at IS NOT NULL
          RETURNING ds.id`,
        [target],
      );
      return NextResponse.json({
        ok: true,
        message: `Un-kicked ${res.rowCount} session(s) for telegramId=${target}`,
        affected: res.rowCount,
      });
    }

    // Default action: apply schema migrations.
    await pool.query(migrationSQL);
    return NextResponse.json({ ok: true, message: 'Migration applied successfully' });
  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json({ error: error.message || 'Migration failed' }, { status: 500 });
  }
}
