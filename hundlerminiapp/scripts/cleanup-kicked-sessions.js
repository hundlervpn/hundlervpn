// v46 one-time cleanup: remove stale kicked device_sessions rows left over
// from the v45 soft-kick behaviour. After v46, user-initiated DELETEs are
// hard-deletes, so any kicked_at IS NOT NULL row is legacy and should go.
//
// Usage:  node scripts/cleanup-kicked-sessions.js
// (Script deletes itself after successful run is NOT automatic — remove
//  manually once you've verified the fix.)

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

async function main() {
  const client = await pool.connect();
  try {
    // Preview — show what's about to be deleted.
    const preview = await client.query(`
      SELECT ds.id, u.telegram_id, ds.device_hash, ds.device_name,
             ds.kicked_at, ds.vpn_key_id
      FROM device_sessions ds
      JOIN users u ON u.id = ds.user_id
      WHERE ds.kicked_at IS NOT NULL
      ORDER BY ds.kicked_at DESC
    `);

    console.log(`Found ${preview.rowCount} kicked session(s):`);
    preview.rows.forEach((r) => {
      console.log(
        `  id=${r.id} tg=${r.telegram_id} `
        + `name="${r.device_name}" hash=${String(r.device_hash).substring(0, 40)} `
        + `kicked_at=${r.kicked_at} vpn_key_id=${r.vpn_key_id ?? '-'}`,
      );
    });

    if (preview.rowCount === 0) {
      console.log('Nothing to clean up.');
      return;
    }

    // Delete.
    const del = await client.query(`
      DELETE FROM device_sessions WHERE kicked_at IS NOT NULL
    `);
    console.log(`\nDeleted ${del.rowCount} kicked session row(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
