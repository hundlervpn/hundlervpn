// 2026-05-05: create the subscription_reminders table used by the
// /api/cron/remind-expiring endpoint to avoid spamming the same user
// with expiration reminders multiple times. Idempotent — safe to re-run.

const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

(async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    await c.query(`
      CREATE TABLE IF NOT EXISTS subscription_reminders (
        id BIGSERIAL PRIMARY KEY,
        subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered BOOLEAN NOT NULL DEFAULT TRUE,
        error_text TEXT,
        UNIQUE(subscription_id, kind)
      )
    `);
    console.log('subscription_reminders table ensured.');

    await c.query(`
      CREATE INDEX IF NOT EXISTS idx_subscription_reminders_user_kind
        ON subscription_reminders(user_id, kind)
    `);
    console.log('Index idx_subscription_reminders_user_kind ensured.');

    // Sanity check
    const r = await c.query(`
      SELECT COUNT(*) FROM subscription_reminders
    `);
    console.log(`Current row count: ${r.rows[0].count}`);
  } finally {
    await c.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
