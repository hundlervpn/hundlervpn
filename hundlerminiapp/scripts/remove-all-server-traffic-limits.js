#!/usr/bin/env node
/**
 * One-shot: drop per-server traffic quotas for ALL servers.
 *
 *   node scripts/remove-all-server-traffic-limits.js
 *
 * Background (2026-05-14): the NL "Обход Глушилок" node was launched with a
 * 50 GB rolling-30-day cap (see scripts/add-server-traffic-limits.js).
 * Product decision today: everyone gets unlimited traffic on every server.
 *
 * What the script does:
 *   1. SET servers.traffic_limit_bytes = NULL for any row where it's set.
 *      Because /api/sub/[token]/route.ts treats NULL as "no cap" the
 *      `quota_exceeded` flag for those servers becomes permanently false
 *      and the NL profile reappears in any user's sub list on next poll
 *      (~60 s for Happ, immediately on hard refresh).
 *   2. TRUNCATE user_server_traffic — the counters are now meaningless and
 *      shaving them keeps the table tidy. The accumulator is still wired
 *      up in /api/xray/traffic so if we ever reintroduce caps we restart
 *      from zero rather than from whatever ghost numbers were lying
 *      around. Safe to run even if the table is empty.
 *   3. SELECT and print the resulting server list so you can verify.
 *
 * Idempotent: re-running is a no-op once everything is NULL.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('1. Dropping traffic_limit_bytes on all servers…');
    const upd = await client.query(
      `UPDATE servers
         SET traffic_limit_bytes = NULL,
             updated_at = NOW()
       WHERE traffic_limit_bytes IS NOT NULL
       RETURNING id, name, host, country;`,
    );
    if (upd.rows.length === 0) {
      console.log('   ✓ Nothing to do — every server already unlimited.');
    } else {
      console.log(`   ✓ Cleared limit on ${upd.rows.length} server(s):`);
      console.table(upd.rows);
    }

    console.log('\n2. Truncating user_server_traffic accumulator…');
    const tr = await client.query(`DELETE FROM user_server_traffic RETURNING user_id;`);
    console.log(`   ✓ Removed ${tr.rowCount || 0} per-user counter row(s).`);

    console.log('\n3. Current state of `servers`:');
    const all = await client.query(`
      SELECT id, name, host, country, sort_order, is_active,
             CASE
               WHEN traffic_limit_bytes IS NULL THEN 'unlimited'
               ELSE (traffic_limit_bytes / 1000000000)::text || ' GB'
             END AS quota_label
        FROM servers
        ORDER BY sort_order ASC, id ASC;
    `);
    console.table(all.rows);

    console.log('\nDone.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
