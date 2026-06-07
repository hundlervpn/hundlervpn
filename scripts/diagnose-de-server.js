#!/usr/bin/env node
/**
 * Diagnose the Germany (country='DE') VPN server end-to-end.
 *
 *   node scripts/diagnose-de-server.js
 *
 * Prints, in order:
 *   1. The full DB row (servers table) — confirms is_active, public_key,
 *      sni, short_id, ports, sort_order, traffic limit, display_host, etc.
 *   2. TCP probe to host:port (Reality / VLESS endpoint) — quick check
 *      that the VPS is up and the port is reachable from where this
 *      script runs. A 3-second timeout is used so the script never
 *      hangs.
 *   3. TCP probe to display_host:port if display_host is set and resolves
 *      differently from host (catches "DNS broken / proxy points wrong
 *      place" problems).
 *   4. TCP probe to hysteria2_port (UDP-based protocol; we can't
 *      reliably hand-shake from Node, but at least we report whether the
 *      column is populated — Hy2 uses UDP so a TCP probe wouldn't be
 *      meaningful anyway).
 *   5. How many sub-tokens currently reference the DE server (via the
 *      /api/sub/[token] query) — sanity check that users would in fact
 *      receive the DE outbound if everything else were fine.
 *
 * The script's job is to localise the failure:
 *   • DB row missing / is_active=false   → admin must re-enable.
 *   • TCP probe times out                → VPS down or firewall blocked;
 *                                          go SSH and `systemctl status xray`.
 *   • TCP probe OK but users still fail → most likely Reality keys /
 *                                          SNI drifted on the VPS; check
 *                                          /usr/local/etc/xray/config.json
 *                                          and resync via the admin UI's
 *                                          "Sync" button on the server card.
 *
 * Safe / read-only: no UPDATE / INSERT statements.
 */
const { Pool } = require('pg');
const net = require('net');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

const COUNTRY = 'DE';
const TCP_TIMEOUT_MS = 3000;

function probeTcp(host, port) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve({ ...result, elapsedMs: Date.now() - t0 });
    };
    sock.setTimeout(TCP_TIMEOUT_MS);
    sock.once('connect', () => done({ ok: true }));
    sock.once('timeout', () => done({ ok: false, reason: 'timeout' }));
    sock.once('error', (err) => done({ ok: false, reason: err.code || err.message }));
    try {
      sock.connect(port, host);
    } catch (err) {
      done({ ok: false, reason: String(err) });
    }
  });
}

async function main() {
  const client = await pool.connect();
  try {
    console.log(`Diagnosing servers WHERE country = '${COUNTRY}'\n`);

    const rowsRes = await client.query(
      `SELECT id, name, host, display_host, port, country, public_key, sni, short_id,
              fingerprint, flow, hysteria2_port, hysteria2_password, hysteria2_sni,
              hysteria2_cert_sha256, sort_order, is_active, traffic_limit_bytes,
              last_sync_at, created_at, updated_at
         FROM servers
        WHERE country = $1
        ORDER BY id ASC;`,
      [COUNTRY],
    );

    if (rowsRes.rows.length === 0) {
      console.log(`❌ No server rows with country='${COUNTRY}'. Nothing to diagnose.`);
      return;
    }

    for (const s of rowsRes.rows) {
      console.log('— Server row (DB) —');
      console.table([{
        id: s.id,
        name: s.name,
        host: s.host,
        display_host: s.display_host,
        port: s.port,
        country: s.country,
        is_active: s.is_active,
        sort_order: s.sort_order,
        traffic_limit_bytes: s.traffic_limit_bytes,
      }]);
      console.log('Reality fields:');
      console.table([{
        public_key: s.public_key ? s.public_key.slice(0, 16) + '…' : null,
        sni: s.sni,
        short_id: s.short_id,
        fingerprint: s.fingerprint,
        flow: s.flow,
      }]);
      if (s.hysteria2_port) {
        console.log('Hysteria2 fields:');
        console.table([{
          hysteria2_port: s.hysteria2_port,
          hysteria2_sni: s.hysteria2_sni,
          has_password: Boolean(s.hysteria2_password),
          has_cert_sha256: Boolean(s.hysteria2_cert_sha256),
        }]);
      }
      console.log('Timestamps:');
      console.table([{
        last_sync_at: s.last_sync_at,
        updated_at: s.updated_at,
        created_at: s.created_at,
      }]);

      // --- TCP probes ---
      console.log(`\nTCP probe → ${s.host}:${s.port} (Reality endpoint)`);
      const r1 = await probeTcp(s.host, s.port);
      if (r1.ok) {
        console.log(`   ✓ connected in ${r1.elapsedMs} ms`);
      } else {
        console.log(`   ✗ failed (${r1.reason}) after ${r1.elapsedMs} ms`);
      }

      if (s.display_host && s.display_host !== s.host) {
        console.log(`\nTCP probe → ${s.display_host}:${s.port} (display_host)`);
        const r2 = await probeTcp(s.display_host, s.port);
        if (r2.ok) {
          console.log(`   ✓ connected in ${r2.elapsedMs} ms`);
        } else {
          console.log(`   ✗ failed (${r2.reason}) after ${r2.elapsedMs} ms`);
        }
      }
    }

    // --- Sub-list sanity check ---
    console.log('\n— Sub-list reachability —');
    const subRes = await client.query(
      `SELECT COUNT(*)::int AS active_subs
         FROM subscriptions
        WHERE status = 'active' AND end_date > NOW();`,
    );
    console.log(`   Active subscriptions in DB: ${subRes.rows[0].active_subs}`);
    const subWithDe = await client.query(
      `SELECT COUNT(*)::int AS would_get_de
         FROM subscriptions sub
        WHERE sub.status = 'active'
          AND sub.end_date > NOW()
          AND EXISTS (
            SELECT 1 FROM servers s
             WHERE s.country = $1
               AND s.is_active = TRUE
               AND s.public_key IS NOT NULL
               AND s.sni IS NOT NULL
               AND s.short_id IS NOT NULL
          );`,
      [COUNTRY],
    );
    console.log(`   Of those, would receive DE in /api/sub: ${subWithDe.rows[0].would_get_de}`);

    console.log('\nDiagnosis complete. If TCP probes succeeded but users still');
    console.log('cannot connect, SSH into the VPS and run:');
    console.log('   systemctl status xray');
    console.log('   journalctl -u xray -n 100 --no-pager');
    console.log('   tail -200 /var/log/xray/error.log 2>/dev/null');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
