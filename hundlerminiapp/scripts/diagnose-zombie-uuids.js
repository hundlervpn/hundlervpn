/**
 * diagnose-zombie-uuids.js — Find users whose Happ configs reference a UUID
 * that /api/xray/clients does NOT include, so Xray rejects them with
 * "invalid request user id". Symptom: VPN dies, user fixes by deleting the
 * device + refreshing subscription (forces a new per-device UUID).
 *
 * Runs read-only diagnostic SQL against Timeweb prod DB. Pass --fix to
 * trigger remediation paths (optional, OFF by default).
 *
 * Usage:
 *   node scripts/diagnose-zombie-uuids.js
 *   node scripts/diagnose-zombie-uuids.js --fix
 */

const { Client } = require('pg');

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

const FIX = process.argv.includes('--fix');
const USER_ARG = process.argv.find((a) => a.startsWith('--user='));
const FOCUS_USER_ID = USER_ARG ? parseInt(USER_ARG.split('=')[1], 10) : null;

async function focusOnUser(c, userId) {
  console.log();
  console.log(`════════ DEEP DIVE: users.id = ${userId} ════════`);

  const u = await c.query(
    `SELECT id, telegram_id, username, first_name, created_at
       FROM users WHERE id = $1`,
    [userId],
  );
  if (u.rowCount === 0) {
    console.log('  User not found.');
    return;
  }
  console.table(u.rows);

  const subs = await c.query(
    `SELECT id, status, end_date, traffic_used_bytes, created_at
       FROM subscriptions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 5`,
    [userId],
  );
  console.log(`  Subscriptions (last 5):`);
  console.table(subs.rows);

  const sessions = await c.query(
    `SELECT id, device_name, last_seen_at, kicked_at, created_at, vpn_key_id
       FROM device_sessions WHERE user_id = $1
       ORDER BY COALESCE(last_seen_at, created_at) DESC`,
    [userId],
  );
  console.log(`  Device sessions:`);
  console.table(sessions.rows.map((r) => ({
    id: r.id,
    device: (r.device_name || '').slice(0, 24),
    last_seen: r.last_seen_at ? new Date(r.last_seen_at).toISOString().slice(0, 16) : null,
    kicked: r.kicked_at ? new Date(r.kicked_at).toISOString().slice(0, 16) : null,
    created: r.created_at ? new Date(r.created_at).toISOString().slice(0, 16) : null,
    vpn_key_id: r.vpn_key_id,
  })));

  const keys = await c.query(
    `SELECT vk.id, vk.key_uri, vk.key_hash, vk.is_active, vk.created_at,
            vk.last_connected_at, vk.expires_at,
            up.id AS pool_id, up.assigned_to_key_id AS pool_bound_to
       FROM vpn_keys vk
       LEFT JOIN uuid_pool up ON up.uuid::text = vk.key_hash
       WHERE vk.user_id = $1
       ORDER BY vk.created_at DESC`,
    [userId],
  );
  console.log(`  VPN keys:`);
  console.table(keys.rows.map((r) => ({
    id: r.id,
    uri: r.key_uri,
    uuid: (r.key_hash || '').slice(0, 8),
    active: r.is_active,
    created: r.created_at ? new Date(r.created_at).toISOString().slice(0, 16) : null,
    last_conn: r.last_connected_at ? new Date(r.last_connected_at).toISOString().slice(0, 16) : null,
    pool_id: r.pool_id,
    pool_bound_to: r.pool_bound_to,
    bound_match: r.pool_bound_to === r.id ? 'OK' : 'MISMATCH',
  })));
}

async function historicalAnalysis(c) {
  console.log();
  console.log('════════ HISTORICAL ANALYSIS (last 30 days) ════════');

  // (a) Device deletions (sessions kicked) by user (NOT by admin/expiry).
  const kicks = await c.query(`
    SELECT
      COUNT(*) AS total_kicks,
      COUNT(DISTINCT user_id) AS distinct_users
    FROM device_sessions
    WHERE kicked_at IS NOT NULL
      AND kicked_at > NOW() - INTERVAL '30 days'
  `);
  console.log(`  Device kicks (30d): ${kicks.rows[0].total_kicks} ` +
    `across ${kicks.rows[0].distinct_users} unique users`);

  // (b) Pattern "kicked + new per-device vpn_key created within 1h after kick".
  //     This is the "delete + refresh" zombie-fix workflow.
  const fixPattern = await c.query(`
    SELECT
      u.id AS user_id,
      u.telegram_id,
      ds.id AS kicked_session,
      ds.kicked_at,
      vk.id AS new_key_id,
      vk.created_at AS key_created,
      EXTRACT(EPOCH FROM vk.created_at - ds.kicked_at) AS gap_seconds
    FROM device_sessions ds
    JOIN users u ON u.id = ds.user_id
    JOIN vpn_keys vk
      ON vk.user_id = u.id
     AND vk.key_uri = 'per-device'
     AND vk.created_at >= ds.kicked_at
     AND vk.created_at <= ds.kicked_at + INTERVAL '1 hour'
    WHERE ds.kicked_at > NOW() - INTERVAL '30 days'
    ORDER BY ds.kicked_at DESC
  `);
  console.log(`  "Kick + new key within 1h" events: ${fixPattern.rowCount}`);
  console.log(`    (this is the zombie-fix workflow signature)`);
  if (fixPattern.rowCount > 0) {
    console.log(`    Top 10 most recent:`);
    console.table(fixPattern.rows.slice(0, 10).map((r) => ({
      user_id: r.user_id,
      tg: r.telegram_id,
      kicked_at: r.kicked_at ? new Date(r.kicked_at).toISOString().slice(0, 16) : null,
      gap_min: Math.round(r.gap_seconds / 60),
    })));

    // Count unique users.
    const uniq = new Set(fixPattern.rows.map((r) => r.user_id));
    console.log(`    UNIQUE users who did the "delete+refresh" dance: ${uniq.size}`);
  }

  // (c) Currently inactive vpn_keys for users with active subscriptions.
  //     These are NOT zombies right now (sessions point elsewhere or are
  //     gone), but if a user's Happ config still caches one of these UUIDs,
  //     they're broken until next sub poll.
  const dormant = await c.query(`
    SELECT COUNT(*) AS cnt
    FROM vpn_keys vk
    JOIN subscriptions s
      ON s.user_id = vk.user_id AND s.status = 'active' AND s.end_date > NOW()
    WHERE vk.is_active = FALSE
      AND vk.key_hash IS NOT NULL
      AND vk.key_hash NOT LIKE 'pending-%'
      AND vk.created_at > NOW() - INTERVAL '90 days'
  `);
  console.log(`  Inactive vpn_keys (active sub, last 90d): ${dormant.rows[0].cnt}`);
  console.log(`    (each one is a UUID a user's Happ could be caching)`);

  // (d) Pool rows orphaned: assigned_to_key_id points at a vpn_key that
  //     no longer exists OR is inactive.
  const orphanPool = await c.query(`
    SELECT COUNT(*) AS cnt
    FROM uuid_pool up
    LEFT JOIN vpn_keys vk ON vk.id = up.assigned_to_key_id
    WHERE up.assigned_to_key_id IS NOT NULL
      AND (vk.id IS NULL OR vk.is_active = FALSE)
  `);
  console.log(`  Orphan pool rows (bound to dead/inactive key): ${orphanPool.rows[0].cnt}`);
  console.log();
}

async function main() {
  const c = new Client({ connectionString: CONNECTION_STRING });
  await c.connect();
  console.log(`[diag] Connected (${FIX ? 'FIX MODE' : 'READ-ONLY'})`);
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // ZOMBIE TYPE 1: active session, but its linked vpn_key.is_active = FALSE
  // → /api/xray/clients filters it out, but ensureSessionUuid will reuse
  //   that dead key on next sub poll (the "if (linkedKeyId)" branch).
  // Fix: when sub-endpoint touches this row it flips is_active back to TRUE
  // — but only IF the user actually polls. Users currently offline stay
  // zombie until they re-open Happ.
  // ────────────────────────────────────────────────────────────────────────
  console.log('▶ Type 1: active session → inactive vpn_key');
  const t1 = await c.query(`
    SELECT
      u.telegram_id,
      ds.id AS session_id,
      ds.device_name,
      ds.last_seen_at AS last_seen,
      vk.id AS vpn_key_id,
      vk.is_active AS key_active,
      vk.key_uri,
      vk.expires_at,
      s.status AS sub_status,
      s.end_date AS sub_end
    FROM device_sessions ds
    JOIN users u ON u.id = ds.user_id
    JOIN vpn_keys vk ON vk.id = ds.vpn_key_id
    LEFT JOIN subscriptions s
      ON s.user_id = u.id AND s.status = 'active' AND s.end_date > NOW()
    WHERE ds.kicked_at IS NULL
      AND ds.vpn_key_id IS NOT NULL
      AND vk.is_active = FALSE
      AND vk.key_hash IS NOT NULL
      AND vk.key_hash NOT LIKE 'pending-%'
      AND s.id IS NOT NULL
    ORDER BY ds.last_seen_at DESC NULLS LAST
  `);
  console.log(`  Found: ${t1.rowCount}`);
  if (t1.rowCount > 0) {
    console.table(t1.rows.slice(0, 10).map((r) => ({
      tg: r.telegram_id,
      session: r.session_id,
      device: (r.device_name || '').slice(0, 20),
      last_seen: r.last_seen ? new Date(r.last_seen).toISOString().slice(0, 16) : null,
      vpn_key_id: r.vpn_key_id,
      sub_end: r.sub_end ? new Date(r.sub_end).toISOString().slice(0, 10) : null,
    })));
  }
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // ZOMBIE TYPE 2: active session, active vpn_key, but uuid_pool row missing
  // or pointing to a DIFFERENT vpn_key. /api/xray/clients output joins via
  // up.assigned_to_key_id — mismatch → UUID excluded → Happ config breaks.
  // ────────────────────────────────────────────────────────────────────────
  console.log('▶ Type 2: active session + active key → pool row missing/wrong');
  const t2 = await c.query(`
    SELECT
      u.telegram_id,
      ds.id AS session_id,
      ds.device_name,
      vk.id AS vpn_key_id,
      vk.key_hash AS uuid,
      up.id AS pool_id,
      up.assigned_to_key_id AS pool_bound_to,
      ds.last_seen_at AS last_seen
    FROM device_sessions ds
    JOIN users u ON u.id = ds.user_id
    JOIN vpn_keys vk ON vk.id = ds.vpn_key_id
    JOIN subscriptions s ON s.user_id = u.id
                        AND s.status = 'active' AND s.end_date > NOW()
    LEFT JOIN uuid_pool up ON up.uuid::text = vk.key_hash
    WHERE ds.kicked_at IS NULL
      AND vk.is_active = TRUE
      AND vk.key_hash IS NOT NULL
      AND vk.key_hash NOT LIKE 'pending-%'
      AND (up.id IS NULL OR up.assigned_to_key_id IS DISTINCT FROM vk.id)
    ORDER BY ds.last_seen_at DESC NULLS LAST
  `);
  console.log(`  Found: ${t2.rowCount}`);
  if (t2.rowCount > 0) {
    console.table(t2.rows.slice(0, 10).map((r) => ({
      tg: r.telegram_id,
      session: r.session_id,
      vpn_key_id: r.vpn_key_id,
      uuid: r.uuid?.slice(0, 8),
      pool_id: r.pool_id,
      pool_bound_to: r.pool_bound_to,
      issue: r.pool_id == null ? 'pool row missing' : 'pool bound to other key',
    })));
  }
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // ZOMBIE TYPE 3: active session with vpn_key_id IS NULL (never linked).
  // Should be transient (next sub poll links it via ensureSessionUuid).
  // If we see a row last_seen long after creation → user's Happ config is
  // pointing at an older shared UUID that may or may not still exist.
  // ────────────────────────────────────────────────────────────────────────
  console.log('▶ Type 3: active session WITHOUT linked vpn_key (vpn_key_id NULL)');
  const t3 = await c.query(`
    SELECT
      u.telegram_id,
      ds.id AS session_id,
      ds.device_name,
      ds.last_seen_at AS last_seen,
      ds.created_at,
      s.end_date AS sub_end
    FROM device_sessions ds
    JOIN users u ON u.id = ds.user_id
    JOIN subscriptions s ON s.user_id = u.id
                        AND s.status = 'active' AND s.end_date > NOW()
    WHERE ds.kicked_at IS NULL
      AND ds.vpn_key_id IS NULL
    ORDER BY ds.last_seen_at DESC NULLS LAST
  `);
  console.log(`  Found: ${t3.rowCount}`);
  if (t3.rowCount > 0) {
    console.table(t3.rows.slice(0, 10).map((r) => ({
      tg: r.telegram_id,
      session: r.session_id,
      device: (r.device_name || '').slice(0, 20),
      created: r.created_at ? new Date(r.created_at).toISOString().slice(0, 16) : null,
      last_seen: r.last_seen ? new Date(r.last_seen).toISOString().slice(0, 16) : null,
    })));
  }
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // ZOMBIE TYPE 4: shared/legacy vpn_key is_active=TRUE, but no pool row.
  // /api/xray/clients orphan_keys CTE would include this if pool row exists.
  // Without pool row → UUID excluded → users still on shared key are dead.
  // ────────────────────────────────────────────────────────────────────────
  console.log('▶ Type 4: active shared/legacy vpn_key → pool row missing');
  const t4 = await c.query(`
    SELECT
      u.telegram_id,
      vk.id AS vpn_key_id,
      vk.key_uri,
      vk.key_hash AS uuid,
      vk.last_connected_at,
      up.id AS pool_id
    FROM vpn_keys vk
    JOIN users u ON u.id = vk.user_id
    JOIN subscriptions s ON s.user_id = u.id
                        AND s.status = 'active' AND s.end_date > NOW()
    LEFT JOIN uuid_pool up ON up.uuid::text = vk.key_hash
                          AND up.assigned_to_key_id = vk.id
    WHERE vk.is_active = TRUE
      AND vk.key_hash IS NOT NULL
      AND vk.key_hash NOT LIKE 'pending-%'
      AND vk.key_uri != 'per-device'
      AND up.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM device_sessions ds
        WHERE ds.vpn_key_id = vk.id AND ds.kicked_at IS NULL
      )
    ORDER BY vk.last_connected_at DESC NULLS LAST
  `);
  console.log(`  Found: ${t4.rowCount}`);
  if (t4.rowCount > 0) {
    console.table(t4.rows.slice(0, 10).map((r) => ({
      tg: r.telegram_id,
      vpn_key_id: r.vpn_key_id,
      uri: r.key_uri,
      uuid: r.uuid?.slice(0, 8),
      last_conn: r.last_connected_at ? new Date(r.last_connected_at).toISOString().slice(0, 10) : null,
    })));
  }
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // CONTEXT: how many users have ANY zombie indicator across the 4 types.
  // ────────────────────────────────────────────────────────────────────────
  const unionTg = new Set();
  for (const t of [t1, t2, t3, t4]) {
    for (const r of t.rows) if (r.telegram_id) unionTg.add(r.telegram_id);
  }

  // Active users (subscription valid) for ratio.
  const total = await c.query(`
    SELECT COUNT(DISTINCT u.id) AS cnt
    FROM users u
    JOIN subscriptions s
      ON s.user_id = u.id AND s.status = 'active' AND s.end_date > NOW()
  `);
  const activeUsers = parseInt(total.rows[0]?.cnt || '0', 10);

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Type 1 (active session → inactive key):   ${t1.rowCount}`);
  console.log(`  Type 2 (pool row missing/wrong):           ${t2.rowCount}`);
  console.log(`  Type 3 (session w/o vpn_key_id):           ${t3.rowCount}`);
  console.log(`  Type 4 (legacy shared key no pool):        ${t4.rowCount}`);
  console.log(`  ───────────────────────────────────────────`);
  console.log(`  UNIQUE affected users:                     ${unionTg.size}`);
  console.log(`  Active users with valid sub:               ${activeUsers}`);
  if (activeUsers > 0) {
    const pct = ((unionTg.size / activeUsers) * 100).toFixed(1);
    console.log(`  Zombie ratio:                              ${pct}%`);
  }
  console.log('═══════════════════════════════════════════════════════════');

  // Historical / deep-dive sections.
  await historicalAnalysis(c);
  if (FOCUS_USER_ID) await focusOnUser(c, FOCUS_USER_ID);

  // ────────────────────────────────────────────────────────────────────────
  // OPTIONAL FIX MODE
  // ────────────────────────────────────────────────────────────────────────
  if (FIX) {
    console.log();
    console.log('[fix] Applying remediations…');

    // Type 1 fix: reactivate vpn_key for sessions still alive on active sub.
    const f1 = await c.query(`
      UPDATE vpn_keys vk
         SET is_active = TRUE
        FROM device_sessions ds, subscriptions s
       WHERE vk.id = ds.vpn_key_id
         AND ds.kicked_at IS NULL
         AND vk.is_active = FALSE
         AND vk.key_hash IS NOT NULL
         AND vk.key_hash NOT LIKE 'pending-%'
         AND s.user_id = vk.user_id
         AND s.status = 'active'
         AND s.end_date > NOW()
    `);
    console.log(`  Type 1: reactivated ${f1.rowCount} vpn_keys`);

    // Type 2 fix: re-bind pool row to correct vpn_key (or insert if missing).
    const f2 = await c.query(`
      INSERT INTO uuid_pool (uuid, assigned_to_key_id, assigned_at)
      SELECT vk.key_hash::uuid, vk.id, NOW()
        FROM vpn_keys vk
        JOIN device_sessions ds ON ds.vpn_key_id = vk.id
        JOIN subscriptions s
          ON s.user_id = vk.user_id AND s.status = 'active' AND s.end_date > NOW()
       WHERE ds.kicked_at IS NULL
         AND vk.is_active = TRUE
         AND vk.key_hash IS NOT NULL
         AND vk.key_hash NOT LIKE 'pending-%'
      ON CONFLICT (uuid) DO UPDATE
         SET assigned_to_key_id = EXCLUDED.assigned_to_key_id,
             assigned_at = NOW()
       WHERE uuid_pool.assigned_to_key_id IS DISTINCT FROM EXCLUDED.assigned_to_key_id
    `);
    console.log(`  Type 2: healed ${f2.rowCount} pool rows (sessions)`);

    // Type 4 fix: re-bind pool row for legacy shared keys too.
    const f4 = await c.query(`
      INSERT INTO uuid_pool (uuid, assigned_to_key_id, assigned_at)
      SELECT vk.key_hash::uuid, vk.id, NOW()
        FROM vpn_keys vk
        JOIN subscriptions s
          ON s.user_id = vk.user_id AND s.status = 'active' AND s.end_date > NOW()
       WHERE vk.is_active = TRUE
         AND vk.key_hash IS NOT NULL
         AND vk.key_hash NOT LIKE 'pending-%'
         AND vk.key_uri != 'per-device'
         AND NOT EXISTS (
           SELECT 1 FROM uuid_pool up
            WHERE up.uuid::text = vk.key_hash AND up.assigned_to_key_id = vk.id
         )
      ON CONFLICT (uuid) DO UPDATE
         SET assigned_to_key_id = EXCLUDED.assigned_to_key_id,
             assigned_at = NOW()
       WHERE uuid_pool.assigned_to_key_id IS DISTINCT FROM EXCLUDED.assigned_to_key_id
    `);
    console.log(`  Type 4: healed ${f4.rowCount} pool rows (legacy shared)`);

    console.log();
    console.log('[fix] Done. Webhook NOT auto-fired from this script.');
    console.log('[fix] To push to VPN nodes immediately, hit:');
    console.log('      curl -X POST "http://185.238.169.235:9999/sync?token=$XRAY_SYNC_TOKEN"');
    console.log('      curl -X POST "http://213.182.213.183:9999/sync?token=$XRAY_SYNC_TOKEN"');
    console.log('      curl -X POST "http://85.239.53.25:9999/sync?token=$XRAY_SYNC_TOKEN"');
    console.log('      Otherwise next cron tick (~5 min) picks it up automatically.');
  }

  await c.end();
}

main().catch((err) => {
  console.error('[diag] ERROR:', err);
  process.exit(1);
});
