#!/usr/bin/env node
/**
 * Repair: every VLESS Reality server MUST advertise `flow = xtls-rprx-vision`
 * — without it the client and server can't agree on a Vision sub-protocol
 * and the connection either fails outright or silently degrades.
 *
 *   node scripts/fix-server-flow.js
 *
 * Background (2026-05-14): Germany (id=4) row in the `servers` table was
 * found with `flow = ''` (empty string) by scripts/diagnose-de-server.js.
 * The DB schema declares `flow TEXT NOT NULL DEFAULT 'xtls-rprx-vision'`
 * so an empty value can only land via an explicit overwrite — likely an
 * admin-UI edit that left the field blank. The result: VLESS subscriptions
 * pointed at DE handshake without the Vision extension, which most modern
 * sing-box / Xray clients refuse.
 *
 * This script:
 *   1. UPDATEs every row where `flow` is empty or NULL to the canonical
 *      `'xtls-rprx-vision'` value.
 *   2. Prints all servers afterwards so we can eyeball the fleet.
 *
 * Idempotent — re-running is a no-op.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

const CANONICAL_FLOW = 'xtls-rprx-vision';

async function main() {
  const client = await pool.connect();
  try {
    console.log(`1. Setting flow = '${CANONICAL_FLOW}' on rows with empty/null flow…`);
    const upd = await client.query(
      `UPDATE servers
         SET flow = $1,
             updated_at = NOW()
       WHERE flow IS NULL OR flow = ''
       RETURNING id, name, country, host, flow;`,
      [CANONICAL_FLOW],
    );
    if (upd.rows.length === 0) {
      console.log('   ✓ Nothing to fix — every server already has a flow value.');
    } else {
      console.log(`   ✓ Fixed ${upd.rows.length} server(s):`);
      console.table(upd.rows);
    }

    console.log('\n2. Current servers fleet (relevant columns):');
    const all = await client.query(`
      SELECT id, name, country, host, is_active, flow, sort_order,
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
