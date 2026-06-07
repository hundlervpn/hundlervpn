// Apply sort_order migration + set explicit priority for current servers.
//
// 2026-05-08 update: Germany is now FIRST (sort_order=1), Netherlands SECOND
// (sort_order=2), Russia THIRD (sort_order=3). NL is the YC bridge cascade
// (entry IP is YC, expensive LTE traffic on YC's outbound), so we want users
// to default to DE which is a direct WARP cascade with cheaper transit and
// better latency from RU networks.
//
// Safe to re-run.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

async function main() {
  const client = await pool.connect();
  try {
    // 1. Ensure column exists (idempotent).
    await client.query(`
      ALTER TABLE servers
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100
    `);
    console.log('Column sort_order ensured.');

    // 2. Set priorities. Lower sort_order = appears first in client UIs.
    //    `/api/sub/[token]` orders by `sort_order ASC, country ASC, name ASC`,
    //    so the FIRST server here becomes the default for new connections.
    const deUpdate = await client.query(
      `UPDATE servers SET sort_order = 1 WHERE country = 'DE' AND is_active = TRUE`
    );
    const nlUpdate = await client.query(
      `UPDATE servers SET sort_order = 2 WHERE country = 'NL' AND is_active = TRUE`
    );
    const ruUpdate = await client.query(
      `UPDATE servers SET sort_order = 3 WHERE country = 'RU' AND is_active = TRUE`
    );
    console.log(
      `Updated DE rows: ${deUpdate.rowCount}, NL rows: ${nlUpdate.rowCount}, ` +
      `RU rows: ${ruUpdate.rowCount}`
    );

    // 3. Show current active servers in final order.
    const verify = await client.query(`
      SELECT id, name, host, country, sort_order, is_active
      FROM servers
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, country ASC, name ASC
    `);
    console.log('\nActive servers in client order:');
    verify.rows.forEach((r) => {
      console.log(
        `  #${r.sort_order}  id=${r.id}  ${r.country} (${r.name || '-'})  host=${r.host}`
      );
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
