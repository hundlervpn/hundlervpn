// Hot-fix for user 2029065770 (admin, telegram_id 2029065770).
//
// Diagnosis:
//   - User has 3 live device_sessions (iPhone, Win v2raytun, Win Happ).
//   - iPhone (sess 1839) is linked to vpn_key 260, key_uri = a literal
//     `vless://…` URI (legacy from before per-device migration).
//   - Win v2raytun (sess 2557) is linked to vpn_key 300, same legacy
//     non-`per-device` key_uri, bound to an EXPIRED subscription (109).
//   - Win Happ (sess 3954) is linked to vpn_key 407 with key_uri =
//     'per-device' — the only key the candidate logic does NOT touch.
//
//   The /api/users/state candidate-deduplication UPDATE (v62) does:
//     UPDATE vpn_keys SET is_active = (vk.id = candidate)
//      WHERE user_id = … AND key_uri != 'per-device' …
//   It picks ONE candidate per user. For this user the candidate is
//   vpn_key 407 (most recent valid key, ORDER BY created_at DESC). Since
//   the UPDATE excludes per-device keys, the actual rows it touches are
//   260 + 300 — both get is_active = FALSE because (vk.id != 407).
//   /api/sub/[token] re-activates 260 on every iPhone poll (60s), but
//   the next Mini App poll from the PC re-deactivates it. Net result:
//   the iPhone's UUID flickers in/out of /api/xray/clients and ends
//   up missing from Xray after the next 5-min cron sync.
//
// Fix:
//   1. Migrate vpn_keys 260, 300 to key_uri = 'per-device' so the
//      candidate UPDATE never touches them again.
//   2. Force is_active = TRUE on both, bind to sub 168 (the current
//      active subscription) and refresh expires_at to sub 168's end.
//   3. Heal uuid_pool rows so the UUIDs are bound to keys 260 / 300
//      (idempotent — likely already correct, but safe to re-bind).
//   4. Trigger the Xray webhook so NL + DE reload immediately.
//
// Read-write — apply ONCE.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

const TELEGRAM_ID = 2029065770;

(async () => {
  const c = await pool.connect();
  try {
    // 1. Find the currently active subscription for this user.
    const subRes = await c.query(
      `SELECT s.id, s.end_date
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
        WHERE u.telegram_id = $1
          AND s.status = 'active'
          AND s.end_date > NOW()
        ORDER BY s.end_date DESC
        LIMIT 1`,
      [String(TELEGRAM_ID)],
    );
    if (subRes.rows.length === 0) {
      console.log('No active subscription — bailing.');
      return;
    }
    const sub = subRes.rows[0];
    console.log(`Active subscription: id=${sub.id} end_date=${sub.end_date.toISOString()}`);

    // 2. Migrate vpn_keys 260, 300 to per-device + reactivate + bind to sub.
    const migr = await c.query(
      `UPDATE vpn_keys
          SET key_uri = 'per-device',
              is_active = TRUE,
              subscription_id = $1,
              expires_at = $2,
              last_connected_at = NOW()
        WHERE id IN (260, 300)
        RETURNING id, key_hash, is_active, key_uri, subscription_id, expires_at`,
      [sub.id, sub.end_date],
    );
    console.log(`\nUpdated ${migr.rowCount} vpn_keys:`);
    for (const r of migr.rows) {
      console.log(`  id=${r.id} key_uri=${r.key_uri} active=${r.is_active} sub=${r.subscription_id} exp=${r.expires_at.toISOString()}`);
      console.log(`    key_hash=${r.key_hash}`);
    }

    // 3. Heal uuid_pool: rebind the UUIDs to vpn_keys 260, 300, 407.
    //    ON CONFLICT updates the existing row instead of inserting a dupe.
    const sessRes = await c.query(
      `SELECT ds.id AS sess_id, ds.vpn_key_id, vk.key_hash
         FROM device_sessions ds
         JOIN vpn_keys vk ON vk.id = ds.vpn_key_id
        WHERE ds.kicked_at IS NULL
          AND ds.user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
      [String(TELEGRAM_ID)],
    );
    console.log(`\nLive sessions to heal pool for: ${sessRes.rows.length}`);
    for (const s of sessRes.rows) {
      if (!s.key_hash || s.key_hash.startsWith('pending-')) continue;
      const r = await c.query(
        `INSERT INTO uuid_pool (uuid, assigned_to_key_id, assigned_at)
         VALUES ($1::uuid, $2, NOW())
         ON CONFLICT (uuid) DO UPDATE
            SET assigned_to_key_id = EXCLUDED.assigned_to_key_id,
                assigned_at = NOW()
          WHERE uuid_pool.assigned_to_key_id IS DISTINCT FROM EXCLUDED.assigned_to_key_id
        RETURNING id, uuid, assigned_to_key_id`,
        [s.key_hash, s.vpn_key_id],
      );
      const action = r.rowCount > 0 ? 'WROTE' : 'no-op (already correct)';
      console.log(`  sess=${s.sess_id} vk=${s.vpn_key_id} uuid=${s.key_hash} → ${action}`);
    }

    // 4. Trigger the Xray webhook so NL + DE reload immediately.
    //    XRAY_WEBHOOK_URL is comma-separated.
    const webhookEnv =
      process.env.XRAY_WEBHOOK_URL ||
      'http://195.216.169.154:9999/sync,http://213.182.213.183:9999/sync,http://186.246.28.251:9999/sync';
    const urls = webhookEnv
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    console.log(`\nTriggering ${urls.length} webhook(s) (async=1):`);
    await Promise.all(
      urls.map(async (u) => {
        try {
          const start = Date.now();
          const res = await fetch(u + '?async=1', { method: 'POST' });
          console.log(`  ${u}  HTTP ${res.status}  (${Date.now() - start}ms)`);
        } catch (e) {
          console.log(`  ${u}  FAILED: ${e.message}`);
        }
      }),
    );

    console.log('\nDone. iPhone should reconnect within ~5 seconds (Xray reload time).');
    console.log('If iPhone is still N/A after a minute:');
    console.log('  - re-import the subscription URL in Happ (force-refresh the cached UUID list)');
    console.log('  - run `node scripts/debug-user-full.js 2029065770` again to verify state');
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
