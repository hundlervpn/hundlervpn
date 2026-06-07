#!/usr/bin/env node
/**
 * Phase-2 migration: add Hysteria2 columns to `servers` table and populate
 * them for the Germany pilot row (host=213.182.213.183).
 *
 * Idempotent. Safe to re-run.
 *
 *   node scripts/add-hysteria2-columns.js
 *
 * What it does:
 *   1. ALTER TABLE servers ADD COLUMN IF NOT EXISTS hysteria2_port INTEGER
 *   2. ALTER TABLE servers ADD COLUMN IF NOT EXISTS hysteria2_password TEXT
 *   3. ALTER TABLE servers ADD COLUMN IF NOT EXISTS hysteria2_sni TEXT
 *   4. ALTER TABLE servers ADD COLUMN IF NOT EXISTS hysteria2_cert_sha256 TEXT
 *   5. UPDATE the Germany row (host=213.182.213.183) with:
 *      - hysteria2_port=8443
 *      - hysteria2_password='66004e76f286dfd3c4760dacca57671c'
 *      - hysteria2_sni='de.hundlervpn.xyz'
 *      - hysteria2_cert_sha256='281310e402a92ce5f86d7be2d6cbbbc34b883ca5f4b1a62a6c4d9c7683dbb043'
 *   6. SELECT and print all servers + their Hy2 columns to confirm.
 *
 * Why these values:
 *   These are the credentials emitted by `scripts/setup-germany-hysteria2.sh`
 *   when it ran on the Germany VPS on 2026-05-08. The cert is self-signed
 *   (pilot-only — switch to LE before broad rollout); the SHA256 fingerprint
 *   pins it on the client side.
 *
 * Rotation:
 *   To rotate the Hy2 password, regenerate `/etc/hysteria/.password` on DE,
 *   restart `hysteria-server.service`, and re-run this script with the new
 *   value. Existing client subscriptions auto-update on next poll because
 *   `app/api/sub/[token]/route.ts` reads the columns each time.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

const DE_HOST = '213.182.213.183';
const DE_HY2 = {
  port: 8443,
  password: '66004e76f286dfd3c4760dacca57671c',
  sni: 'de.hundlervpn.xyz',
  certSha256: '281310e402a92ce5f86d7be2d6cbbbc34b883ca5f4b1a62a6c4d9c7683dbb043',
};

async function main() {
  const client = await pool.connect();
  try {
    console.log('1. Adding Hy2 columns…');
    await client.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS hysteria2_port        INTEGER NULL;`);
    console.log('   ✓ hysteria2_port');
    await client.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS hysteria2_password    TEXT    NULL;`);
    console.log('   ✓ hysteria2_password');
    await client.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS hysteria2_sni         TEXT    NULL;`);
    console.log('   ✓ hysteria2_sni');
    await client.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS hysteria2_cert_sha256 TEXT    NULL;`);
    console.log('   ✓ hysteria2_cert_sha256');

    console.log(`\n2. Populating Germany row (host=${DE_HOST})…`);
    const upd = await client.query(
      `UPDATE servers
         SET hysteria2_port        = $2,
             hysteria2_password    = $3,
             hysteria2_sni         = $4,
             hysteria2_cert_sha256 = $5
       WHERE host = $1
       RETURNING id, name, host, country, hysteria2_port, hysteria2_sni`,
      [DE_HOST, DE_HY2.port, DE_HY2.password, DE_HY2.sni, DE_HY2.certSha256]
    );
    if (upd.rows.length === 0) {
      console.log(`   ⚠  No row found with host=${DE_HOST} — pilot will not work until that row exists.`);
      console.log(`      Run scripts/add-germany-server.js first if needed.`);
    } else {
      console.log('   ✓ Updated:', upd.rows[0]);
    }

    console.log('\n3. Current state of `servers`:');
    const all = await client.query(`
      SELECT id, name, host, country, is_active,
             hysteria2_port, hysteria2_sni,
             CASE WHEN hysteria2_password IS NULL THEN NULL
                  ELSE 'SET (' || length(hysteria2_password) || ' chars)' END AS hysteria2_password,
             CASE WHEN hysteria2_cert_sha256 IS NULL THEN NULL
                  ELSE substring(hysteria2_cert_sha256 from 1 for 16) || '…' END AS hysteria2_cert_sha256
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
