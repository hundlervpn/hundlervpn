// One-shot migration: add read-tracking columns to support_tickets.
// Idempotent — safe to re-run.
//
// Usage: node scripts/migrate-tickets-read.js

const { Client } = require('pg');

const conn = process.env.DATABASE_URL
  || `postgresql://gen_user:${encodeURIComponent('HundlerVPN2026Strong')}@132.243.242.196:5432/default_db`;

async function main() {
  const c = new Client({ connectionString: conn, ssl: false });
  await c.connect();
  console.log('Connected to DB.');

  await c.query(`
    ALTER TABLE support_tickets
      ADD COLUMN IF NOT EXISTS last_user_read_at TIMESTAMPTZ;
  `);
  console.log('  ✓ last_user_read_at');

  await c.query(`
    ALTER TABLE support_tickets
      ADD COLUMN IF NOT EXISTS last_admin_read_at TIMESTAMPTZ;
  `);
  console.log('  ✓ last_admin_read_at');

  // Initial backfill: assume already-existing tickets have been read up to NOW
  // for the *user*. This avoids showing a phantom red badge on every existing
  // user account just because they haven't logged in since the migration.
  // For *admin* — leave NULL so the admin sees the unread badge for everything
  // that hasn't been responded to (which is the desired starting state).
  const r = await c.query(`
    UPDATE support_tickets
    SET last_user_read_at = NOW()
    WHERE last_user_read_at IS NULL;
  `);
  console.log(`  ✓ backfilled last_user_read_at on ${r.rowCount} existing tickets`);

  const stats = await c.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(last_user_read_at) AS user_read,
      COUNT(last_admin_read_at) AS admin_read
    FROM support_tickets;
  `);
  console.log('Stats:', stats.rows[0]);

  await c.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
