import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const schemaPath = path.resolve(process.cwd(), 'db', 'schema.sql');
const schemaSql = await fs.readFile(schemaPath, 'utf8');

const client = new Client({ connectionString, ssl: false });
await client.connect();

try {
  await client.query('BEGIN');
  await client.query(schemaSql);

  await client.query(`
    UPDATE subscriptions
    SET
      status = 'expired',
      end_date = NOW(),
      updated_at = NOW();

    UPDATE vpn_keys
    SET
      is_active = false,
      expires_at = NOW();
  `);

  await client.query('COMMIT');

  const counts = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users_count,
      (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active') AS active_subscriptions,
      (SELECT COUNT(*)::int FROM vpn_keys WHERE is_active = true) AS active_keys;
  `);

  console.log('DB sync complete:', counts.rows[0]);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
