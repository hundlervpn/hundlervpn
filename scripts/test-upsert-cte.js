// Run the exact CTE used in /api/sub/[token] against the real DB to see
// whether it actually returns rows on INSERT vs UPDATE.

const { Client } = require('pg');

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

  const userRes = await client.query(`SELECT id FROM users WHERE telegram_id = 2029065770`);
  const user_id = userRes.rows[0].id;
  console.log(`user_id=${user_id}`);

  // Test case 1: EXISTING device (UPDATE path). Use ios hash already in DB.
  console.log('\n=== TEST 1: existing hash ios_2604141213534 (UPDATE case) ===');
  try {
    const r1 = await client.query(
      `WITH upserted AS (
         INSERT INTO device_sessions (user_id, device_hash, device_name, ip_address, user_agent, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, device_hash) DO UPDATE
           SET last_seen_at = NOW(),
               ip_address   = COALESCE(NULLIF(EXCLUDED.ip_address, ''), device_sessions.ip_address),
               user_agent   = COALESCE(NULLIF(EXCLUDED.user_agent, ''), device_sessions.user_agent)
         RETURNING id, (xmax = 0) AS is_insert
       ),
       ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rank
         FROM device_sessions
         WHERE user_id = $1 AND last_seen_at > NOW() - INTERVAL '30 days'
       )
       SELECT u.is_insert,
              r.rank::int AS rank,
              (SELECT COUNT(*)::int FROM ranked) AS total
       FROM upserted u
       JOIN ranked r ON r.id = u.id`,
      [user_id, 'ios_2604141213534', 'iPhone/iPad', '104.28.249.137', 'Happ/4.7.4/ios/2604141213534']
    );
    console.log('rows:', r1.rows);
  } catch (err) {
    console.error('ERR:', err.message);
    console.error('   code:', err.code, 'detail:', err.detail);
  }

  // Test case 2: BRAND NEW device (INSERT path)
  const testHash = `test_${Date.now()}`;
  console.log(`\n=== TEST 2: new hash ${testHash} (INSERT case) ===`);
  try {
    const r2 = await client.query(
      `WITH upserted AS (
         INSERT INTO device_sessions (user_id, device_hash, device_name, ip_address, user_agent, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, device_hash) DO UPDATE
           SET last_seen_at = NOW(),
               ip_address   = COALESCE(NULLIF(EXCLUDED.ip_address, ''), device_sessions.ip_address),
               user_agent   = COALESCE(NULLIF(EXCLUDED.user_agent, ''), device_sessions.user_agent)
         RETURNING id, (xmax = 0) AS is_insert
       ),
       ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rank
         FROM device_sessions
         WHERE user_id = $1 AND last_seen_at > NOW() - INTERVAL '30 days'
       )
       SELECT u.is_insert,
              r.rank::int AS rank,
              (SELECT COUNT(*)::int FROM ranked) AS total
       FROM upserted u
       JOIN ranked r ON r.id = u.id`,
      [user_id, testHash, 'TestDevice', '1.2.3.4', 'test-ua/1.0']
    );
    console.log('rows:', r2.rows, '(length:', r2.rows.length, ')');

    // Cleanup
    await client.query(`DELETE FROM device_sessions WHERE device_hash = $1`, [testHash]);
    console.log('(cleaned up test row)');
  } catch (err) {
    console.error('ERR:', err.message);
    console.error('   code:', err.code, 'detail:', err.detail);
  }
}

main().catch((e) => console.error(e)).finally(() => client.end());
