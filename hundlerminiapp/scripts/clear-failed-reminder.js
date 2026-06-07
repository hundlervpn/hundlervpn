// Deletes the failed reminder row for sub 168 so cron can retry.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

async function main() {
  const subId = Number(process.argv[2] || 168);
  const client = await pool.connect();
  try {
    const r = await client.query(
      `DELETE FROM subscription_reminders
       WHERE subscription_id = $1
         AND kind = 'expiring_1d'
         AND delivered = FALSE
       RETURNING id, error_text, sent_at`,
      [subId]
    );
    console.log(`Deleted ${r.rowCount} failed reminder row(s) for sub ${subId}:`);
    console.log(JSON.stringify(r.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
