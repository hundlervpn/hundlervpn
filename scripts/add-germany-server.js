#!/usr/bin/env node
/**
 * One-shot: insert the Germany VPN server row into the servers table
 * and print the current active server list.
 *
 *   node scripts/add-germany-server.js
 *
 * Safe to re-run: skips INSERT if a row for host=213.182.213.183 already
 * exists (reports that instead).
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

const ROW = {
  name: 'Pro',
  host: '213.182.213.183',
  port: 443,
  country: 'DE',
  public_key: 'qJeA8EaI9mSdRXRW3ZzERyRLGpy3anoX4Au3DtGaVBA',
  sni: 'www.microsoft.com',
  short_id: '9a8c25967fa0d196',
  fingerprint: 'chrome',
  flow: 'xtls-rprx-vision',
};

async function main() {
  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT id, name, country, is_active FROM servers WHERE host = $1', [ROW.host]);
    if (existing.rows.length > 0) {
      console.log('⚠  Row with this host already exists:', existing.rows[0]);
    } else {
      const ins = await client.query(
        `INSERT INTO servers (name, host, port, country, public_key, sni, short_id, fingerprint, flow, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
         RETURNING id, name, host, country, port, is_active`,
        [ROW.name, ROW.host, ROW.port, ROW.country, ROW.public_key, ROW.sni, ROW.short_id, ROW.fingerprint, ROW.flow],
      );
      console.log('✅ Inserted:', ins.rows[0]);
    }

    console.log('\nAll servers currently in DB:');
    const all = await client.query(
      'SELECT id, name, host, port, country, is_active FROM servers ORDER BY id',
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
