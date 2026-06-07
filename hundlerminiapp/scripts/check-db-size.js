/**
 * check-db-size.js — Inventory the current Timeweb PostgreSQL DB.
 * Helps size the migration target and pick a cost-appropriate provider.
 */
const { Client } = require('pg');

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

(async () => {
  const c = new Client({ connectionString: CONNECTION_STRING });
  await c.connect();

  console.log('═══════════════════ DB SIZE AUDIT ═══════════════════\n');

  const dbSize = await c.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`);
  console.log(`Total DB size:        ${dbSize.rows[0].size}\n`);

  const tables = await c.query(`
    SELECT relname AS table,
           pg_size_pretty(pg_total_relation_size(relid)) AS size,
           pg_size_pretty(pg_relation_size(relid)) AS data_only,
           n_live_tup::bigint AS rows
      FROM pg_stat_user_tables
     ORDER BY pg_total_relation_size(relid) DESC
     LIMIT 30
  `);
  console.log('Top tables by size:');
  console.table(tables.rows);

  const indexes = await c.query(`
    SELECT COUNT(*)::int AS total,
           pg_size_pretty(SUM(pg_relation_size(indexrelid))) AS total_size
      FROM pg_stat_user_indexes
  `);
  console.log(`\nIndexes: ${indexes.rows[0].total} total, ${indexes.rows[0].total_size}`);

  const conns = await c.query(`SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`);
  console.log(`Active connections: ${conns.rows[0].n}`);

  console.log('\n═══════════════════════════════════════════════════');
  await c.end();
})().catch((err) => { console.error(err); process.exit(1); });
