#!/usr/bin/env node
/**
 * EMERGENCY ROLLBACK (2026-05-14): undo scripts/fix-server-flow.js.
 *
 *   node scripts/rollback-server-flow.js
 *
 * Why we're rolling back:
 *   - scripts/fix-server-flow.js set flow='xtls-rprx-vision' on every
 *     server row whose flow column was empty / NULL, assuming that an
 *     empty flow was the bug.
 *   - After deploying, ALL VLESS connections broke (Hy2 still worked).
 *     Reason: every VPS's Xray config has its `inbound.settings.clients[]`
 *     entries WITHOUT a `flow` field (or with `flow: ""`). When we
 *     advertise `flow=xtls-rprx-vision` in /api/sub, the client packs
 *     that into the VLESS request header. Xray then refuses the
 *     handshake because the user record on the server side has no
 *     matching Vision flow → "ErrInvalidUser" / silent disconnect.
 *
 *   - Correct long-term fix is to either:
 *       a) add `"flow": "xtls-rprx-vision"` to every clients[] entry on
 *          every VPS Xray config and reload the service, OR
 *       b) keep server-side as-is and stop advertising flow in client
 *          configs.
 *     For now we choose (b): roll the DB back to the pre-fix state so
 *     production is unblocked.
 *
 * This script only touches the `flow` column. It does NOT re-introduce
 * traffic_limit_bytes — keep traffic unlimited (separate decision).
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log("Rolling back: setting flow = '' on every server…");
    const upd = await client.query(
      `UPDATE servers
         SET flow = '',
             updated_at = NOW()
       WHERE flow <> ''
       RETURNING id, name, country, host, flow;`,
    );
    if (upd.rows.length === 0) {
      console.log('   (nothing to roll back; every server already has empty flow)');
    } else {
      console.log(`   ✓ Rolled back ${upd.rows.length} row(s):`);
      console.table(upd.rows);
    }

    console.log('\nFinal server fleet:');
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
    console.log('\nDone. Happ / sing-box clients pick up the change on next');
    console.log('sub-poll (~60 s on Happ default `profile-update-interval`).');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
