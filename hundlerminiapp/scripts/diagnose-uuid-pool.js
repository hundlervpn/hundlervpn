/**
 * diagnose-uuid-pool.js — Audit uuid_pool state.
 *
 * Answers:
 *   1. How many UUIDs total / free / assigned, and of the assigned ones —
 *      how many bound to alive vs dead keys (orphans).
 *   2. How many of the assigned-to-active-key rows actually surface in
 *      /api/xray/clients output (= what VPN servers actually accept).
 *   3. Whether newly-added pool rows (assigned_to_key_id IS NULL) WILL be
 *      pushed to VPN servers on next xray-sync — yes, they always are,
 *      because /api/xray/clients includes free pool rows so Xray
 *      preloads them as "known clients" and assigning them to a real
 *      user later doesn't require a restart.
 *
 * Read-only.
 */
const { Client } = require('pg');

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

async function main() {
  const c = new Client({ connectionString: CONNECTION_STRING });
  await c.connect();

  console.log('═══════════════════ UUID POOL AUDIT ═══════════════════');

  const total = await c.query(`SELECT COUNT(*)::int AS n FROM uuid_pool`);
  console.log(`Total pool rows:                    ${total.rows[0].n}`);

  const free = await c.query(
    `SELECT COUNT(*)::int AS n FROM uuid_pool WHERE assigned_to_key_id IS NULL`
  );
  console.log(`Free (unassigned, ready to claim):  ${free.rows[0].n}`);

  const assigned = await c.query(
    `SELECT COUNT(*)::int AS n FROM uuid_pool WHERE assigned_to_key_id IS NOT NULL`
  );
  console.log(`Assigned (bound to a vpn_key):      ${assigned.rows[0].n}`);
  console.log();

  // Breakdown of assigned rows by health.
  console.log('▶ Assigned-row breakdown:');

  const byVpnKey = await c.query(`
    SELECT
      CASE
        WHEN vk.id IS NULL THEN 'A: vpn_key DOES NOT EXIST (FK dangling)'
        WHEN vk.is_active = FALSE THEN 'B: vpn_key inactive (subscription expired / migrated)'
        WHEN vk.key_hash IS NULL OR vk.key_hash LIKE 'pending-%' THEN
          'C: vpn_key has placeholder hash (mid-creation)'
        WHEN vk.key_uri = 'per-device' THEN 'D: per-device active key (live device session expected)'
        ELSE 'E: legacy/shared active key'
      END AS bucket,
      COUNT(*)::int AS cnt
    FROM uuid_pool up
    LEFT JOIN vpn_keys vk ON vk.id = up.assigned_to_key_id
    WHERE up.assigned_to_key_id IS NOT NULL
    GROUP BY bucket
    ORDER BY bucket
  `);
  for (const r of byVpnKey.rows) {
    console.log(`  ${r.bucket}: ${r.cnt}`);
  }
  console.log();

  // What /api/xray/clients actually exports — the real number Xray sees.
  console.log('▶ What /api/xray/clients ships to Xray right now:');

  const xraySnapshot = await c.query(`
    WITH active_subs AS (
      SELECT s.user_id FROM subscriptions s
      WHERE s.status = 'active' AND s.end_date > NOW()
    ),
    active_keys AS (
      SELECT DISTINCT vk.id
        FROM vpn_keys vk
        JOIN active_subs a ON a.user_id = vk.user_id
       WHERE vk.is_active = TRUE
         AND vk.key_hash IS NOT NULL
         AND vk.key_hash NOT LIKE 'pending-%'
    )
    SELECT
      COUNT(*) FILTER (WHERE up.assigned_to_key_id IS NULL)::int AS free_in_snapshot,
      COUNT(*) FILTER (WHERE up.assigned_to_key_id IN (SELECT id FROM active_keys))::int AS assigned_active,
      COUNT(*) FILTER (
        WHERE up.assigned_to_key_id IS NOT NULL
          AND up.assigned_to_key_id NOT IN (SELECT id FROM active_keys)
      )::int AS dropped_orphan
    FROM uuid_pool up
  `);
  const snap = xraySnapshot.rows[0];
  console.log(`  Free pool rows (preloaded as known IDs):  ${snap.free_in_snapshot}`);
  console.log(`  Assigned & active (real users):           ${snap.assigned_active}`);
  console.log(`  Skipped (orphan — won't reach Xray):      ${snap.dropped_orphan}`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  TOTAL UUIDs Xray will accept after sync:  ${snap.free_in_snapshot + snap.assigned_active}`);
  console.log();

  // Activity stats.
  const recent = await c.query(`
    SELECT
      MIN(assigned_at) FILTER (WHERE assigned_to_key_id IS NOT NULL) AS oldest_assign,
      MAX(assigned_at) FILTER (WHERE assigned_to_key_id IS NOT NULL) AS newest_assign,
      MIN(id) AS min_id,
      MAX(id) AS max_id
    FROM uuid_pool
  `);
  const r = recent.rows[0];
  console.log('▶ Pool meta:');
  console.log(`  pool_id range:       ${r.min_id} … ${r.max_id}`);
  console.log(`  oldest assignment:   ${r.oldest_assign ? new Date(r.oldest_assign).toISOString() : '—'}`);
  console.log(`  newest assignment:   ${r.newest_assign ? new Date(r.newest_assign).toISOString() : '—'}`);
  console.log();

  console.log('═══════════════════════════════════════════════════════');
  console.log('Notes:');
  console.log('  • Free pool rows are SHIPPED to Xray on every sync —');
  console.log('    they exist precisely so that giving a UUID to a new');
  console.log('    user does NOT require an Xray restart.');
  console.log('  • Orphan-assigned rows are FILTERED OUT in the snapshot');
  console.log('    SELECT (see app/api/xray/clients/route.ts) — Xray');
  console.log('    never sees them. They will be re-bound by next');
  console.log('    /api/sub/[token] poll (the user gets a fresh active');
  console.log('    UUID, the orphan stays in pool until acquireUuid');
  console.log('    skips it via the "assigned_to_key_id IS NULL" filter,');
  console.log('    so they NEVER come back to a new user — they leak.');
  console.log('  • Garbage collection: scripts/cleanup-orphan-pool.js');
  console.log('    (if it exists) or DELETE FROM uuid_pool WHERE bucket A.');
  console.log('═══════════════════════════════════════════════════════');

  await c.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
