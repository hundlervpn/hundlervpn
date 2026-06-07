#!/usr/bin/env node
/**
 * Per-server traffic quota migration (2026-05-10).
 *
 * Adds the data model required for per-server traffic caps (initially used
 * on the NL "Обход Глушилок" server — see AGENTS.md). Idempotent, safe to
 * re-run.
 *
 *   node scripts/add-server-traffic-limits.js
 *
 * What it does:
 *   1. ALTER TABLE servers ADD COLUMN traffic_limit_bytes BIGINT NULL
 *      (NULL = unlimited; integer = byte cap with rolling 30-day reset).
 *   2. CREATE TABLE user_server_traffic — per-user-per-server accumulator
 *      with a `quota_period_start` timestamp. When a row's period is older
 *      than 30 days, application code treats `bytes_used` as 0 (rolling
 *      window). `/api/xray/traffic` will resets the row + advances
 *      `quota_period_start` when it observes new bytes in an expired window.
 *   3. UPDATE NL row (country='NL'):
 *      - name = 'Обход Глушилок' (replaces 'LTE')
 *      - traffic_limit_bytes = 50_000_000_000 (50 GB, decimal — matches the
 *        convention VPN clients use to render "X MB / 50 GB" in the UI).
 *   4. SELECT and print the resulting state of `servers`.
 *
 * Architecture:
 *   - Sub endpoint (`/api/sub/[token]`) JOINs `user_server_traffic` and
 *     drops any server where `bytes_used >= traffic_limit_bytes` within
 *     the current 30-day window. The client's next sub-poll (Happ: every
 *     1 min by `profile-update-interval`) drops the NL profile from
 *     their list.
 *   - `/api/xray/clients` (snapshot consumed by Xray sync) does NOT yet
 *     filter per-server — instant kick across cached configs will be a
 *     follow-up. Until then, exceeded users keep NL access until their
 *     sub-poll refreshes — at most ~60 s delay, acceptable.
 *   - Traffic stats are collected on each VPN VPS by `/opt/xray-traffic.sh`
 *     (separate file deployed later) which POSTs to `/api/xray/traffic`
 *     with a `server_host` field so the row is attributed to the right
 *     server. Existing `subscriptions.traffic_used_bytes` accounting
 *     remains untouched (kept for total-traffic display).
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

const NL_NEW_NAME = 'Обход Глушилок';
const NL_QUOTA_BYTES = 50_000_000_000; // 50 GB (decimal) — Happ shows "X / 50 GB"

async function main() {
  const client = await pool.connect();
  try {
    console.log('1. Adding traffic_limit_bytes column to servers…');
    await client.query(
      `ALTER TABLE servers ADD COLUMN IF NOT EXISTS traffic_limit_bytes BIGINT NULL;`,
    );
    console.log('   ✓ servers.traffic_limit_bytes');

    console.log('\n2. Creating user_server_traffic table…');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_server_traffic (
        user_id            INTEGER     NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        server_id          BIGINT      NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        bytes_used         BIGINT      NOT NULL DEFAULT 0,
        quota_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, server_id)
      );
    `);
    console.log('   ✓ user_server_traffic table');
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_user_server_traffic_period ON user_server_traffic(quota_period_start);`,
    );
    console.log('   ✓ idx_user_server_traffic_period');

    console.log(`\n3. Renaming NL server + setting quota (country='NL')…`);
    const upd = await client.query(
      `UPDATE servers
         SET name                = $1,
             traffic_limit_bytes = $2,
             updated_at          = NOW()
       WHERE country = 'NL'
       RETURNING id, name, host, country, traffic_limit_bytes;`,
      [NL_NEW_NAME, NL_QUOTA_BYTES],
    );
    if (upd.rows.length === 0) {
      console.log('   ⚠  No NL server found. Skipped.');
    } else {
      console.log(`   ✓ Updated ${upd.rows.length} row(s):`);
      console.table(upd.rows);
    }

    console.log('\n4. Current state of `servers`:');
    const all = await client.query(`
      SELECT id, name, host, country, sort_order, is_active,
             traffic_limit_bytes,
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

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
