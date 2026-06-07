// 2026-05-05: extend broadcasts.target_audience CHECK constraint to allow
// 'active_no_devices'. Idempotent — safe to re-run.

const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

(async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    const before = await c.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'broadcasts'
        AND c.conname = 'broadcasts_target_audience_check'
    `);
    console.log('Before:', before.rows[0]?.def ?? '(no constraint)');

    if (before.rows[0]?.def && !before.rows[0].def.includes('active_no_devices')) {
      console.log('Updating constraint…');
      await c.query(`ALTER TABLE broadcasts DROP CONSTRAINT broadcasts_target_audience_check`);
      await c.query(`ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_target_audience_check
        CHECK (target_audience IN ('all', 'active', 'no_sub', 'active_no_devices'))`);
      console.log('Done.');
    } else {
      console.log('Constraint already up-to-date or missing — nothing to do.');
    }

    const after = await c.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'broadcasts'
        AND c.conname = 'broadcasts_target_audience_check'
    `);
    console.log('After:', after.rows[0]?.def ?? '(no constraint)');

    // Sanity-check the new audience: count current matches.
    const count = await c.query(`
      SELECT COUNT(*)::int AS n
      FROM users u
      WHERE u.telegram_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.user_id = u.id
            AND s.status = 'active'
            AND s.end_date > NOW()
        )
        AND NOT EXISTS (
          SELECT 1 FROM device_sessions ds
          WHERE ds.user_id = u.id
            AND ds.kicked_at IS NULL
        )
    `);
    console.log(`Users matching 'active_no_devices' right now: ${count.rows[0].n}`);
  } finally {
    await c.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
