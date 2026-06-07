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
--
-- This file is a standalone migration extracted from schema.sql so it can
-- be applied to existing prod databases without re-running the whole
-- schema. Idempotent — safe to re-run.
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
  reward_kind TEXT NOT NULL CHECK (reward_kind IN ('subscription_days')),
  reward_value INTEGER NOT NULL CHECK (reward_value > 0),
  streak_at_open INTEGER NOT NULL CHECK (streak_at_open > 0),
  applied_subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_box_rewards_user_created
  ON box_rewards(user_id, created_at DESC);
