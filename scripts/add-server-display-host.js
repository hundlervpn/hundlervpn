#!/usr/bin/env node
/**
 * Migration (2026-05-11): add `display_host` column to the `servers` table
 * and populate it for nodes that have a public DNS A-record, so client
 * configs (VLESS / Hy2 URIs, sing-box / Xray JSON) reference the domain
 * instead of the raw VPS IP.
 *
 * Idempotent. Safe to re-run.
 *
 *   node scripts/add-server-display-host.js
 *
 * What it does:
 *   1. ALTER TABLE servers ADD COLUMN IF NOT EXISTS display_host TEXT
 *   2. UPDATE servers SET display_host=<domain> WHERE host=<ip> AND
 *      display_host IS NULL  — only fills empty cells, never overwrites.
 *      (Add new mappings to `MAPPINGS` below as DNS records are added on
 *      Namecheap / your registrar of choice.)
 *   3. SELECT and print all servers so you can verify the migration ran.
 *
 * Why a separate `display_host` instead of just rewriting `host`:
 *   - per-server traffic accounting (`/api/xray/traffic`) matches incoming
 *     `server_host` against `servers.host`, and the on-VPS collector
 *     `/opt/xray-traffic.sh` uses `hostname -I` (= the public IPv4)
 *   - SNI rotation (`pickSniForServer`) salts the deterministic hash with
 *     `server.host`; rotating it would re-shuffle every user's SNI on
 *     next sub-poll for no security gain
 *   - server-side ping (`/api/servers/ping`) prefers an IP to skip DNS
 *
 *   Keeping `host` = IP and adding `display_host` = domain decouples those
 *   two concerns cleanly: client gets the domain, backend stays on the IP.
 *
 * What still leaks the IP after this runs:
 *   - the VPS itself, which obviously serves traffic on its public IPv4
 *   - any third-party service that scans the IP range (Shodan, Censys)
 *   - Reality cover (`dest`) request — but that goes to the donor site
 *     using the `serverNames` SNI, not back to our domain
 *   So this fix protects the *user's saved config* but doesn't hide the
 *   server. Combine with proper firewalling (Cloudflare proxy, etc.) for
 *   full DPI hardening.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

// host (IP) → display_host (domain). Only servers whose A-record is
// already set up on the registrar should be listed here. Re-running the
// script after adding more domains is fine; existing rows are not
// touched if `display_host` is already populated.
const MAPPINGS = [
  { host: '213.182.213.183', display_host: 'de.hundlervpn.xyz' },
  // TODO 2026-05-11: when DNS A-records exist, append:
  //   { host: '185.238.169.235', display_host: 'nl.hundlervpn.xyz' },
  //   { host: '158.160.254.104', display_host: 'yc.hundlervpn.xyz' },
  //   { host: '85.239.53.25',    display_host: 'ru.hundlervpn.xyz' },
];

async function main() {
  const client = await pool.connect();
  try {
    console.log('1. Adding display_host column…');
    await client.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS display_host TEXT;`);
    console.log('   ✓ display_host TEXT NULL');

    console.log('\n2. Populating display_host for known hosts…');
    for (const m of MAPPINGS) {
      const r = await client.query(
        `UPDATE servers
            SET display_host = $2
          WHERE host = $1
            AND (display_host IS NULL OR display_host = '')
       RETURNING id, name, country, host, display_host`,
        [m.host, m.display_host]
      );
      if (r.rows.length === 0) {
        // Row may already have a display_host set, or no server matches — print
        // current state so the operator can spot the case.
        const cur = await client.query(
          `SELECT id, name, country, host, display_host FROM servers WHERE host = $1`,
          [m.host]
        );
        if (cur.rows.length === 0) {
          console.log(`   ⚠ host=${m.host} not found in servers (skipped)`);
        } else {
          const row = cur.rows[0];
          console.log(
            `   = host=${m.host} already has display_host='${row.display_host}' (skipped)`
          );
        }
      } else {
        const row = r.rows[0];
        console.log(
          `   ✓ id=${row.id} ${row.country} '${row.name}': ${row.host} → ${row.display_host}`
        );
      }
    }

    console.log('\n3. Final state:');
    const all = await client.query(
      `SELECT id, name, country, host, display_host, hysteria2_port
         FROM servers
        ORDER BY sort_order ASC, country ASC, name ASC`
    );
    for (const row of all.rows) {
      const dh = row.display_host || '(NULL)';
      const hy2 = row.hysteria2_port ? `[Hy2:${row.hysteria2_port}]` : '';
      console.log(
        `   ${String(row.id).padStart(2)}  ${row.country}  ${row.name.padEnd(20)}  ${row.host.padEnd(18)} → ${dh}  ${hy2}`
      );
    }

    console.log('\nDone. Subscriptions auto-pick up the new value on next poll (~60s).');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
