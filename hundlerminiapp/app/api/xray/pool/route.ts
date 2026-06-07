import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import {
  dedupeUserKeys,
  ensureInitialPool,
  forceRestoreAllActiveUsers,
  forceRestoreUserByTelegramId,
  getPoolStats,
  maybeRefill,
  purgeFreeUuids,
  refillPool,
  restoreActivePoolEntries,
} from '@/lib/uuid-pool';
import { triggerXraySync } from '@/lib/xray-webhook';

function authorized(req: Request): boolean {
  const url = new URL(req.url);
  const token =
    url.searchParams.get('token') || req.headers.get('x-xray-sync-token') || '';
  const expected = process.env.XRAY_SYNC_TOKEN;
  return !!expected && token === expected;
}

/**
 * GET /api/xray/pool — return pool stats.
 *   ?audit=1 → also include user-side health (count of subscribers in
 *              broken / healthy state, helpful to plan recovery actions).
 */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const stats = await getPoolStats();

  if (url.searchParams.get('audit') !== '1') {
    return NextResponse.json({ ok: true, ...stats });
  }

  // Audit: classify every active subscriber by their UUID-pool health.
  const audit = await dbQuery<{
    active_subscribers: string;
    with_active_key: string;
    with_pool_row: string;
    with_alive_session: string;
    broken_no_active_key: string;
    broken_no_pool_row: string;
  }>(
    `WITH active_subs AS (
       SELECT DISTINCT user_id
       FROM subscriptions
       WHERE status = 'active' AND end_date > NOW()
     ),
     per_user AS (
       SELECT
         a.user_id,
         BOOL_OR(vk.is_active = TRUE
                 AND vk.key_hash IS NOT NULL
                 AND vk.key_hash NOT LIKE 'pending-%') AS has_active_key,
         BOOL_OR(EXISTS (
           SELECT 1 FROM uuid_pool up
           WHERE up.assigned_to_key_id = vk.id
         )) AS has_pool_row,
         BOOL_OR(EXISTS (
           SELECT 1 FROM device_sessions ds
           WHERE ds.vpn_key_id = vk.id AND ds.kicked_at IS NULL
         )) AS has_alive_session
       FROM active_subs a
       LEFT JOIN vpn_keys vk ON vk.user_id = a.user_id
       GROUP BY a.user_id
     )
     SELECT
       COUNT(*)                                                 AS active_subscribers,
       COUNT(*) FILTER (WHERE has_active_key)                   AS with_active_key,
       COUNT(*) FILTER (WHERE has_pool_row)                     AS with_pool_row,
       COUNT(*) FILTER (WHERE has_alive_session)                AS with_alive_session,
       COUNT(*) FILTER (WHERE NOT has_active_key)               AS broken_no_active_key,
       COUNT(*) FILTER (WHERE has_active_key AND NOT has_pool_row) AS broken_no_pool_row
     FROM per_user`,
  );

  const a = audit.rows[0] ?? {} as any;
  const totalUsers = parseInt(a.active_subscribers || '0', 10);
  const okUsers = parseInt(a.with_pool_row || '0', 10);
  const brokenNoKey = parseInt(a.broken_no_active_key || '0', 10);
  const brokenNoPool = parseInt(a.broken_no_pool_row || '0', 10);
  const totalBroken = brokenNoKey + brokenNoPool;

  return NextResponse.json({
    ok: true,
    pool: stats,
    audit: {
      active_subscribers: totalUsers,
      with_active_key: parseInt(a.with_active_key || '0', 10),
      with_pool_row: okUsers,
      with_alive_session: parseInt(a.with_alive_session || '0', 10),
      broken: {
        total: totalBroken,
        no_active_vpn_key: brokenNoKey,
        active_key_but_no_pool_row: brokenNoPool,
      },
      health_pct: totalUsers > 0
        ? Math.round((okUsers / totalUsers) * 100)
        : 100,
    },
  });
}

/**
 * POST /api/xray/pool — manage the pool.
 *   ?action=seed         → ensure initial pool size (1000) exists
 *   ?action=refill       → add POOL_REFILL_BATCH (50) UUIDs
 *   ?action=auto         → top up only if free < watermark (idempotent)
 *   ?action=add&n=N      → add exactly N UUIDs
 *   ?action=purge-free   → ONE-SHOT migration: DELETE every currently-
 *                          free pool row. Use this once after deploying
 *                          v47 to invalidate the legacy "soft kick"
 *                          UUIDs that pre-v47 expired users may still
 *                          have cached on their clients. Active users
 *                          are NOT touched. Auto-fires Xray sync webhook
 *                          so propagation is ~1 second. Pool will be
 *                          re-seeded by `acquireUuid` on next signup.
 */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const action = (url.searchParams.get('action') || 'auto').toLowerCase();
  const n = parseInt(url.searchParams.get('n') || '0', 10);

  try {
    let added = 0;
    let purged = 0;
    let restored = 0;
    if (action === 'seed') {
      added = await ensureInitialPool();
    } else if (action === 'refill') {
      added = await refillPool(50);
    } else if (action === 'auto') {
      added = await maybeRefill();
    } else if (action === 'add') {
      if (!Number.isFinite(n) || n <= 0 || n > 10_000) {
        return NextResponse.json(
          { error: 'n must be 1..10000' },
          { status: 400 },
        );
      }
      added = await refillPool(n);
    } else if (action === 'purge-free') {
      purged = await purgeFreeUuids();
      if (purged > 0) {
        // Fan out to every configured webhook so Xray restarts and the
        // legacy stale UUIDs disappear from the accepted-clients list.
        void triggerXraySync('fire-and-forget').catch((err) => {
          console.warn('[xray/pool] xray sync trigger failed:', err);
        });
      }
    } else if (action === 'restore-active') {
      // EMERGENCY recovery: for every currently-active vpn_key whose UUID
      // is missing from uuid_pool (because past GC runs deleted/rotated
      // it while the key was briefly inactive between an expired and a
      // fresh subscription), re-insert a pool row with that exact UUID.
      // After this their cached VLESS configs reconnect — no re-import
      // needed.
      restored = await restoreActivePoolEntries();
      if (restored > 0) {
        void triggerXraySync('fire-and-forget').catch((err) => {
          console.warn('[xray/pool] xray sync trigger failed:', err);
        });
      }
    } else if (action === 'force-restore-all') {
      // Bulk recovery: reactivate + UPSERT pool rows for every user with
      // an active subscription. One-shot fix for the systemic state left
      // by the v47 hard-DELETE rollout. Idempotent.
      const r = await forceRestoreAllActiveUsers();
      if (r.keysReactivated > 0 || r.poolWritten > 0) {
        void triggerXraySync('fire-and-forget').catch((err) => {
          console.warn('[xray/pool] xray sync trigger failed:', err);
        });
      }
      const stats = await getPoolStats();
      return NextResponse.json({
        ok: true,
        action,
        keysReactivated: r.keysReactivated,
        poolWritten: r.poolWritten,
        ...stats,
      });
    } else if (action === 'dedupe-user') {
      // Cleanup helper for users whose vpn_keys table was bloated by an
      // emergency `force-restore-user` run. Keeps only the keys that are
      // actually in use (linked to alive device_sessions, plus one most
      // recent legacy key as fallback) and hard-deletes the orphaned pool
      // rows.
      const tid = parseInt(url.searchParams.get('tid') || '0', 10);
      if (!Number.isFinite(tid) || tid <= 0) {
        return NextResponse.json(
          { error: 'tid (telegram_id) required' },
          { status: 400 },
        );
      }
      const r = await dedupeUserKeys(tid);
      if (r.keysDeactivated > 0 || r.poolDeleted > 0) {
        void triggerXraySync('fire-and-forget').catch((err) => {
          console.warn('[xray/pool] xray sync trigger failed:', err);
        });
      }
      const stats = await getPoolStats();
      return NextResponse.json({
        ok: true,
        action,
        tid,
        keysDeactivated: r.keysDeactivated,
        poolDeleted: r.poolDeleted,
        ...stats,
      });
    } else if (action === 'force-restore-user') {
      // Per-user force recovery: reactivate every vpn_key for the given
      // telegram_id (provided the user has an active subscription) and
      // UPSERT the pool rows. Use when the user is stuck in the broken
      // state where their vpn_key.is_active=FALSE while their cached VLESS
      // config still uses the orphaned UUID.
      const tid = parseInt(url.searchParams.get('tid') || '0', 10);
      if (!Number.isFinite(tid) || tid <= 0) {
        return NextResponse.json(
          { error: 'tid (telegram_id) required' },
          { status: 400 },
        );
      }
      const r = await forceRestoreUserByTelegramId(tid);
      if (r.keysReactivated > 0 || r.poolWritten > 0) {
        void triggerXraySync('fire-and-forget').catch((err) => {
          console.warn('[xray/pool] xray sync trigger failed:', err);
        });
      }
      const stats = await getPoolStats();
      return NextResponse.json({
        ok: true,
        action,
        tid,
        keysReactivated: r.keysReactivated,
        poolWritten: r.poolWritten,
        ...stats,
      });
    } else {
      return NextResponse.json(
        { error: `unknown action: ${action}` },
        { status: 400 },
      );
    }

    const stats = await getPoolStats();
    return NextResponse.json({ ok: true, action, added, purged, restored, ...stats });
  } catch (err) {
    console.error('[xray/pool] error:', err);
    return NextResponse.json(
      { error: (err as Error).message ?? 'Internal error' },
      { status: 500 },
    );
  }
}
