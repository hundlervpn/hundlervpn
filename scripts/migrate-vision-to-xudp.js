// Migrate `servers.flow` from "xtls-rprx-vision" to "" (empty) so that the
// /api/xray/clients endpoint, the subscription endpoint, and all client
// VLESS URI/JSON builders agree on "no Vision, use XUDP for UDP".
//
// 2026-05-09 (XUDP migration, v60). Idempotent — running this on a DB that
// is already migrated reports 0 affected rows.
//
// Run order for a clean cutover:
//   1. Deploy this PR (Hostman picks it up).
//   2. Run THIS script:
//        node scripts/migrate-vision-to-xudp.js
//      This flips the DB column. The xray-clients endpoint will now return
//      flow="" for every client.
//   3. Within 60s, each VPN VPS's /opt/xray-sync.sh polls the endpoint,
//      sees the diff (clients now without flow), updates config.json,
//      restarts xray. Brief disconnect window (~5s) for active clients,
//      they reconnect with the new no-flow config.
//   4. Existing CACHED subscriptions on user devices still have
//      `flow=xtls-rprx-vision` — those connections WILL fail until the
//      client polls subscription URL again (Happ/Hiddify do this every
//      `profile-update-interval` minutes; we send 60). So worst case
//      ~60 min until everyone is back online with new XUDP config.
//   5. After 24-48h, also SSH into each VPN node and run
//      scripts/migrate-server-to-xudp.sh once to bake in the
//      no-flow-default into /opt/xray-sync.sh placeholder line and
//      add a server-side TG-CIDR direct routing rule (so TG bypasses
//      the WARP cascade on DE/NL — required for NAT consistency on
//      voice calls). DB-only migration is enough for normal connections;
//      the server-side patch is the polish layer.

const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

(async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    const before = await c.query(
      `SELECT id, name, host, country, flow
       FROM servers
       WHERE is_active = TRUE
       ORDER BY id`
    );
    console.log(`Active servers (${before.rowCount}):`);
    for (const r of before.rows) {
      console.log(`  - id=${r.id} ${r.country} ${r.name} (${r.host}) flow=${JSON.stringify(r.flow)}`);
    }

    const upd = await c.query(
      `UPDATE servers
       SET flow = ''
       WHERE flow = 'xtls-rprx-vision'
       RETURNING id, name, host`
    );
    console.log(`\nUpdated ${upd.rowCount} server row(s) flow -> '' (XUDP):`);
    for (const r of upd.rows) {
      console.log(`  - id=${r.id} ${r.name} (${r.host})`);
    }

    if (upd.rowCount === 0) {
      console.log('Nothing to migrate (already at flow="").');
    } else {
      console.log('\nNext steps:');
      console.log('  1. Wait 60s for VPN nodes to poll /api/xray/clients and pick up new flow.');
      console.log('  2. Watch /var/log/xray-sync.log on each node for the diff + restart line.');
      console.log('  3. Verify TG voice on a test device (existing client must refresh sub first).');
    }
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
