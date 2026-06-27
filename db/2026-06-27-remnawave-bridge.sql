-- 2026-06-27: Remnawave bridge columns.
-- Maps each local business user (users.id) to its Remnawave panel identity.
-- Business tables (subscriptions/payments/referrals/tickets) are UNCHANGED —
-- Remnawave only owns VPN key generation + node distribution now.
--
--   remnawave_uuid       — Remnawave user UUID (PATCH/DELETE target, by-uuid lookups)
--   remnawave_short_uuid — short id used in the public sub link sub.hundlervpn.xyz/{short}
--   remnawave_synced_at  — last successful upsert/sync to the panel (for drift detection)

ALTER TABLE users ADD COLUMN IF NOT EXISTS remnawave_uuid UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS remnawave_short_uuid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS remnawave_synced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_remnawave_uuid
  ON users(remnawave_uuid) WHERE remnawave_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_remnawave_short_uuid
  ON users(remnawave_short_uuid) WHERE remnawave_short_uuid IS NOT NULL;
