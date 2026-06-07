-- ────────────────────────────────────────────────────────────────────────────
-- Boxes v2 migration (2026-05-21 evening).
--
-- Switches reward_kind CHECK to accept 'subscription_hours' (the new
-- canonical unit) alongside legacy 'subscription_days' (rows from the
-- first afternoon prod run we keep for audit). Resets the admin tester's
-- state so they can re-roll under the new tables.
--
-- Idempotent — safe to re-run. The ALTER ... DROP CONSTRAINT IF EXISTS
-- guards the second run; the second ADD CONSTRAINT is also idempotent
-- because we DROP it first.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE box_rewards DROP CONSTRAINT IF EXISTS box_rewards_reward_kind_check;
ALTER TABLE box_rewards
  ADD CONSTRAINT box_rewards_reward_kind_check
  CHECK (reward_kind IN ('subscription_hours', 'subscription_days'));

-- Wipe the admin's existing state + rewards so they can test the new
-- balance from scratch. Production has no real users on this table yet
-- (admin-only beta) so this is safe; if you ever apply this to a DB with
-- real users, comment these DELETEs out first.
DELETE FROM box_rewards
 WHERE user_id IN (
   SELECT id FROM users WHERE telegram_id IN (2029065770, 1483598839)
 );
DELETE FROM box_user_state
 WHERE user_id IN (
   SELECT id FROM users WHERE telegram_id IN (2029065770, 1483598839)
 );
