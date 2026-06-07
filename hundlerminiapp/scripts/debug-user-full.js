// Full per-user VPN diagnostic.
//
// Usage:
//   node scripts/debug-user-full.js <telegram_id>      # e.g. 2029065770
//   node scripts/debug-user-full.js u:<user_id>        # e.g. u:2033 (email-only user)
//
// Dumps:
//   - users row (telegram_id, email, ban flags, created_at)
//   - latest subscription row (status, end_date, plan, max_devices)
//   - ALL vpn_keys (key_uri, is_active, key_hash, expires_at)
//   - ALL device_sessions (kicked_at, last_seen_at, device_hash, ip, user_agent,
//     joined to uuid_pool so you can see which UUID each device claimed)
//   - Live Xray client snapshot — does each active UUID still exist in
//     /api/xray/clients (i.e. will Xray accept the connection after the
//     next sync)
//   - High-level summary (over device limit, subscription expired, key
//     mismatch, etc.) so you don't have to eyeball the JSON.
//
// Read-only. Safe to run against production.

const { Pool } = require('pg');
const { createHmac } = require('node:crypto');

const ARG = process.argv[2];
if (!ARG) {
  console.error('Usage:');
  console.error('  node scripts/debug-user-full.js <telegram_id>');
  console.error('  node scripts/debug-user-full.js u:<user_id>');
  process.exit(1);
}

const BY_USER_ID = ARG.startsWith('u:');
const ID_VALUE = BY_USER_ID ? Number(ARG.slice(2)) : Number(ARG);
if (!Number.isFinite(ID_VALUE) || ID_VALUE <= 0) {
  console.error(`Invalid id: ${ARG}`);
  process.exit(1);
}

const TOKEN = process.env.XRAY_SYNC_TOKEN || 'hVpN2026sEcReT_xR4y';
const BASE = process.env.APP_URL || 'https://hundlervpn.xyz';

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

function fmtTs(ts) {
  if (!ts) return 'null';
  return new Date(ts).toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function generateSubToken(telegramId) {
  const idPart = Buffer.from(String(telegramId)).toString('base64url');
  const sig = createHmac('sha256', TOKEN)
    .update(`sub:${telegramId}`)
    .digest('base64url')
    .slice(0, 12);
  return `${idPart}${sig}`;
}

function generateSubTokenForUser(userId) {
  const idPart = Buffer.from(`u${userId}`).toString('base64url');
  const sig = createHmac('sha256', TOKEN)
    .update(`subu:${userId}`)
    .digest('base64url')
    .slice(0, 12);
  return `${idPart}${sig}`;
}

async function main() {
  const client = await pool.connect();
  try {
    // 1. Resolve user.
    const where = BY_USER_ID ? 'u.id = $1' : 'u.telegram_id = $1';
    const userRes = await client.query(
      `SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name,
              u.email, u.is_banned, u.ban_reason, u.ban_type,
              u.created_at, u.updated_at, u.last_seen_at
         FROM users u
        WHERE ${where}
        LIMIT 1`,
      [ID_VALUE]
    );
    if (userRes.rows.length === 0) {
      console.log(`No user found for ${ARG}`);
      return;
    }
    const user = userRes.rows[0];

    console.log('═══ USER ═══');
    console.log(`  id            = ${user.id}`);
    console.log(`  telegram_id   = ${user.telegram_id ?? '(none)'}`);
    console.log(`  username      = ${user.username ?? '(none)'}`);
    console.log(`  name          = ${[user.first_name, user.last_name].filter(Boolean).join(' ') || '(none)'}`);
    console.log(`  email         = ${user.email ?? '(none)'}`);
    console.log(`  is_banned     = ${user.is_banned} ${user.ban_reason ? `(${user.ban_reason})` : ''}`);
    console.log(`  created_at    = ${fmtTs(user.created_at)}`);
    console.log(`  last_seen_at  = ${fmtTs(user.last_seen_at)}`);

    // 2. Latest subscription.
    const subRes = await client.query(
      `SELECT s.id AS sub_id, s.status, s.start_date, s.end_date, s.plan_id,
              p.name AS plan_name, COALESCE(p.max_devices, 3) AS max_devices,
              EXTRACT(EPOCH FROM (s.end_date - NOW()))/86400 AS days_left_raw
         FROM subscriptions s
         LEFT JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = $1
        ORDER BY s.end_date DESC NULLS LAST
        LIMIT 1`,
      [user.id]
    );
    const sub = subRes.rows[0];

    console.log('\n═══ SUBSCRIPTION (latest) ═══');
    if (!sub) {
      console.log('  (none — user never had a subscription)');
    } else {
      const daysLeft = sub.days_left_raw == null ? null : Math.ceil(Number(sub.days_left_raw));
      const expired = sub.end_date && new Date(sub.end_date) < new Date();
      console.log(`  sub_id        = ${sub.sub_id}`);
      console.log(`  status        = ${sub.status}${expired ? '  ⚠ EXPIRED by date' : ''}`);
      console.log(`  plan          = ${sub.plan_name ?? '(custom)'}, max_devices=${sub.max_devices}`);
      console.log(`  start_date    = ${fmtTs(sub.start_date)}`);
      console.log(`  end_date      = ${fmtTs(sub.end_date)}  (${daysLeft != null ? `${daysLeft} days left` : 'no expiry'})`);
    }
    const maxDevices = sub?.max_devices ?? 3;

    // 3. vpn_keys.
    const keysRes = await client.query(
      `SELECT vk.id, vk.subscription_id, vk.key_uri, vk.key_hash, vk.is_active,
              vk.created_at, vk.expires_at, vk.last_connected_at, vk.device_name
         FROM vpn_keys vk
        WHERE vk.user_id = $1
        ORDER BY vk.is_active DESC, vk.created_at ASC`,
      [user.id]
    );
    console.log(`\n═══ VPN KEYS (${keysRes.rows.length}) ═══`);
    for (const k of keysRes.rows) {
      const expired = k.expires_at && new Date(k.expires_at) < new Date();
      const flags = [
        k.is_active ? 'ACTIVE' : 'inactive',
        k.key_uri === 'per-device' ? 'per-device' : 'shared',
        expired ? '⚠EXPIRED' : '',
      ].filter(Boolean).join(' / ');
      console.log(`  id=${k.id}  sub=${k.subscription_id ?? '-'}  [${flags}]`);
      console.log(`    key_hash      = ${k.key_hash ?? '(none)'}`);
      console.log(`    device_name   = ${k.device_name ?? '(none)'}`);
      console.log(`    created_at    = ${fmtTs(k.created_at)}`);
      console.log(`    expires_at    = ${fmtTs(k.expires_at)}`);
      console.log(`    last_conn_at  = ${fmtTs(k.last_connected_at)}`);
    }

    // 4. device_sessions WITH joined UUID pool data.
    const sessRes = await client.query(
      `SELECT ds.id, ds.device_hash, ds.device_name, ds.ip_address,
              SUBSTRING(ds.user_agent, 1, 140) AS ua,
              ds.created_at, ds.last_seen_at, ds.kicked_at,
              ds.vpn_key_id,
              up.uuid AS pool_uuid, up.assigned_at AS pool_assigned_at,
              vk.is_active AS key_active
         FROM device_sessions ds
         LEFT JOIN uuid_pool up ON up.assigned_to_key_id = ds.vpn_key_id
         LEFT JOIN vpn_keys  vk ON vk.id = ds.vpn_key_id
        WHERE ds.user_id = $1
        ORDER BY ds.kicked_at IS NULL DESC, ds.created_at ASC, ds.id ASC`,
      [user.id]
    );
    const liveSessions = sessRes.rows.filter((r) => r.kicked_at == null);
    const recentlyActive = liveSessions.filter(
      (r) => r.last_seen_at && new Date(r.last_seen_at) > new Date(Date.now() - 30 * 24 * 3600 * 1000),
    );
    console.log(`\n═══ DEVICE SESSIONS (${sessRes.rows.length} total, ${liveSessions.length} live, ${recentlyActive.length} active in last 30d) ═══`);
    let liveRank = 0;
    for (const s of sessRes.rows) {
      const isLive = s.kicked_at == null;
      if (isLive) liveRank++;
      const overLimit = isLive && liveRank > maxDevices;
      const tag = !isLive
        ? '🚫 KICKED'
        : overLimit
        ? `⛔ OVER-LIMIT (rank ${liveRank}>${maxDevices})`
        : `✓ LIVE (rank ${liveRank})`;
      console.log(`  id=${s.id}  ${tag}`);
      console.log(`    device_name   = ${s.device_name ?? '(none)'}`);
      console.log(`    device_hash   = ${s.device_hash}`);
      console.log(`    ip            = ${s.ip_address ?? '?'}`);
      console.log(`    ua            = ${s.ua ?? '?'}`);
      console.log(`    created_at    = ${fmtTs(s.created_at)}`);
      console.log(`    last_seen_at  = ${fmtTs(s.last_seen_at)}`);
      if (s.kicked_at) console.log(`    kicked_at     = ${fmtTs(s.kicked_at)}`);
      console.log(`    vpn_key_id    = ${s.vpn_key_id ?? '(none)'}  [key_active=${s.key_active ?? 'null'}]`);
      console.log(`    pool_uuid     = ${s.pool_uuid ?? '(no pool row — UUID purged or never assigned)'}`);
      if (s.pool_assigned_at) console.log(`    pool_assigned = ${fmtTs(s.pool_assigned_at)}`);
    }

    // 5. UUID pool counters.
    const poolUserRes = await client.query(
      `SELECT COUNT(*)::int AS assigned
         FROM uuid_pool up
         JOIN vpn_keys vk ON vk.id = up.assigned_to_key_id
        WHERE vk.user_id = $1`,
      [user.id]
    );
    const poolGlobalRes = await client.query(
      `SELECT COUNT(*) FILTER (WHERE assigned_to_key_id IS NULL)::int AS free,
              COUNT(*) FILTER (WHERE assigned_to_key_id IS NOT NULL)::int AS used,
              COUNT(*)::int AS total
         FROM uuid_pool`
    );
    console.log('\n═══ UUID POOL ═══');
    console.log(`  user-assigned UUIDs = ${poolUserRes.rows[0].assigned}`);
    console.log(`  global pool         = total ${poolGlobalRes.rows[0].total}, free ${poolGlobalRes.rows[0].free}, used ${poolGlobalRes.rows[0].used}`);

    // 6. Live Xray snapshot — for each pool_uuid the user owns, check it
    //    is still in /api/xray/clients (i.e. the next sync to the VPN VPS
    //    will keep accepting the connection).
    console.log('\n═══ XRAY LIVE SNAPSHOT CHECK ═══');
    let xraySet = null;
    let xrayLabels = null;
    try {
      const cliRes = await fetch(`${BASE}/api/xray/clients?token=${TOKEN}`);
      if (cliRes.ok) {
        const cliBody = await cliRes.json();
        const clients = cliBody.clients ?? [];
        xraySet = new Set(clients.map((c) => c.id));
        xrayLabels = new Map(clients.map((c) => [c.id, c.email]));
        console.log(`  /api/xray/clients OK — ${clients.length} clients in snapshot`);
      } else {
        console.log(`  /api/xray/clients HTTP ${cliRes.status}`);
      }
    } catch (e) {
      console.log(`  /api/xray/clients fetch failed: ${e.message}`);
    }
    if (xraySet) {
      const userUuids = sessRes.rows.filter((r) => r.pool_uuid).map((r) => ({
        sess: r.id,
        uuid: r.pool_uuid,
        kicked: r.kicked_at != null,
      }));
      if (userUuids.length === 0) {
        console.log('  user has NO pool UUIDs — all device_sessions either lack vpn_key_id or the UUID was purged');
      }
      for (const u of userUuids) {
        const inXray = xraySet.has(u.uuid);
        const label = xrayLabels.get(u.uuid) || '(unknown)';
        const verdict = inXray
          ? `✅ in Xray as ${label}`
          : '❌ MISSING from Xray (will be rejected with "user not found")';
        console.log(`  sess=${u.sess} uuid=${u.uuid}  ${verdict}${u.kicked ? ' [session was kicked]' : ''}`);
      }
    }

    // 7. Subscription URL the client uses.
    console.log('\n═══ SUBSCRIPTION URL ═══');
    let subUrl = null;
    if (user.telegram_id) {
      subUrl = `${BASE}/api/sub/${generateSubToken(Number(user.telegram_id))}`;
      console.log(`  (telegram-id token)  ${subUrl}`);
    }
    const userTokenUrl = `${BASE}/api/sub/${generateSubTokenForUser(Number(user.id))}`;
    console.log(`  (user-id token)      ${userTokenUrl}`);

    // 8. High-level summary.
    console.log('\n═══ SUMMARY ═══');
    const issues = [];
    if (user.is_banned) issues.push(`user is banned (${user.ban_reason || 'no reason'})`);
    if (!sub) issues.push('no subscription on file');
    else if (sub.end_date && new Date(sub.end_date) < new Date())
      issues.push('subscription is past end_date — UUIDs should already be purged');
    else if (sub.status !== 'active')
      issues.push(`subscription.status = ${sub.status} (not "active")`);
    if (recentlyActive.length > maxDevices)
      issues.push(`device count ${recentlyActive.length} > max ${maxDevices} → over-limit devices are blocked`);
    const liveWithoutPool = liveSessions.filter((r) => !r.pool_uuid);
    if (liveWithoutPool.length > 0)
      issues.push(`${liveWithoutPool.length} live device session(s) have NO pool UUID — Xray will reject them`);
    const liveMissingFromXray =
      xraySet
        ? liveSessions.filter((r) => r.pool_uuid && !xraySet.has(r.pool_uuid))
        : [];
    if (liveMissingFromXray.length > 0)
      issues.push(`${liveMissingFromXray.length} live device(s) have a pool UUID that is NOT in /api/xray/clients`);

    if (issues.length === 0) {
      console.log('  ✅ no issues detected on the data side');
      console.log('  if the client still fails, the problem is most likely outside our control:');
      console.log('     - mobile carrier doing DPI / SNI blocking');
      console.log('     - Xray VPS not synced yet (cron runs every 5 min, webhook fires on changes)');
      console.log('     - client cache — re-import the subscription URL in the VPN app');
    } else {
      for (const i of issues) console.log(`  ❌ ${i}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
