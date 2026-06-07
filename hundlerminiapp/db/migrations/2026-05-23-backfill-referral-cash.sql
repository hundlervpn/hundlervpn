-- ────────────────────────────────────────────────────────────────────────────
-- One-shot backfill of referral_balance_rub + referral_balance_transactions
-- for historical RUB payments processed BEFORE the cash flow shipped on
-- 2026-05-22. Mirrors lib/referral-cash.ts:applyReferralCashReward exactly.
--
-- Idempotent: the partial UNIQUE(payment_id) on
-- referral_balance_transactions makes ON CONFLICT DO NOTHING short-circuit
-- any payment that has already been credited. The wallet UPDATE is gated
-- by the SAME journal insert via a RETURNING-driven CTE — so wallets only
-- bump for rows that actually wrote a new ledger entry.
--
-- Run with:
--   psql ... -f db/migrations/2026-05-23-backfill-referral-cash.sql
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

WITH candidates AS (
  SELECT
    p.id   AS payment_id,
    p.user_id,
    u.referred_by_user_id AS inviter_id,
    p.amount AS payment_amount_rub,
    -- Match the JS rounding in lib/referral-cash.ts:
    --   Math.round((amount * 10) / 100 * 100) / 100
    -- Postgres ROUND(numeric, 2) is equivalent for HALF_UP, which JS
    -- Math.round also uses for positive numbers. Good enough here.
    ROUND((p.amount * 10.0) / 100.0, 2) AS accrual_rub
  FROM payments p
  JOIN users u ON u.id = p.user_id
  WHERE p.status = 'paid'
    AND p.currency = 'RUB'
    AND u.referred_by_user_id IS NOT NULL
    AND u.referred_by_user_id <> p.user_id
),
inserted AS (
  INSERT INTO referral_balance_transactions
    (inviter_user_id, invitee_user_id, payment_id, payment_amount_rub, percent, amount_rub)
  SELECT
    c.inviter_id,
    c.user_id,
    c.payment_id,
    c.payment_amount_rub,
    10.00,
    c.accrual_rub
  FROM candidates c
  WHERE c.accrual_rub > 0
  ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
  RETURNING inviter_user_id, amount_rub
),
wallet_bumps AS (
  SELECT inviter_user_id, SUM(amount_rub) AS total_credit
    FROM inserted
   GROUP BY inviter_user_id
),
applied AS (
  UPDATE users u
     SET referral_balance_rub = u.referral_balance_rub + wb.total_credit
    FROM wallet_bumps wb
   WHERE u.id = wb.inviter_user_id
   RETURNING u.id AS inviter_user_id, wb.total_credit, u.referral_balance_rub AS new_balance
)
SELECT
  inviter_user_id,
  total_credit,
  new_balance
FROM applied
ORDER BY total_credit DESC;

COMMIT;

-- Sanity check — list all wallets with non-zero balance after backfill.
SELECT
  u.id,
  u.telegram_id,
  u.username,
  u.referral_balance_rub
FROM users u
WHERE u.referral_balance_rub > 0
ORDER BY u.referral_balance_rub DESC;
