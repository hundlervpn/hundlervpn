// One-shot migration (v2): evolves the v1 `referral_bonus_transactions`
// table from a single-UNIQUE model (one first-payment bonus per pair) to
// the v2 per-payment model (one bonus per *payment* row).
//
// Why: the user wants referral bonuses on EVERY paid plan, not just the
// friend's first purchase. Idempotency is now anchored to `payments.id`
// (partial UNIQUE index) instead of the (inviter, invitee, 'first_payment')
// tuple.
//
// Usage:
//   node scripts/migrate-referral-bonus-v2.js
//
// Safe to re-run — every step is IF (NOT) EXISTS / DROP CONSTRAINT IF EXISTS.

const { Client } = require('pg');

const conn = process.env.DATABASE_URL
  || `postgresql://gen_user:${encodeURIComponent('HundlerVPN2026Strong')}@132.243.242.196:5432/default_db`;

async function main() {
  const c = new Client({ connectionString: conn, ssl: false });
  await c.connect();
  console.log('Connected to DB.');

  // 1) Add the new `payment_id` column. Nullable — signup bonuses and the
  //    legacy 'first_payment' rows keep NULL; new 'payment' rows reference
  //    the payments row that triggered them.
  await c.query(`
    ALTER TABLE referral_bonus_transactions
      ADD COLUMN IF NOT EXISTS payment_id BIGINT NULL REFERENCES payments(id) ON DELETE SET NULL;
  `);
  console.log('  ✓ payment_id column');

  // 2) Expand the CHECK constraint to accept the new 'payment' type. Postgres
  //    doesn't support `ALTER CONSTRAINT … CHECK` in place, so drop & recreate.
  await c.query(`
    ALTER TABLE referral_bonus_transactions
      DROP CONSTRAINT IF EXISTS referral_bonus_transactions_bonus_type_check;
  `);
  await c.query(`
    ALTER TABLE referral_bonus_transactions
      ADD CONSTRAINT referral_bonus_transactions_bonus_type_check
      CHECK (bonus_type IN ('signup', 'payment', 'first_payment'));
  `);
  console.log('  ✓ bonus_type CHECK now accepts payment');

  // 3) Drop the v1 tuple UNIQUE. Both common auto-generated names handled —
  //    Postgres truncates long identifiers at 63 chars so a generated name
  //    may end in `_i_key` instead of `_id_key`. Either way the IF EXISTS
  //    keeps the migration a no-op when neither is present.
  await c.query(`
    ALTER TABLE referral_bonus_transactions
      DROP CONSTRAINT IF EXISTS referral_bonus_transactions_inviter_user_id_invitee_user_i_key;
  `);
  await c.query(`
    ALTER TABLE referral_bonus_transactions
      DROP CONSTRAINT IF EXISTS referral_bonus_transactions_inviter_user_id_invitee_user_id_bonus_type_key;
  `);
  console.log('  ✓ legacy tuple UNIQUE dropped (if present)');

  // 4) Partial UNIQUE indexes — the v2 uniqueness model.
  await c.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_bonus_signup_unique
      ON referral_bonus_transactions(inviter_user_id, invitee_user_id)
      WHERE bonus_type = 'signup';
  `);
  console.log('  ✓ unique(inviter, invitee) WHERE signup');

  await c.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_bonus_payment_unique
      ON referral_bonus_transactions(payment_id)
      WHERE payment_id IS NOT NULL AND bonus_type = 'payment';
  `);
  console.log('  ✓ unique(payment_id) WHERE payment');

  const stats = await c.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE bonus_type = 'signup')        AS signup,
      COUNT(*) FILTER (WHERE bonus_type = 'payment')       AS payment,
      COUNT(*) FILTER (WHERE bonus_type = 'first_payment') AS first_payment_legacy,
      COALESCE(SUM(bonus_days), 0) AS total_days
    FROM referral_bonus_transactions;
  `);
  console.log('Stats:', stats.rows[0]);

  await c.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
