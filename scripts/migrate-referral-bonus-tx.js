// One-shot migration: introduces `referral_bonus_transactions` and backfills
// the historic +5 signup bonus for users who already have referred_by_user_id
// set. Idempotent — safe to re-run.
//
// Usage:
//   node scripts/migrate-referral-bonus-tx.js
//
// Why this exists:
//   Until now referral bonuses were silently merged into the inviter's
//   `subscriptions.end_date`, so we couldn't say "friend X gave you N days".
//   The new table journals every grant. The Mini App's referral modal reads
//   from it via GET /api/users/referrals.

const { Client } = require('pg');

const conn = process.env.DATABASE_URL
  || `postgresql://gen_user:${encodeURIComponent('HundlerVPN2026Strong')}@132.243.242.196:5432/default_db`;

async function main() {
  const c = new Client({ connectionString: conn, ssl: false });
  await c.connect();
  console.log('Connected to DB.');

  await c.query(`
    CREATE TABLE IF NOT EXISTS referral_bonus_transactions (
      id BIGSERIAL PRIMARY KEY,
      inviter_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bonus_type TEXT NOT NULL CHECK (bonus_type IN ('signup', 'first_payment')),
      bonus_days INT NOT NULL CHECK (bonus_days > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(inviter_user_id, invitee_user_id, bonus_type)
    );
  `);
  console.log('  ✓ table referral_bonus_transactions');

  await c.query(`
    CREATE INDEX IF NOT EXISTS idx_referral_bonus_inviter
      ON referral_bonus_transactions(inviter_user_id, created_at DESC);
  `);
  await c.query(`
    CREATE INDEX IF NOT EXISTS idx_referral_bonus_invitee
      ON referral_bonus_transactions(invitee_user_id);
  `);
  console.log('  ✓ indexes');

  // Backfill signup bonuses for users referred BEFORE this table existed.
  // Uses ON CONFLICT DO NOTHING so a re-run is a no-op. First-payment bonuses
  // are NOT backfilled — current schema doesn't expose enough history to tell
  // which payment counted as the "first one"; those will be journaled going
  // forward via applyReferralReward().
  const r = await c.query(`
    INSERT INTO referral_bonus_transactions (inviter_user_id, invitee_user_id, bonus_type, bonus_days, created_at)
    SELECT u.referred_by_user_id, u.id, 'signup', 5, u.created_at
    FROM users u
    WHERE u.referred_by_user_id IS NOT NULL
      AND u.referred_by_user_id <> u.id
    ON CONFLICT (inviter_user_id, invitee_user_id, bonus_type) DO NOTHING;
  `);
  console.log(`  ✓ backfill: inserted ${r.rowCount} signup-bonus rows`);

  const stats = await c.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE bonus_type = 'signup') AS signup,
      COUNT(*) FILTER (WHERE bonus_type = 'first_payment') AS first_payment,
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
