-- 2026-06-11: monthly traffic accumulator for the admin Stats tab histogram.
--
-- Why a new table: per-user traffic is only kept as *cumulative counters*
-- (`subscriptions.traffic_used_bytes`, `user_server_traffic.bytes_used` — the
-- latter resets on a rolling 30-day window). Xray ships deltas every 5 min via
-- `xray api statsquery --reset`, so we never persisted a time-bucketed history
-- and CANNOT reconstruct past months. This table accumulates each incoming
-- batch into the current calendar month so the admin can see a monthly
-- "сколько сожрано трафика" histogram going forward.
--
-- `month` is the first day of the month (date_trunc('month', NOW())::date).
-- `bytes_total` is uplink+downlink summed across every server/protocol push.
-- Idempotent / additive: safe to run repeatedly.
CREATE TABLE IF NOT EXISTS traffic_monthly (
  month DATE PRIMARY KEY,
  bytes_total BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
