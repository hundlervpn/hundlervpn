-- ────────────────────────────────────────────────────────────────────────────
-- Boxes v3 migration (2026-05-21 night).
--
-- Adds 'discount_coupon' to the reward_kind CHECK so coupon-style rewards
-- can be persisted in box_rewards.metadata. Coupons themselves live in
-- promo_codes — issued by openBox() with max_uses=1 and 24h expiry.
--
-- Resets the admin tester's state so they can re-roll on the new mixed
-- pool without the previous cooldown.
-- Idempotent.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE box_rewards DROP CONSTRAINT IF EXISTS box_rewards_reward_kind_check;
ALTER TABLE box_rewards
  ADD CONSTRAINT box_rewards_reward_kind_check
  CHECK (reward_kind IN ('subscription_hours', 'subscription_days', 'discount_coupon'));

DELETE FROM box_user_state
 WHERE user_id IN (
   SELECT id FROM users WHERE telegram_id IN (2029065770, 1483598839)
 );
