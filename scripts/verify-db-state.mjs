import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const client = new Client({ connectionString, ssl: false });
await client.connect();

try {
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'subscriptions', 'vpn_keys', 'payments', 'plans', 'servers', 'logs')
    ORDER BY table_name;
  `);

  const stats = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users_count,
      (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active') AS active_subscriptions,
      (SELECT COUNT(*)::int FROM vpn_keys WHERE is_active = true) AS active_keys;
  `);

  console.log('tables:', tables.rows.map((row) => row.table_name));
  console.log('stats:', stats.rows[0]);
} finally {
  await client.end();
}
