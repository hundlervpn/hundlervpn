#!/usr/bin/env node
/**
 * Diagnose + fix:
 *   - Show every servers row with full detail (helps explain why NL vanished in UI)
 *   - Ensure NL (host LIKE 'vpn.hundlervpn.xyz' OR id=3) is_active = TRUE
 *   - Update Germany (id=4) name from 'Pro' -> '' so UI shows just "🇩🇪 Германия"
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('==== BEFORE ====');
    const before = await client.query(
      `SELECT id, name, host, port, country, is_active,
              (public_key IS NOT NULL) AS has_pub,
              (sni IS NOT NULL) AS has_sni,
              (short_id IS NOT NULL) AS has_sid
         FROM servers
         ORDER BY id`,
    );
    console.table(before.rows);

    // Fix 1: Germany name
    const de = await client.query(
      `UPDATE servers SET name = '' WHERE host = '213.182.213.183' RETURNING id, name, country`,
    );
    if (de.rows.length > 0) {
      console.log('\n✅ Germany name cleared:', de.rows[0]);
    } else {
      console.log('\n⚠  Germany row not found (host=213.182.213.183)');
    }

    // Fix 2: Re-activate NL if somehow deactivated
    const nl = await client.query(
      `UPDATE servers SET is_active = TRUE
         WHERE (host = 'vpn.hundlervpn.xyz' OR id = 3)
           AND is_active = FALSE
       RETURNING id, name, host, is_active`,
    );
    if (nl.rows.length > 0) {
      console.log('✅ Netherlands re-activated:', nl.rows[0]);
    } else {
      console.log('ℹ  Netherlands already active (or no row matching)');
    }

    console.log('\n==== AFTER ====');
    const after = await client.query(
      `SELECT id, name, host, port, country, is_active,
              (public_key IS NOT NULL) AS has_pub,
              (sni IS NOT NULL) AS has_sni,
              (short_id IS NOT NULL) AS has_sid
         FROM servers
         ORDER BY id`,
    );
    console.table(after.rows);

    console.log('\n==== What /api/servers (UI) will return ====');
    const uiList = await client.query(
      `SELECT id, name, host, country, is_active
         FROM servers
         WHERE is_active = TRUE
         ORDER BY country ASC, name ASC`,
    );
    console.table(uiList.rows);

    console.log('\n==== What /api/sub/[token] will iterate ====');
    const subList = await client.query(
      `SELECT id, name, host, country
         FROM servers
         WHERE is_active = TRUE
           AND public_key IS NOT NULL
           AND sni IS NOT NULL
         ORDER BY id`,
    );
    console.table(subList.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
