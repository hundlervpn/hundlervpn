const { Client } = require('pg');
const client = new Client({
  host: '132.243.242.196', port: 5432, user: 'gen_user',
  password: 'HundlerVPN2026Strong', database: 'default_db', ssl: false,
});
const TG = Number(process.argv[2] || 2029065770);

async function main() {
  await client.connect();
  const u = await client.query(`SELECT id FROM users WHERE telegram_id = $1`, [TG]);
  const user_id = u.rows[0].id;

  console.log('\n=== device_sessions with vpn_key linkage ===');
  const ds = await client.query(
    `SELECT ds.id, ds.device_name, ds.device_hash, ds.vpn_key_id,
            ds.last_seen_at, vk.key_hash, vk.key_uri, vk.is_active AS key_active
     FROM device_sessions ds
     LEFT JOIN vpn_keys vk ON vk.id = ds.vpn_key_id
     WHERE ds.user_id = $1 AND ds.last_seen_at > NOW() - INTERVAL '30 days'
     ORDER BY ds.created_at ASC`,
    [user_id]
  );
  for (const r of ds.rows) {
    console.log(`  session id=${r.id} "${r.device_name}" hash="${r.device_hash.slice(0,40)}"`);
    console.log(`    vpn_key_id=${r.vpn_key_id} key_hash=${r.key_hash ?? 'NULL'} key_uri=${r.key_uri ?? 'NULL'} active=${r.key_active}`);
  }

  console.log('\n=== ALL vpn_keys for user ===');
  const keys = await client.query(
    `SELECT id, subscription_id, key_hash, key_uri, device_name, is_active, created_at, expires_at
     FROM vpn_keys WHERE user_id = $1 ORDER BY id`,
    [user_id]
  );
  for (const k of keys.rows) {
    console.log(`  key id=${k.id} sub=${k.subscription_id} hash=${k.key_hash?.slice(0,40)} uri="${k.key_uri.slice(0,30)}" dev="${k.device_name ?? '-'}" active=${k.is_active}`);
  }

  console.log('\n=== What /api/xray/clients would return for this user ===');
  const x = await client.query(
    `WITH active_subs AS (
       SELECT s.id AS sub_id, s.user_id, s.end_date,
              COALESCE(p.max_devices, 3) AS max_devices
       FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'active' AND s.end_date > NOW()
     ),
     ranked_sessions AS (
       SELECT ds.id AS session_id, ds.vpn_key_id, ds.user_id, a.end_date,
              ROW_NUMBER() OVER (PARTITION BY ds.user_id ORDER BY ds.created_at ASC, ds.id ASC) AS rank,
              a.max_devices
       FROM device_sessions ds
       JOIN active_subs a ON a.user_id = ds.user_id
       WHERE ds.last_seen_at > NOW() - INTERVAL '30 days'
     ),
     per_device_uuids AS (
       SELECT vk.key_hash AS uuid, CONCAT('tg-', u.telegram_id::text) AS email, rs.end_date AS "expiresAt", rs.user_id
       FROM ranked_sessions rs JOIN vpn_keys vk ON vk.id = rs.vpn_key_id
       JOIN users u ON u.id = rs.user_id
       WHERE rs.rank <= rs.max_devices AND rs.vpn_key_id IS NOT NULL
         AND vk.is_active = TRUE AND vk.key_hash IS NOT NULL
     ),
     users_pending_migration AS (
       SELECT DISTINCT user_id FROM ranked_sessions WHERE rank <= max_devices AND vpn_key_id IS NULL
     ),
     users_with_any_session AS (SELECT DISTINCT user_id FROM ranked_sessions),
     legacy_shared AS (
       SELECT vk.key_hash AS uuid, CONCAT('tg-', u.telegram_id::text) AS email, vk.expires_at AS "expiresAt", vk.user_id
       FROM vpn_keys vk
       JOIN users u ON u.id = vk.user_id
       LEFT JOIN subscriptions s ON s.id = vk.subscription_id
       WHERE vk.key_hash IS NOT NULL AND vk.key_uri != 'per-device' AND vk.is_active = TRUE
         AND (vk.expires_at IS NULL OR vk.expires_at > NOW())
         AND ((s.id IS NOT NULL AND s.status = 'active' AND s.end_date > NOW()) OR (s.id IS NULL))
         AND (
           vk.user_id IN (SELECT user_id FROM users_pending_migration)
           OR vk.user_id NOT IN (SELECT user_id FROM users_with_any_session)
         )
     )
     SELECT 'per-device' AS type, uuid, email FROM per_device_uuids WHERE user_id = $1
     UNION ALL
     SELECT 'legacy-shared' AS type, uuid, email FROM legacy_shared WHERE user_id = $1`,
    [user_id]
  );
  for (const r of x.rows) {
    console.log(`  [${r.type}] uuid=${r.uuid}  email=${r.email}`);
  }
}
main().catch(e => console.error(e)).finally(() => client.end());
