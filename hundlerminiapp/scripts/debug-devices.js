// Diagnostic for device-limit bug.
// Shows every device_sessions row for a user, its rank, and whether it
// should be blocked by /api/sub/[token] (rank > max_devices).
//
// Usage:
//   node scripts/debug-devices.js              # defaults to tg=2029065770
//   node scripts/debug-devices.js <telegramId>

const { Client } = require('pg');

const TELEGRAM_ID = Number(process.argv[2] || 2029065770);

const client = new Client({
  host: '132.243.242.196',
  port: 5432,
  user: 'gen_user',
  password: 'HundlerVPN2026Strong',
  database: 'default_db',
  ssl: false,
});

async function main() {
  await client.connect();

  const userRes = await client.query(
    `SELECT id, telegram_id FROM users WHERE telegram_id = $1 LIMIT 1`,
    [TELEGRAM_ID]
  );
  const user = userRes.rows[0];
  if (!user) {
    console.log(`No user with telegram_id=${TELEGRAM_ID}`);
    return;
  }
  console.log(`User id=${user.id} tg=${user.telegram_id}`);

  const subRes = await client.query(
    `SELECT s.id AS sub_id, s.status, s.end_date,
            COALESCE(p.max_devices, 3) AS max_devices
     FROM subscriptions s
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = $1
     ORDER BY s.end_date DESC
     LIMIT 1`,
    [user.id]
  );
  const sub = subRes.rows[0];
  console.log(`Subscription:`, sub || '(none)');
  const maxDevices = sub?.max_devices ?? 3;

  // Active sessions within 30 days, ranked by created_at (same logic as sub endpoint)
  const activeRes = await client.query(
    `WITH ranked AS (
       SELECT ds.id, ds.device_name, ds.ip_address, ds.device_hash,
              ds.created_at, ds.last_seen_at,
              SUBSTRING(ds.user_agent, 1, 140) AS ua,
              ROW_NUMBER() OVER (ORDER BY ds.created_at ASC, ds.id ASC) AS rank
       FROM device_sessions ds
       WHERE ds.user_id = $1
         AND ds.last_seen_at > NOW() - INTERVAL '30 days'
     )
     SELECT id, rank::int AS rank, device_name, ip_address, device_hash,
            created_at, last_seen_at, ua
     FROM ranked
     ORDER BY rank`,
    [user.id]
  );

  console.log(`\nActive sessions (last 30 days), max_devices=${maxDevices}:`);
  console.log(`---------------------------------------------------------------`);
  for (const r of activeRes.rows) {
    const blocked = r.rank > maxDevices ? ' <-- BLOCKED (rank > max_devices)' : '';
    console.log(
      `  rank=${r.rank} id=${r.id} name="${r.device_name}" ip=${r.ip_address}\n`
      + `    hash="${r.device_hash}"\n`
      + `    created=${new Date(r.created_at).toISOString()} last_seen=${new Date(r.last_seen_at).toISOString()}\n`
      + `    ua="${r.ua}"${blocked}`
    );
  }
  console.log(`---------------------------------------------------------------`);
  console.log(`Total active: ${activeRes.rows.length}. Should block rows where rank > ${maxDevices}.`);

  // Also show stale sessions (>30 days) — they are ignored by enforcement
  const staleRes = await client.query(
    `SELECT id, device_name, device_hash, last_seen_at
     FROM device_sessions
     WHERE user_id = $1 AND last_seen_at <= NOW() - INTERVAL '30 days'
     ORDER BY last_seen_at DESC`,
    [user.id]
  );
  if (staleRes.rows.length > 0) {
    console.log(`\nStale sessions (>30 days, ignored by limit):`);
    for (const r of staleRes.rows) {
      console.log(`  id=${r.id} "${r.device_name}" hash="${r.device_hash}" last_seen=${new Date(r.last_seen_at).toISOString()}`);
    }
  }
}

main()
  .catch((err) => { console.error('Error:', err); process.exitCode = 1; })
  .finally(() => client.end());
