// Test 2-query approach for v10: upsert + rank query, both INSERT and UPDATE paths

const { Client } = require('pg');
const client = new Client({
  host: '132.243.242.196', port: 5432, user: 'gen_user',
  password: 'HundlerVPN2026Strong', database: 'default_db', ssl: false,
});

async function run(label, user_id, hash) {
  console.log(`\n=== ${label} ===`);
  const q1 = await client.query(
    `INSERT INTO device_sessions (user_id, device_hash, device_name, ip_address, user_agent, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, device_hash) DO UPDATE
       SET last_seen_at = NOW(),
           ip_address   = COALESCE(NULLIF(EXCLUDED.ip_address, ''), device_sessions.ip_address),
           user_agent   = COALESCE(NULLIF(EXCLUDED.user_agent, ''), device_sessions.user_agent)
     RETURNING id, (xmax = 0) AS is_insert`,
    [user_id, hash, 'TestDev', '1.2.3.4', 'test-ua']
  );
  console.log('  step1 rows:', q1.rows);
  if (!q1.rows[0]) return;

  const q2 = await client.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rank
       FROM device_sessions
       WHERE user_id = $1 AND last_seen_at > NOW() - INTERVAL '30 days'
     )
     SELECT r.rank::int AS rank, (SELECT COUNT(*)::int FROM ranked) AS total
     FROM ranked r WHERE r.id = $2`,
    [user_id, q1.rows[0].id]
  );
  console.log('  step2 rows:', q2.rows);
}

async function main() {
  await client.connect();
  const u = await client.query(`SELECT id FROM users WHERE telegram_id = 2029065770`);
  const user_id = u.rows[0].id;

  // UPDATE case (existing ios)
  await run('UPDATE: existing ios_2604141213534', user_id, 'ios_2604141213534');

  // INSERT case (brand new hash)
  const newHash = `test_${Date.now()}`;
  await run(`INSERT: new ${newHash}`, user_id, newHash);

  // Cleanup
  await client.query(`DELETE FROM device_sessions WHERE device_hash LIKE 'test_%'`);
  console.log('\n(cleaned up test rows)');
}

main().catch(e => console.error(e)).finally(() => client.end());
