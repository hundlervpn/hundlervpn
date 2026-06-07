/**
 * UUID Pool — pre-allocated VLESS UUIDs loaded into Xray config ahead of time.
 *
 * Xray-core (v26.x) does not support reliable hot-reload of client lists: the
 * `xray api adu` command silently fails with "Added 0 user(s)" because the
 * CLI cannot properly serialize the protobuf TypedMessage for the account
 * field. The only reliable way to add/remove users is `systemctl restart xray`
 * which drops ALL connections for 5-15 seconds.
 *
 * To avoid this restart on every signup we pre-load a large pool of UUIDs
 * (1000 by default) into Xray config with placeholder emails (`pool-N`).
 * When a user needs a UUID we take one from the pool and just re-label the
 * email in the next sync (no Xray restart needed — UUID is already loaded).
 *
 * Rare restarts (once per few days/weeks) happen when the free pool drops
 * below a threshold and we extend it; otherwise Xray runs untouched.
 */

import { randomUUID } from 'crypto';
import { dbQuery } from './db';
import type { PoolClient } from 'pg';
import { getDbPool } from './db';

/**
 * Pool sizing constants. Optimised for a service with hundreds of new
 * signups per day. Each refill triggers a (rare) Xray restart on every
 * VPN server (5-15s downtime), so we prefer infrequent large batches
 * over frequent small ones.
 *
 * At 500 free UUIDs below 100-mark → one refill (+500) handles the next
 *   ~400-500 signups before another restart is needed.
 * At 100 UUIDs in Xray config = ~20 KB RAM, 10k = ~2 MB, 100k = ~20 MB
 *   — all trivial (Marzban & co run similar numbers routinely).
 */
/** Number of UUIDs generated per refill batch. */
export const POOL_REFILL_BATCH = 500;
/** When free UUIDs drop below this → trigger refill. */
export const POOL_LOW_WATERMARK = 100;
/** Initial pool size created by ensureInitialPool(). */
export const POOL_INITIAL_SIZE = 1000;

export type PoolStats = {
  total: number;
  free: number;
  /**
   * Total rows assigned to ANY vpn_key, regardless of whether the key is
   * active. Kept for backward compatibility with admin UI / monitoring;
   * `alive + orphan === assigned` always holds.
   */
  assigned: number;
  /**
   * Pool rows attached to a `vpn_keys` row that is currently `is_active=TRUE`.
   * These are "real" users — what `/api/xray/clients` actually exports to
   * each VPS.
   */
  alive: number;
  /**
   * Pool rows attached to a `vpn_keys` row that no longer exists OR has
   * `is_active=FALSE` (subscription expired, device kicked, …). These rows
   * are filtered out of the Xray snapshot but still occupy DB space and
   * inflate the "assigned" headline number — making the admin think there
   * are more live users than there actually are. Hard-DELETE via
   * `purgeOrphanUuids()` whenever you want; safe and idempotent.
   *
   * Added 2026-05-16 because `assigned` was effectively meaningless after
   * v48 switched expiration from hard-DELETE to soft-kick (filter at
   * SELECT-time). Orphans accumulated unbounded.
   */
  orphan: number;
};

/**
 * Return aggregate stats for monitoring / admin UI.
 *
 * "Alive" requires BOTH `vpn_keys.is_active = TRUE` AND `subscriptions`
 * row with `status='active' AND end_date > NOW()`. Without the second
 * check, zombie vpn_keys (subscription expired but is_active was never
 * flipped to FALSE — happens when sweep-expired cron isn't running)
 * inflate the headline number. The match here mirrors the filter used
 * by `/api/xray/clients` so admin numbers reflect what Xray actually
 * sees.
 */
export async function getPoolStats(): Promise<PoolStats> {
  // Single-pass FILTER counts. The `has_active_sub` column is computed once
  // per pool row via correlated EXISTS so each FILTER doesn't redo the
  // subquery — Postgres pulls the predicate up and shares it across all
  // four aggregates.
  const res = await dbQuery<{
    total: string;
    free: string;
    alive: string;
    orphan: string;
  }>(
    `SELECT
       COUNT(*)::text                                                         AS total,
       COUNT(*) FILTER (WHERE up.assigned_to_key_id IS NULL)::text            AS free,
       COUNT(*) FILTER (
         WHERE up.assigned_to_key_id IS NOT NULL
           AND vk.id IS NOT NULL
           AND vk.is_active = TRUE
           AND EXISTS (
             SELECT 1 FROM subscriptions s
             WHERE s.user_id = vk.user_id
               AND s.status = 'active'
               AND s.end_date > NOW()
           )
       )::text                                                                AS alive,
       COUNT(*) FILTER (
         WHERE up.assigned_to_key_id IS NOT NULL
           AND (
             vk.id IS NULL
             OR vk.is_active = FALSE
             OR NOT EXISTS (
               SELECT 1 FROM subscriptions s
               WHERE s.user_id = vk.user_id
                 AND s.status = 'active'
                 AND s.end_date > NOW()
             )
           )
       )::text                                                                AS orphan
     FROM uuid_pool up
     LEFT JOIN vpn_keys vk ON vk.id = up.assigned_to_key_id`,
  );
  const row = res.rows[0];
  const free = parseInt(row?.free ?? '0', 10);
  const alive = parseInt(row?.alive ?? '0', 10);
  const orphan = parseInt(row?.orphan ?? '0', 10);
  return {
    total: parseInt(row?.total ?? '0', 10),
    free,
    assigned: alive + orphan,
    alive,
    orphan,
  };
}

/**
 * Generate `count` random UUIDs and insert them into the pool.
 * Returns the number of UUIDs actually inserted.
 */
export async function refillPool(count: number): Promise<number> {
  if (count <= 0) return 0;
  const uuids: string[] = [];
  for (let i = 0; i < count; i++) uuids.push(randomUUID());

  // Single INSERT with VALUES, ON CONFLICT DO NOTHING in case of collision.
  const placeholders = uuids.map((_, i) => `($${i + 1})`).join(', ');
  const res = await dbQuery(
    `INSERT INTO uuid_pool (uuid) VALUES ${placeholders}
     ON CONFLICT (uuid) DO NOTHING`,
    uuids,
  );
  return res.rowCount ?? 0;
}

/**
 * Seed the pool on first run. No-op if table already has POOL_INITIAL_SIZE+
 * UUIDs.
 */
export async function ensureInitialPool(): Promise<number> {
  const stats = await getPoolStats();
  if (stats.total >= POOL_INITIAL_SIZE) return 0;
  const missing = POOL_INITIAL_SIZE - stats.total;
  return refillPool(missing);
}

/**
 * Claim one free UUID from the pool and bind it to `vpnKeyId`.
 *
 * Uses `SELECT … FOR UPDATE SKIP LOCKED` so concurrent requests never grab
 * the same UUID. Returns `null` if the pool is exhausted.
 *
 * Runs inside the caller's transaction when `client` is provided.
 */
export async function claimUuid(
  vpnKeyId: number,
  client?: PoolClient,
): Promise<string | null> {
  const runner = client ?? (await getDbPool().connect());
  const ownTx = !client;
  try {
    if (ownTx) await runner.query('BEGIN');

    const pick = await runner.query<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM uuid_pool
        WHERE assigned_to_key_id IS NULL
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );
    const row = pick.rows[0];
    if (!row) {
      if (ownTx) await runner.query('ROLLBACK');
      return null;
    }

    await runner.query(
      `UPDATE uuid_pool
          SET assigned_to_key_id = $1, assigned_at = NOW()
        WHERE id = $2`,
      [vpnKeyId, row.id],
    );

    if (ownTx) await runner.query('COMMIT');
    return row.uuid;
  } catch (err) {
    if (ownTx) {
      try {
        await runner.query('ROLLBACK');
      } catch {
        // ignore
      }
    }
    throw err;
  } finally {
    if (ownTx && 'release' in runner && typeof runner.release === 'function') {
      runner.release();
    }
  }
}

/**
 * Release a UUID back to the pool. Called when a vpn_key is deactivated or
 * deleted. (For ON DELETE CASCADE / SET NULL cases the FK takes care of
 * assigned_to_key_id; this function just clears assigned_at.)
 */
export async function releaseUuidByKeyId(vpnKeyId: number): Promise<void> {
  await dbQuery(
    `UPDATE uuid_pool
        SET assigned_to_key_id = NULL, assigned_at = NULL
      WHERE assigned_to_key_id = $1`,
    [vpnKeyId],
  );
}

/**
 * Hard-DELETE every pool row that's effectively dead:
 *   1. Linked `vpn_keys` is `is_active=FALSE` (subscription was expired
 *      via `deactivateExpiredAccess`, device was kicked, etc).
 *   2. Linked `vpn_keys` row no longer exists (rare — should only happen
 *      after a manual delete).
 *   3. **Zombie**: linked `vpn_keys.is_active=TRUE` BUT no `subscriptions`
 *      row with `status='active' AND end_date > NOW()`. Happens when
 *      `subscriptions` expired but nobody flipped `vpn_keys.is_active`
 *      (i.e. sweep-expired cron isn't running). Such rows are invisible
 *      to Xray (the `/api/xray/clients` SQL joins on active_subs and
 *      drops them), but they still occupy pool slots and inflate the
 *      "alive" headline number. 2026-05-16 broadened the definition to
 *      cover them — was previously dropping only criteria (1)+(2).
 *
 * After this DELETE the row is gone from `uuid_pool` entirely. The next
 * `/api/xray/clients` snapshot won't include it (it didn't anyway —
 * /api/xray/clients filters on `s.status='active' AND s.end_date > NOW()`),
 * so this is a pure DB-side cleanup with no client-visible effect.
 *
 * Pool size shrinks by the number of dead UUIDs; `maybeRefill()`
 * (called opportunistically from `claimUuid`) tops the pool back up to
 * ≥ 100 free entries when the next user signs up.
 *
 * Returns the number of rows deleted.
 *
 * Runs inside the caller's transaction when `client` is provided.
 */
export async function purgeOrphanUuids(
  client?: PoolClient,
): Promise<number> {
  const runner = client ?? getDbPool();
  const result = await runner.query(
    `DELETE FROM uuid_pool up
      WHERE up.assigned_to_key_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
            FROM vpn_keys vk
            JOIN subscriptions s
              ON s.user_id = vk.user_id
             AND s.status = 'active'
             AND s.end_date > NOW()
           WHERE vk.id = up.assigned_to_key_id
             AND vk.is_active = TRUE
        )`,
  );
  return result.rowCount ?? 0;
}

/**
 * One-shot recovery: re-attach pool rows for every currently-active
 * `vpn_keys` row whose linked `uuid_pool` entry is missing OR is still
 * pointing at a stale inactive vpn_key id (e.g. because a historical
 * run of `purgeOrphanUuids` deleted it, or because `ensureSessionUuid`
 * reactivated an old key by changing `is_active=TRUE` without touching
 * the pool row that still references the old (now reactivated) row).
 *
 * Two failure modes this repairs:
 *   1. Pool row was DELETED → re-INSERT with correct assignment.
 *   2. Pool row exists but `assigned_to_key_id` points at a vpn_key
 *      whose `is_active=FALSE` while a DIFFERENT active vpn_key shares
 *      the same UUID — re-bind the pool row to the active vpn_key id.
 *
 * Without this, the user's `vpn_keys.key_hash` points at a UUID that
 * `/api/xray/clients` filters out (because the WHERE clause requires
 * an active vpn_key on the OTHER side of the join). Their cached
 * VLESS configs return "invalid request user id" even with a valid
 * subscription. After this UPSERT the snapshot includes the UUID
 * again and old clients reconnect WITHOUT a re-import.
 *
 * Idempotent: re-running it on a healthy DB is a no-op.
 *
 * Returns the number of rows actually written (insert or update).
 */
export async function restoreActivePoolEntries(): Promise<number> {
  // v66: DISTINCT ON guards against duplicate active vpn_keys sharing one
  // key_hash. Without it, ON CONFLICT DO UPDATE tries to upsert the same
  // uuid_pool row twice in one statement and Postgres throws 21000 'cannot
  // affect row a second time'. Deduplication picks the highest vk.id (most
  // recently created vpn_key) for each UUID.
  const result = await dbQuery(
    `INSERT INTO uuid_pool (uuid, assigned_to_key_id, assigned_at)
     SELECT DISTINCT ON (vk.key_hash::uuid) vk.key_hash::uuid, vk.id, NOW()
     FROM vpn_keys vk
     WHERE vk.is_active = TRUE
       AND vk.key_hash IS NOT NULL
       AND vk.key_hash NOT LIKE 'pending-%'
       AND vk.key_hash ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ORDER BY vk.key_hash::uuid, vk.id DESC
     ON CONFLICT (uuid) DO UPDATE
        SET assigned_to_key_id = EXCLUDED.assigned_to_key_id,
            assigned_at = NOW()
      WHERE uuid_pool.assigned_to_key_id IS DISTINCT FROM EXCLUDED.assigned_to_key_id`,
  );
  return result.rowCount ?? 0;
}

/**
 * Ensure exactly ONE `uuid_pool` row exists for `uuid` and is bound to
 * `vpnKeyId`. Used by `/api/sub/[token]` whenever it returns an existing
 * `vpn_keys.key_hash` (e.g. when reactivating an old vpn_key after a
 * subscription renewal). Without this, a pool row that was deleted by
 * an earlier expiration cycle never reappears, and the user's VLESS
 * config silently fails with "invalid request user id".
 *
 * Idempotent.
 *
 * v64: Returns `true` when the pool table was actually mutated (insert or
 * update). The caller can then fire `triggerXraySync` to push the change
 * to all VPN servers immediately, instead of waiting up to 5 min for the
 * next cron tick. This makes recovery from a zombie pool state instant
 * for the user.
 */
export async function ensurePoolRowForKey(
  vpnKeyId: number,
  uuid: string,
): Promise<boolean> {
  const result = await dbQuery(
    `INSERT INTO uuid_pool (uuid, assigned_to_key_id, assigned_at)
     VALUES ($1::uuid, $2, NOW())
     ON CONFLICT (uuid) DO UPDATE
        SET assigned_to_key_id = EXCLUDED.assigned_to_key_id,
            assigned_at = NOW()
      WHERE uuid_pool.assigned_to_key_id IS DISTINCT FROM EXCLUDED.assigned_to_key_id`,
    [uuid, vpnKeyId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Deduplicate accumulated vpn_keys for ONE user. Keeps:
 *   - every vpn_key linked to an alive (kicked_at IS NULL) device_session
 *   - PLUS the single most recently used legacy/shared vpn_key (when
 *     the user has no active sessions at all — e.g. browser-only users).
 * Deactivates every other is_active=TRUE vpn_key for that user and
 * hard-deletes their pool rows. Used to clean up the bloat created by
 * `forceRestoreUserByTelegramId` after an emergency reactivation pulled
 * in dozens of legacy keys at once.
 *
 * Returns counts of vpn_keys deactivated and pool rows deleted.
 */
export async function dedupeUserKeys(
  telegramId: number,
): Promise<{ keysDeactivated: number; poolDeleted: number }> {
  // Pick the IDs we want to KEEP, then deactivate everything else.
  const deact = await dbQuery(
    `WITH usr AS (
       SELECT id FROM users WHERE telegram_id = $1 LIMIT 1
     ),
     session_keys AS (
       -- vpn_keys with at least one alive device_session — definitely in use
       SELECT DISTINCT vk.id
       FROM vpn_keys vk
       JOIN device_sessions ds ON ds.vpn_key_id = vk.id
       WHERE ds.kicked_at IS NULL
         AND vk.user_id = (SELECT id FROM usr)
     ),
     latest_legacy AS (
       -- Most-recently-touched legacy/shared key (used by browser UA path
       -- and as fallback when no device_sessions exist).
       SELECT vk.id
       FROM vpn_keys vk
       WHERE vk.user_id = (SELECT id FROM usr)
         AND vk.key_hash IS NOT NULL
         AND vk.key_hash NOT LIKE 'pending-%'
       ORDER BY
         vk.is_active DESC,
         COALESCE(vk.last_connected_at, vk.created_at) DESC,
         vk.created_at DESC
       LIMIT 1
     ),
     keep AS (
       SELECT id FROM session_keys
       UNION
       SELECT id FROM latest_legacy
     )
     UPDATE vpn_keys vk
        SET is_active = FALSE
      WHERE vk.user_id = (SELECT id FROM usr)
        AND vk.is_active = TRUE
        AND vk.id NOT IN (SELECT id FROM keep)`,
    [telegramId],
  );

  // Hard-delete the pool rows that are now orphaned (assigned to keys we
  // just deactivated). This shrinks `assigned` count and frees Xray RAM
  // after the next sync.
  const del = await dbQuery(
    `DELETE FROM uuid_pool up
       USING vpn_keys vk, users u
      WHERE up.assigned_to_key_id = vk.id
        AND vk.user_id = u.id
        AND u.telegram_id = $1
        AND vk.is_active = FALSE`,
    [telegramId],
  );

  return {
    keysDeactivated: deact.rowCount ?? 0,
    poolDeleted: del.rowCount ?? 0,
  };
}

/**
 * Bulk variant of forceRestoreUserByTelegramId: reactivate + UPSERT for
 * EVERY user with an active subscription. Repairs the systemic state
 * left over from the v47 hard-DELETE rollout. Idempotent — safe to run
 * repeatedly.
 */
export async function forceRestoreAllActiveUsers(): Promise<{
  keysReactivated: number;
  poolWritten: number;
}> {
  const reactivate = await dbQuery(
    `UPDATE vpn_keys vk
        SET is_active = TRUE
       FROM subscriptions s
      WHERE s.user_id = vk.user_id
        AND s.status = 'active' AND s.end_date > NOW()
        AND vk.key_hash IS NOT NULL
        AND vk.key_hash NOT LIKE 'pending-%'
        AND vk.key_hash ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND vk.is_active = FALSE`,
  );

  // v66: DISTINCT ON dedup — see restoreActivePoolEntries comment.
  const upsert = await dbQuery(
    `INSERT INTO uuid_pool (uuid, assigned_to_key_id, assigned_at)
     SELECT DISTINCT ON (vk.key_hash::uuid) vk.key_hash::uuid, vk.id, NOW()
       FROM vpn_keys vk
       JOIN subscriptions s ON s.user_id = vk.user_id
      WHERE s.status = 'active' AND s.end_date > NOW()
        AND vk.is_active = TRUE
        AND vk.key_hash IS NOT NULL
        AND vk.key_hash NOT LIKE 'pending-%'
        AND vk.key_hash ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ORDER BY vk.key_hash::uuid, vk.id DESC
     ON CONFLICT (uuid) DO UPDATE
        SET assigned_to_key_id = EXCLUDED.assigned_to_key_id,
            assigned_at = NOW()
      WHERE uuid_pool.assigned_to_key_id IS DISTINCT FROM EXCLUDED.assigned_to_key_id`,
  );

  return {
    keysReactivated: reactivate.rowCount ?? 0,
    poolWritten: upsert.rowCount ?? 0,
  };
}

/**
 * Force-restore for ONE user: reactivate every vpn_key belonging to a user
 * with an active subscription, and UPSERT its pool row. Use this when a
 * user's UUID has gone stale because the sub endpoint never managed to
 * flip is_active=TRUE on the legacy/shared vpn_key path. Idempotent.
 *
 * Returns counts of vpn_keys updated and pool rows inserted/updated.
 */
export async function forceRestoreUserByTelegramId(
  telegramId: number,
): Promise<{ keysReactivated: number; poolWritten: number }> {
  const reactivate = await dbQuery(
    `UPDATE vpn_keys vk
        SET is_active = TRUE
       FROM users u, subscriptions s
      WHERE vk.user_id = u.id
        AND u.telegram_id = $1
        AND s.user_id = u.id
        AND s.status = 'active' AND s.end_date > NOW()
        AND vk.key_hash IS NOT NULL
        AND vk.key_hash NOT LIKE 'pending-%'
        AND vk.key_hash ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND vk.is_active = FALSE`,
    [telegramId],
  );

  // v66: DISTINCT ON dedup — see restoreActivePoolEntries comment.
  const upsert = await dbQuery(
    `INSERT INTO uuid_pool (uuid, assigned_to_key_id, assigned_at)
     SELECT DISTINCT ON (vk.key_hash::uuid) vk.key_hash::uuid, vk.id, NOW()
       FROM vpn_keys vk
       JOIN users u ON u.id = vk.user_id
       JOIN subscriptions s ON s.user_id = u.id
      WHERE u.telegram_id = $1
        AND s.status = 'active' AND s.end_date > NOW()
        AND vk.is_active = TRUE
        AND vk.key_hash IS NOT NULL
        AND vk.key_hash NOT LIKE 'pending-%'
        AND vk.key_hash ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ORDER BY vk.key_hash::uuid, vk.id DESC
     ON CONFLICT (uuid) DO UPDATE
        SET assigned_to_key_id = EXCLUDED.assigned_to_key_id,
            assigned_at = NOW()
      WHERE uuid_pool.assigned_to_key_id IS DISTINCT FROM EXCLUDED.assigned_to_key_id`,
    [telegramId],
  );

  return {
    keysReactivated: reactivate.rowCount ?? 0,
    poolWritten: upsert.rowCount ?? 0,
  };
}

/**
 * Hard-DELETE every currently-free pool row. One-shot cleanup helper
 * for legacy state from the pre-v47 "soft kick" era when expired users
 * were left in the free pool with their original UUID values intact
 * (so cached VLESS configs kept working until the slot was re-claimed
 * by a new user — could be hours/days/never).
 *
 * Active users (rows where `assigned_to_key_id IS NOT NULL`) are NOT
 * touched, so this does NOT disrupt currently-connected clients.
 *
 * After running this once the pool will be much smaller (only assigned
 * rows remain). `acquireUuid()` will refill the pool back up on the
 * next signup. Caller is responsible for triggering an Xray sync
 * afterwards (the `/api/xray/pool?action=purge-free` endpoint does this
 * automatically).
 *
 * Returns the number of rows deleted.
 */
export async function purgeFreeUuids(): Promise<number> {
  const result = await dbQuery(
    `DELETE FROM uuid_pool
      WHERE assigned_to_key_id IS NULL`,
  );
  return result.rowCount ?? 0;
}

/**
 * Get a free UUID, auto-refilling if low. Helper used by high-level code.
 */
export async function acquireUuid(vpnKeyId: number): Promise<string | null> {
  // Fast path — try to claim immediately.
  let uuid = await claimUuid(vpnKeyId);
  if (uuid) {
    // Opportunistic refill if we're running low (fire-and-forget).
    void maybeRefill();
    return uuid;
  }

  // Pool is empty — top up synchronously and retry once.
  await refillPool(POOL_REFILL_BATCH);
  uuid = await claimUuid(vpnKeyId);
  return uuid;
}

/**
 * Refill the pool if free count drops below the low watermark.
 * Safe to call repeatedly; it's effectively a no-op when pool is healthy.
 */
export async function maybeRefill(): Promise<number> {
  const stats = await getPoolStats();
  if (stats.free >= POOL_LOW_WATERMARK) return 0;
  return refillPool(POOL_REFILL_BATCH);
}
