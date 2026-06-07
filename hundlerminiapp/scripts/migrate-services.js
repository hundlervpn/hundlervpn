const { Client } = require('pg');

const sql = `
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
BEFORE UPDATE ON service_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_service_requests_user_status ON service_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_request_messages_request ON service_request_messages(request_id, created_at);
`;

async function main() {
  const c = new Client({
    host: '132.243.242.196',
    port: 5432,
    user: 'gen_user',
    password: 'HundlerVPN2026Strong',
    database: 'default_db',
  });
  await c.connect();
  console.log('Connected to DB');
  await c.query(sql);
  console.log('Migration applied successfully!');
  await c.end();
}

main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
