#!/usr/bin/env node
/**
 * One-shot: insert the Russian Federation (Moscow) VPN server row into the
 * servers table and print the current active server list.
 *
 *   node scripts/add-rf-server.js
 *
 * Values are the ones produced by `scripts/setup-rf-server.sh` on
 * 85.239.53.25 — Reality keypair + shortId are unique to that VPS.
 *
 * Safe to re-run: skips INSERT if a row for host=85.239.53.25 already
 * exists (reports that instead). If you re-run setup-rf-server.sh on
 * the same VPS the keypair changes; in that case manually UPDATE the
 * existing row instead of inserting a duplicate.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

const ROW = {
  name: 'YouTube',
  host: '85.239.53.25',
  port: 443,
  country: 'RU',
  public_key: 'OUyKsXGoW1sOOsVxZkCB62cW_IbrNVZA-2eEckMFN2Q',
  sni: 'www.microsoft.com',
  short_id: '3e49295849a4f33b',
  fingerprint: 'chrome',
  flow: 'xtls-rprx-vision',
  sort_order: 3,
};

async function main() {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      'SELECT id, name, country, is_active, sort_order FROM servers WHERE host = $1',
      [ROW.host],
    );
    if (existing.rows.length > 0) {
      console.log('⚠  Row with this host already exists:', existing.rows[0]);
    } else {
      const ins = await client.query(
        `INSERT INTO servers (name, host, port, country, public_key, sni, short_id, fingerprint, flow, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10)
         RETURNING id, name, host, country, port, is_active, sort_order`,
        [
          ROW.name, ROW.host, ROW.port, ROW.country,
          ROW.public_key, ROW.sni, ROW.short_id,
          ROW.fingerprint, ROW.flow, ROW.sort_order,
        ],
      );
      console.log('✅ Inserted:', ins.rows[0]);
    }

    console.log('\nAll servers currently in DB:');
    const all = await client.query(
      'SELECT id, name, host, port, country, is_active, sort_order FROM servers ORDER BY sort_order ASC, id ASC',
    );
    console.table(all.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
