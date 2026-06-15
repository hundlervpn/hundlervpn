CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE,
  username TEXT,
  referral_code TEXT UNIQUE,
  referred_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned', 'expired')),
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason TEXT,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_type TEXT NOT NULL DEFAULT 'telegram' CHECK (auth_type IN ('telegram', 'email'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_auth_type_check' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_auth_type_check;
  END IF;
  ALTER TABLE users ADD CONSTRAINT users_auth_type_check
    CHECK (auth_type IN ('telegram', 'email', 'google'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS plans (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  max_devices INTEGER,
  traffic_limit BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS servers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 443,
  country VARCHAR(10) NOT NULL DEFAULT 'NL',
  public_key TEXT,
  sni TEXT,
  short_id TEXT,
  fingerprint TEXT NOT NULL DEFAULT 'chrome',
  flow TEXT NOT NULL DEFAULT 'xtls-rprx-vision',
  sync_token TEXT,
  api_key TEXT,
  xray_api_port INTEGER DEFAULT 10085,
  last_sync_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE servers ADD COLUMN IF NOT EXISTS port INTEGER NOT NULL DEFAULT 443;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS sni TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS short_id TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS fingerprint TEXT NOT NULL DEFAULT 'chrome';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS flow TEXT NOT NULL DEFAULT 'xtls-rprx-vision';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS sync_token TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS api_key TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS xray_api_port INTEGER DEFAULT 10085;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
-- Display order of servers in client configs. Lower = earlier in list.
-- Default 100 so new servers land after explicitly-ordered ones unless set.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100;

-- 2026-05-11: client-facing hostname (e.g. `de.hundlervpn.xyz`). When NOT
-- NULL, this is what gets baked into VLESS / Hy2 URIs and sing-box / Xray
-- JSON outbounds we hand to the user — so the raw VPS IP never leaks into
-- the client config (better OPSEC; harder for ISPs / DPI to fingerprint
-- a static IP-pinned tunnel). The `host` column stays the IP because
-- per-server traffic accounting (`/api/xray/traffic`) and on-VPS
-- `/opt/xray-traffic.sh` (which uses `hostname -I`) match by IP, and
-- SNI rotation salts its hash with `host`. Use `clientHost(server)`
-- (lib/sub-token.ts) on the server side to read the right value.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS display_host TEXT;

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date > start_date)
);

CREATE TABLE IF NOT EXISTS vpn_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,
  server_id BIGINT REFERENCES servers(id) ON DELETE SET NULL,
  key_uri TEXT NOT NULL,
  key_hash TEXT,
  device_name TEXT,
  device_type TEXT,
  last_connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE vpn_keys ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE vpn_keys ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(16) NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'pending', 'failed')),
  provider TEXT NOT NULL,
  external_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date ON subscriptions(end_date);

CREATE INDEX IF NOT EXISTS idx_vpn_keys_user_active ON vpn_keys(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_vpn_keys_server_id ON vpn_keys(server_id);

CREATE INDEX IF NOT EXISTS idx_payments_user_status ON payments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);

CREATE INDEX IF NOT EXISTS idx_logs_user_created ON logs(user_id, created_at);

CREATE TABLE IF NOT EXISTS promo_codes (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  days INTEGER NOT NULL DEFAULT 0,
  discount_percent INTEGER,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  CONSTRAINT promo_codes_discount_check CHECK (discount_percent IS NULL OR (discount_percent >= 1 AND discount_percent <= 100)),
  CONSTRAINT promo_codes_has_value CHECK (days > 0 OR discount_percent IS NOT NULL)
);

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS discount_percent INTEGER;
ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_days_check;
ALTER TABLE promo_codes ALTER COLUMN days SET DEFAULT 0;
-- 2026-05-13: soft-delete for promos. We no longer DELETE FROM
-- promo_codes from the admin panel because the existing ON DELETE
-- CASCADE on promo_code_uses would erase the entire usage history.
-- Instead we set deleted_at = NOW() and filter it out everywhere the
-- promo must be "usable" (validate, applyPromoCode, list endpoint),
-- but `promo_code_uses` joins still resolve so the activation feed
-- keeps showing the original code.
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_promo_codes_deleted_at ON promo_codes(deleted_at);

CREATE TABLE IF NOT EXISTS promo_code_uses (
  id BIGSERIAL PRIMARY KEY,
  promo_code_id BIGINT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(promo_code_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_code_uses_user ON promo_code_uses(user_id);

CREATE TABLE IF NOT EXISTS email_codes (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  used BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email, used, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_type TEXT CHECK (ban_type IN ('login', 'subscription'));

ALTER TABLE vpn_keys ADD COLUMN IF NOT EXISTS device_os TEXT;
ALTER TABLE vpn_keys ADD COLUMN IF NOT EXISTS device_platform TEXT;

CREATE TABLE IF NOT EXISTS email_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_email_sessions_token ON email_sessions(token, expires_at);

CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin', 'system')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_status ON support_tickets(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_updated ON support_tickets(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_created ON support_ticket_messages(ticket_id, created_at DESC);

-- Read tracking (v56): when a user / admin last opened a ticket. Used to
-- compute unread_count = COUNT(messages WHERE created_at > last_*_read_at
-- AND sender_type != 'user' / 'admin' respectively).
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS last_user_read_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS last_admin_read_at TIMESTAMPTZ;

-- 2026-06-10: photo attachments for support tickets. Stored as BYTEA in
-- Postgres (the Hostman container FS is ephemeral, the managed DB is not).
-- Cascade-deletes with the parent message/ticket.
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

-- 2026-06-16: message-level actions for support tickets (reply + reactions).
-- reply_to_id quotes an earlier message in the same ticket (messenger-style
-- swipe-to-reply / reply button); ON DELETE SET NULL keeps the reply when the
-- quoted message is deleted. Reactions: one emoji per side (user/admin) per
-- message (UNIQUE) — replace on a new emoji, remove on re-tap (API logic).
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

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_plans_set_updated_at ON plans;
CREATE TRIGGER trg_plans_set_updated_at
BEFORE UPDATE ON plans
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_servers_set_updated_at ON servers;
CREATE TRIGGER trg_servers_set_updated_at
BEFORE UPDATE ON servers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_subscriptions_set_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_set_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_support_tickets_set_updated_at ON support_tickets;
CREATE TRIGGER trg_support_tickets_set_updated_at
BEFORE UPDATE ON support_tickets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS broadcasts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  message TEXT NOT NULL,
  image_url TEXT,
  button_text TEXT,
  button_url TEXT,
  target_telegram_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  total_users INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS target_telegram_id BIGINT;

-- v65 (2026-04-28): broadcast audience filter — admin selects WHO receives:
--   'all'                — every user with telegram_id (legacy default)
--   'active'             — users with an active, non-expired subscription
--   'no_sub'             — users WITHOUT an active subscription
--   'active_no_devices'  — users with an active subscription but ZERO live
--                          device_sessions (kicked_at IS NULL). Targets
--                          users who paid but never finished the VPN
--                          install/setup flow. Added 2026-05-05.
-- target_telegram_id (single user) takes precedence over target_audience when set.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS target_audience TEXT
  NOT NULL DEFAULT 'all'
  CHECK (target_audience IN ('all', 'active', 'no_sub', 'active_no_devices'));

-- 2026-05-05: extend the audience CHECK constraint on existing prod DBs that
-- were created before 'active_no_devices' was added. ADD COLUMN IF NOT EXISTS
-- above only takes effect for fresh installs; old rows keep the old CHECK.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'broadcasts'
      AND c.conname = 'broadcasts_target_audience_check'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%active_no_devices%'
  ) THEN
    ALTER TABLE broadcasts DROP CONSTRAINT broadcasts_target_audience_check;
    ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_target_audience_check
      CHECK (target_audience IN ('all', 'active', 'no_sub', 'active_no_devices'));
  END IF;
END $$;

-- 2026-05-05: broadcast inline-button kind. Lets the admin send a button
-- that opens the Mini App (with optional auto-promo-apply) instead of a
-- raw URL. Three kinds:
--   'url'   — plain URL (legacy default; uses button_url column).
--   'app'   — opens the Telegram Mini App via t.me/<bot>?startapp=open.
--             button_url is ignored.
--   'promo' — opens the Mini App with a `promo_<CODE>` start_param so the
--             frontend boot effect auto-applies the promo via
--             /api/promos/apply. button_promo_code holds the CODE.
-- 2026-06-11: uploaded broadcast image stored as BYTEA in Postgres (instead
-- of / in addition to image_url). Same rationale as ticket attachments —
-- the Hostman container FS is wiped on redeploy, so we can't keep files on
-- disk. When an admin uploads a file we store the bytes here and set
-- image_url to our public serving route (/api/broadcasts/<id>/image) so the
-- bot's existing URLInputFile(image_url) flow keeps working unchanged.
-- image_url alone (a remote link) still works for the legacy URL path.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS image_data BYTEA;
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS image_mime TEXT;

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS button_kind TEXT
  NOT NULL DEFAULT 'url'
  CHECK (button_kind IN ('url', 'app', 'promo'));
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS button_promo_code TEXT;

CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status, created_at DESC);

-- 2026-05-05: tracking which subscription-related reminders have already
-- been sent to a user. Prevents duplicate nags when the cron runs multiple
-- times per day. One row per (subscription, reminder kind) pair.
--
-- kind values currently in use:
--   'expiring_1d' — subscription end_date is within 24h; sent once per sub.
--
-- Add new kinds (e.g. 'expiring_3d', 'expired') by INSERTing with a fresh
-- kind value — the UNIQUE constraint still works because kind is part of
-- the key. No schema change needed for new reminder types.
CREATE TABLE IF NOT EXISTS subscription_reminders (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Telegram send result: true when sendMessage returned 200, false on
  -- API error (user blocked the bot, chat not found, etc.). We write this
  -- row regardless of the delivery result so the cron never retries a
  -- hopeless send.
  delivered BOOLEAN NOT NULL DEFAULT TRUE,
  error_text TEXT,
  UNIQUE(subscription_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_subscription_reminders_user_kind
  ON subscription_reminders(user_id, kind);

CREATE TABLE IF NOT EXISTS fragment_prices (
  id BIGSERIAL PRIMARY KEY,
  product_type TEXT NOT NULL CHECK (product_type IN ('stars', 'premium')),
  period TEXT NOT NULL,
  stars_amount INTEGER,
  price_rub NUMERIC(12, 2) NOT NULL,
  original_price_rub NUMERIC(12, 2),
  discount_percent INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_type, period)
);

CREATE TABLE IF NOT EXISTS fragment_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('stars', 'premium')),
  period TEXT NOT NULL,
  stars_amount INTEGER,
  price_rub NUMERIC(12, 2) NOT NULL,
  telegram_username TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'processing', 'completed', 'failed')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_fragment_prices_set_updated_at ON fragment_prices;
CREATE TRIGGER trg_fragment_prices_set_updated_at
BEFORE UPDATE ON fragment_prices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_fragment_orders_set_updated_at ON fragment_orders;
CREATE TRIGGER trg_fragment_orders_set_updated_at
BEFORE UPDATE ON fragment_orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_fragment_orders_user_status ON fragment_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_fragment_orders_status ON fragment_orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_app_settings_set_updated_at ON app_settings;
CREATE TRIGGER trg_app_settings_set_updated_at
BEFORE UPDATE ON app_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

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
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_service_requests_user_status ON service_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_request_messages_request ON service_request_messages(request_id, created_at);

-- ============================================================================
-- UUID Pool — pre-allocated VLESS UUIDs loaded into Xray config ahead of time.
-- ----------------------------------------------------------------------------
-- Why: Xray needs a server restart whenever clients change. Adding a UUID on
-- user signup triggers restart → all active connections drop for 5-15s.
-- Instead we keep a large pool of UUIDs ALREADY loaded in Xray and assign
-- them to users on demand (no restart needed — UUID is already known to Xray).
-- ----------------------------------------------------------------------------
-- Flow:
--   • Admin pre-generates N UUIDs (N=1000) → inserts into uuid_pool
--   • Xray config includes ALL pool UUIDs as clients (with placeholder emails)
--   • User signs up → SELECT free uuid → mark assigned_to_key_id
--   • Device removed → assigned_to_key_id = NULL (UUID returns to pool)
--   • Watchdog refills pool when free < 20 (rare — one restart for +50)
-- ============================================================================
CREATE TABLE IF NOT EXISTS uuid_pool (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL UNIQUE,
  assigned_to_key_id BIGINT REFERENCES vpn_keys(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at TIMESTAMPTZ
);

-- Partial index on free UUIDs only (speeds up "get next free UUID" queries)
CREATE INDEX IF NOT EXISTS idx_uuid_pool_free
  ON uuid_pool(id) WHERE assigned_to_key_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_uuid_pool_assigned
  ON uuid_pool(assigned_to_key_id) WHERE assigned_to_key_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS device_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash VARCHAR(255) NOT NULL,
  device_name TEXT,
  ip_address TEXT,
  user_agent TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device_hash)
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_lastseen ON device_sessions(user_id, last_seen_at DESC);

ALTER TABLE device_sessions ADD COLUMN IF NOT EXISTS vpn_key_id BIGINT REFERENCES vpn_keys(id) ON DELETE SET NULL;

-- Device kick enforcement (2026-04-19, v41).
-- When a user removes a device from the UI:
--   1. `kicked_at = NOW()` on the session row (don't delete — blocks re-registration).
--   2. Session's `vpn_key_id` is cleared; the corresponding UUID is DELETED from
--      `uuid_pool` (hard purge, not release). On the next Xray sync, Xray gets
--      a config without that UUID → restart rejects the kicked device's cached VLESS link.
-- Rank calculation and UI listings must exclude rows where `kicked_at IS NOT NULL`.
ALTER TABLE device_sessions ADD COLUMN IF NOT EXISTS kicked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_device_sessions_kicked ON device_sessions(user_id, kicked_at) WHERE kicked_at IS NOT NULL;

-- Traffic limit enforcement: track bytes used per subscription.
-- traffic_limit on plans is in bytes (1000 GB = 1000000000000).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS traffic_used_bytes BIGINT NOT NULL DEFAULT 0;

-- Set default 1000 GB traffic limit on all plans that don't have one yet.
UPDATE plans SET traffic_limit = 1000000000000 WHERE traffic_limit IS NULL;

-- 2026-06-11: monthly traffic accumulator for the admin Stats histogram.
-- Cumulative counters (subscriptions.traffic_used_bytes, user_server_traffic)
-- can't be split by month after the fact — Xray ships resettable deltas every
-- 5 min — so `/api/xray/traffic` increments the current month's bucket here on
-- every push. `month` = first day of month; `bytes_total` = uplink+downlink.
CREATE TABLE IF NOT EXISTS traffic_monthly (
  month DATE PRIMARY KEY,
  bytes_total BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────────────
-- Referral bonus journal (2026-05-03, v2 2026-05-04).
--
-- Why: historically referral bonuses just extended `subscriptions.end_date`
-- or created a new row with a bonus plan. That made it impossible to tell
-- a user "this chunk of days came from friend X" because the credit was
-- merged into their active subscription.
--
-- This table journals every bonus grant so the UI can list invitees + the
-- total days each one contributed. It's append-only; deletes cascade when
-- either side of the relation is removed so we never point at ghost rows.
--
-- `bonus_type`:
--   - 'signup'        → +REFERRAL_SIGNUP_BONUS_DAYS (3, since 2026-05-22)
--                        when an invitee registers.
--                        1-per-(inviter,invitee) pair via partial UNIQUE index.
--   - 'payment'       → tiered +7/+14/+21 on EVERY paid plan ≥ 30 days.
--                        Fired from applyReferralReward on every successful
--                        SBP/crypto/Telegram-Stars payment; idempotency is
--                        enforced by a partial UNIQUE(payment_id).
--   - 'first_payment' → LEGACY tier from the initial rollout (2026-05-03).
--                        Kept in the CHECK so existing rows stay valid, but
--                        new code no longer writes rows of this type.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_bonus_transactions (
  id BIGSERIAL PRIMARY KEY,
  inviter_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bonus_type TEXT NOT NULL CHECK (bonus_type IN ('signup', 'payment', 'first_payment')),
  bonus_days INT NOT NULL CHECK (bonus_days > 0),
  -- FK to the `payments` row that triggered this bonus (NULL for signup/legacy
  -- rows). Combined with the partial UNIQUE index below, guarantees we never
  -- double-credit the inviter even if an upstream payment gateway retries the
  -- confirmation webhook.
  payment_id BIGINT NULL REFERENCES payments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-time cleanup for DBs that had the v1 constraint before we switched to
-- the per-payment model. The v1 name is what Postgres auto-assigned to the
-- tuple UNIQUE; v2 drops it in favour of the two partial indexes below.
ALTER TABLE referral_bonus_transactions
  DROP CONSTRAINT IF EXISTS referral_bonus_transactions_inviter_user_id_invitee_user_i_key;
ALTER TABLE referral_bonus_transactions
  DROP CONSTRAINT IF EXISTS referral_bonus_transactions_inviter_user_id_invitee_user_id_bonus_type_key;

-- Defensive ALTERs so schema.sql stays idempotent across both fresh installs
-- and legacy DBs that already have the v1 table shape.
ALTER TABLE referral_bonus_transactions
  ADD COLUMN IF NOT EXISTS payment_id BIGINT NULL REFERENCES payments(id) ON DELETE SET NULL;
ALTER TABLE referral_bonus_transactions
  DROP CONSTRAINT IF EXISTS referral_bonus_transactions_bonus_type_check;
ALTER TABLE referral_bonus_transactions
  ADD CONSTRAINT referral_bonus_transactions_bonus_type_check
  CHECK (bonus_type IN ('signup', 'payment', 'first_payment'));

-- Exactly one 'signup' bonus per (inviter, invitee) pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_bonus_signup_unique
  ON referral_bonus_transactions(inviter_user_id, invitee_user_id)
  WHERE bonus_type = 'signup';

-- Exactly one 'payment' bonus per payment row — payment gateway retries are
-- a no-op thanks to ON CONFLICT (payment_id) DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_bonus_payment_unique
  ON referral_bonus_transactions(payment_id)
  WHERE payment_id IS NOT NULL AND bonus_type = 'payment';

CREATE INDEX IF NOT EXISTS idx_referral_bonus_inviter
  ON referral_bonus_transactions(inviter_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_bonus_invitee
  ON referral_bonus_transactions(invitee_user_id);

-- Backfill signup bonuses for users who were already referred before this
-- table existed. ON CONFLICT DO NOTHING against the partial signup index
-- keeps re-runs a no-op. Paid-plan bonuses are NOT backfilled — we don't
-- know which historic payments should have triggered them; journaling
-- starts from this migration onwards.
INSERT INTO referral_bonus_transactions (inviter_user_id, invitee_user_id, bonus_type, bonus_days, created_at)
SELECT u.referred_by_user_id, u.id, 'signup', 5, u.created_at
FROM users u
WHERE u.referred_by_user_id IS NOT NULL
  AND u.referred_by_user_id <> u.id
ON CONFLICT (inviter_user_id, invitee_user_id) WHERE bonus_type = 'signup' DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- Daily / Super Boxes (2026-05-21).
--
-- Per-user state for the daily-reward box mini-game. One row per user;
-- `current_streak` counts consecutive days the box was opened, `total_opens`
-- is the lifetime counter, `last_opened_at` is the timestamp of the most
-- recent open, `next_available_at` is when the cooldown lifts.
--
-- Streak rules (enforced server-side in lib/boxes.ts):
--   * Cooldown: 24h between opens.
--   * If the user lets the cooldown lapse for more than 48h after
--     last_opened_at — i.e. they missed an entire day — the streak
--     resets to 1 on the next open.
--   * Every open whose post-increment streak is a multiple of 7 gets a
--     `super` box with weighted-up rewards.
--
-- box_rewards is an append-only ledger of every opening; the UI's history
-- timeline reads it in DESC order. `applied_subscription_id` points at the
-- subscriptions row whose end_date got extended by this reward (NULL for
-- non-days reward kinds, currently unused but reserved for future variants).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS box_user_state (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  total_opens INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  next_available_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_box_user_state_set_updated_at ON box_user_state;
CREATE TRIGGER trg_box_user_state_set_updated_at
BEFORE UPDATE ON box_user_state
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS box_rewards (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  box_kind TEXT NOT NULL CHECK (box_kind IN ('daily', 'super')),
  reward_kind TEXT NOT NULL CHECK (reward_kind IN ('subscription_hours', 'subscription_days', 'discount_coupon')),
  reward_value INTEGER NOT NULL CHECK (reward_value > 0),
  streak_at_open INTEGER NOT NULL CHECK (streak_at_open > 0),
  applied_subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_box_rewards_user_created
  ON box_rewards(user_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- Referral CASH balance + withdrawal flow (2026-05-22).
--
-- Sits ALONGSIDE the day-based referral_bonus_transactions ledger above.
-- Both keep working in parallel: every referred-user payment grants the
-- inviter BOTH a few bonus days (existing) AND 10% of the RUB amount as
-- cash on users.referral_balance_rub (this section).
--
-- Withdrawal model: user submits a request (min 500 ₽) with a destination
-- (SBP card / crypto / Telegram Stars username). The amount is debited
-- from referral_balance_rub at request time; admin processes manually
-- through a chat thread. If status flips to rejected/cancelled the funds
-- are credited back to the user (handled in the application layer, see
-- /api/users/withdrawals).
--
-- See db/migrations/2026-05-22-referral-cash.sql for the standalone
-- migration file (idempotent — safe to re-run on prod).
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_balance_rub NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (referral_balance_rub >= 0);

CREATE TABLE IF NOT EXISTS referral_balance_transactions (
  id                 BIGSERIAL PRIMARY KEY,
  inviter_user_id    BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id    BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id         BIGINT           REFERENCES payments(id) ON DELETE SET NULL,
  payment_amount_rub NUMERIC(12, 2) NOT NULL CHECK (payment_amount_rub > 0),
  percent            NUMERIC(5, 2)  NOT NULL DEFAULT 10.00 CHECK (percent > 0 AND percent <= 100),
  amount_rub         NUMERIC(12, 2) NOT NULL CHECK (amount_rub > 0),
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CHECK (inviter_user_id <> invitee_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_balance_payment_unique
  ON referral_balance_transactions (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_balance_inviter_created
  ON referral_balance_transactions (inviter_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_balance_invitee
  ON referral_balance_transactions (invitee_user_id);

CREATE TABLE IF NOT EXISTS referral_withdrawals (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_rub           NUMERIC(12, 2) NOT NULL CHECK (amount_rub >= 500),
  method               TEXT    NOT NULL CHECK (method IN ('sbp_card', 'crypto', 'telegram_stars')),
  destination          JSONB   NOT NULL DEFAULT '{}'::jsonb,
  status               TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'in_progress', 'paid', 'rejected', 'cancelled')),
  payout_note          TEXT,
  processed_at         TIMESTAMPTZ,
  processed_by_user_id BIGINT  REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_withdrawals_user_created
  ON referral_withdrawals (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_withdrawals_status_created
  ON referral_withdrawals (status, created_at DESC);

DROP TRIGGER IF EXISTS trg_referral_withdrawals_set_updated_at ON referral_withdrawals;
CREATE TRIGGER trg_referral_withdrawals_set_updated_at
BEFORE UPDATE ON referral_withdrawals
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS referral_withdrawal_messages (
  id              BIGSERIAL PRIMARY KEY,
  withdrawal_id   BIGINT NOT NULL REFERENCES referral_withdrawals(id) ON DELETE CASCADE,
  author_user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role     TEXT   NOT NULL CHECK (author_role IN ('user', 'admin', 'system')),
  body            TEXT   NOT NULL CHECK (LENGTH(body) BETWEEN 1 AND 4000),
  attachment_url  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_messages_thread
  ON referral_withdrawal_messages (withdrawal_id, created_at);
