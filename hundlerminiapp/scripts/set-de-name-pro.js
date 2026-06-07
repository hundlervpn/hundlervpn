// One-shot: set Germany server's `name` column to 'Pro' if empty/null.
// AGENTS.md intent (id=4 Germany) was for `name='Pro'` per
// `scripts/add-germany-server.js`, but the original INSERT used an
// empty string. After 2026-05-08 sort_order swap (DE → 1), DE is the
// featured default server so a clean "🇩🇪 Германия | Pro" label is
// preferable to "🇩🇪 Германия | -" or just "🇩🇪 Германия".
//
// Idempotent — only updates rows where name is empty/null.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

(async () => {
  try {
    const result = await pool.query(
      `UPDATE servers
         SET name = 'Pro'
       WHERE country = 'DE' AND is_active = TRUE AND (name IS NULL OR name = '')
       RETURNING id, country, name`
    );
    console.log(`Updated ${result.rowCount} rows:`, result.rows);

    const verify = await pool.query(
      `SELECT id, country, name, sort_order, host
         FROM servers WHERE is_active = TRUE
         ORDER BY sort_order ASC, country ASC, name ASC`
    );
    console.log('\nFinal active servers:');
    verify.rows.forEach((r) =>
      console.log(`  #${r.sort_order}  id=${r.id}  ${r.country} | ${r.name || '(no name)'}  host=${r.host}`)
    );
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
