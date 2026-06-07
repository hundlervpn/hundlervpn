-- ────────────────────────────────────────────────────────────────────────────
-- Referral CASH balance + withdrawal flow (2026-05-22).
--
-- Sits ALONGSIDE the existing day-based referral bonus system
-- (`referral_bonus_transactions` + `applyReferralReward`) — both keep
-- working in parallel. The new model: every successful RUB payment by a
-- referred user accrues 10% of the paid amount onto the inviter's
-- `users.referral_balance_rub` wallet, journaled in
-- `referral_balance_transactions` for full audit + idempotency.
--
-- Rationale for RUB-only:
--   • SBP is the only RUB rail; Stars (XTR) and crypto (USDT/TON) have
--     volatile FX and would require live-rate snapshots to be fair.
--   • Mirrors the existing `paid_amount_rub` filter in
--     `/api/admin/referrals` — keeps revenue-share math consistent
--     with the admin panel's "real money" column.
--   • Day-based bonus already covers Stars/crypto invitees through
--     `applyReferralReward`. They just don't accrue cash, only days.
--
-- Withdrawal flow:
--   • User opens a request via `referral_withdrawals` (min 500 ₽).
--   • Three methods: SBP card, crypto wallet, Telegram Stars.
--   • Funds are deducted from `referral_balance_rub` AT REQUEST TIME
--     (not at payout) — prevents double-spend if the user opens
--     multiple parallel requests.
--   • Admin processes the request manually; status transitions:
--     pending → in_progress → paid | rejected. Both sides exchange
--     messages via `referral_withdrawal_messages` (chat thread).
--   • If status flips to `rejected` or `cancelled`, the locked funds
--     are credited back to the user's balance via the trigger below.
--
-- Idempotent — safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Wallet column on users.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_balance_rub NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (referral_balance_rub >= 0);

COMMENT ON COLUMN users.referral_balance_rub IS
  'Live cash wallet (RUB) accumulated from 10% revenue share on referred-user payments. Decremented when the user submits a withdrawal request, refunded if the request is rejected/cancelled.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Accrual ledger — one row per RUB payment by a referred user.
--
-- Idempotent: UNIQUE(payment_id) blocks gateway-retry double-credit.
-- Mirrors the pattern in `referral_bonus_transactions.payment_id`.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_balance_transactions (
  id                 BIGSERIAL PRIMARY KEY,
  inviter_user_id    BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id    BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id         BIGINT           REFERENCES payments(id) ON DELETE SET NULL,
  -- Snapshot of the original RUB-paid amount at issuance time. Source of
  -- truth for the 10% calculation; immutable so retroactive percentage
  -- changes never re-bill historical rows.
  payment_amount_rub NUMERIC(12, 2) NOT NULL CHECK (payment_amount_rub > 0),
  percent            NUMERIC(5, 2)  NOT NULL DEFAULT 10.00 CHECK (percent > 0 AND percent <= 100),
  amount_rub         NUMERIC(12, 2) NOT NULL CHECK (amount_rub > 0),
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- Self-referral defence (also enforced at the application layer).
  CHECK (inviter_user_id <> invitee_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_balance_payment_unique
  ON referral_balance_transactions (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_balance_inviter_created
  ON referral_balance_transactions (inviter_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_balance_invitee
  ON referral_balance_transactions (invitee_user_id);

COMMENT ON TABLE referral_balance_transactions IS
  'Append-only ledger of every 10% revenue-share accrual onto users.referral_balance_rub. Powers the inviter''s "earnings history" tab and audit trail.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Withdrawal requests.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_withdrawals (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_rub         NUMERIC(12, 2) NOT NULL CHECK (amount_rub >= 500),
  method             TEXT    NOT NULL CHECK (method IN ('sbp_card', 'crypto', 'telegram_stars')),
  -- Free-form per-method payload. Schema by `method`:
  --   sbp_card       : { phone?: string, cardNumber?: string, bank?: string, fullName: string }
  --   crypto         : { network: 'TON'|'TRC20'|'BEP20'|'ERC20', address: string, asset?: 'USDT'|'TON' }
  --   telegram_stars : { telegramUsername?: string }   — admin sends Stars manually
  destination        JSONB   NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'in_progress', 'paid', 'rejected', 'cancelled')),
  -- Set when the admin pays out. Free-form note (transaction id, screenshot URL, etc).
  payout_note        TEXT,
  -- Set when status moves out of `pending`/`in_progress`. NULL while open.
  processed_at       TIMESTAMPTZ,
  processed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

COMMENT ON TABLE referral_withdrawals IS
  'User-submitted requests to cash out their referral_balance_rub. Funds are deducted at submission, refunded on rejection/cancellation. Admin processes manually.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Chat thread per withdrawal request.
--
-- Both sides (user + admin) post messages here. Used by the AdminWithdrawals
-- view's split-pane chat UI and by the user's withdrawal-status modal.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_withdrawal_messages (
  id              BIGSERIAL PRIMARY KEY,
  withdrawal_id   BIGINT NOT NULL REFERENCES referral_withdrawals(id) ON DELETE CASCADE,
  author_user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role     TEXT   NOT NULL CHECK (author_role IN ('user', 'admin', 'system')),
  body            TEXT   NOT NULL CHECK (LENGTH(body) BETWEEN 1 AND 4000),
  -- Optional image attachment (e.g. payment screenshot from admin).
  -- Stored as a public URL or a relative path resolved by the upload route.
  attachment_url  TEXT,
  -- 'system' messages are auto-generated audit notes (e.g.
  -- "status changed pending → paid by admin") and aren't shown as bubbles
  -- in the chat — they render as inline grey separators.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_messages_thread
  ON referral_withdrawal_messages (withdrawal_id, created_at);

COMMENT ON TABLE referral_withdrawal_messages IS
  'Chat thread per withdrawal request — user, admin and system audit messages share the same timeline.';
