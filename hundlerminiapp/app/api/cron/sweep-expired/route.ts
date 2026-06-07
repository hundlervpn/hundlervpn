import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { deactivateExpiredAccess } from '@/lib/access';
import { purgeOrphanUuids, restoreActivePoolEntries } from '@/lib/uuid-pool';
import { triggerXraySync } from '@/lib/xray-webhook';

/**
 * Cron-friendly endpoint that performs a GLOBAL subscription expiration
 * sweep + Xray webhook trigger.
 *
 * Designed to be hit every 1 minute by an external cron service
 * (cron-job.org, EasyCron, GitHub Actions, Timeweb panel cron, …) so that
 * users whose subscription expires while they are NOT actively using the
 * Mini App still get kicked off Xray within ~1 minute.
 *
 * Flow:
 *   1. Run `deactivateExpiredAccess(client)` with no userId → flips ALL
 *      `subscriptions` rows past `end_date` to `expired`, deactivates
 *      their `vpn_keys`, and fires `triggerXraySync('fire-and-forget')`.
 *      Pool rows are NOT deleted (v48 soft-kick) — they are filtered out
 *      of the Xray snapshot via WHERE clause in `/api/xray/clients`.
 *   2. Return JSON summary.
 *
 * Auth: `?token=XRAY_SYNC_TOKEN` query param (same secret used by the
 * VPN VPS sync scripts and the webhook). No DB look-up — single global
 * token.
 *
 * Safety: idempotent — calling it once a second or once an hour produces
 * the same end state. Multiple concurrent calls are also fine since each
 * transaction sees its own snapshot and the UPDATEs target only currently
 * expired rows.
 *
 * Curl example:
 *   curl "https://hundlervpn.xyz/api/cron/sweep-expired?token=$XRAY_SYNC_TOKEN"
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || req.headers.get('x-xray-sync-token') || '';

    const expectedToken = process.env.XRAY_SYNC_TOKEN || '';
    if (!expectedToken || token !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await deactivateExpiredAccess(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // v64: SELF-HEAL — re-create any pool rows that should exist for active
    // vpn_keys but are missing (or pointing at the wrong vpn_key). This
    // fixes the zombie state where:
    //   - vpn_keys.is_active = TRUE
    //   - uuid_pool row for vk.key_hash = MISSING or pointing to a stale key
    // → /api/xray/clients snapshot does NOT include the UUID
    // → user's cached VLESS config gets "invalid request user id" rejects
    // → user perceives it as "VPN works on PC but not phone" or
    //   "VPN dies for several minutes randomly"
    //
    // Symptom historically only resolved itself when the user manually
    // deleted + re-added the device (which forced acquireUuid to allocate
    // a fresh pool row). With this self-heal step, the next cron tick
    // (every 1 minute) auto-restores the pool row and fires the webhook
    // so the kicked-out UUID returns to Xray within ~60 seconds without
    // any user action.
    //
    // restoreActivePoolEntries is idempotent — it's a no-op when the
    // pool is already in sync. Only fires the webhook if it actually
    // wrote a row (so we don't restart Xray every minute for nothing).
    let poolHealed = 0;
    try {
      poolHealed = await restoreActivePoolEntries();
      if (poolHealed > 0) {
        console.log(`[cron/sweep-expired] healed ${poolHealed} zombie pool rows, firing webhook`);
        triggerXraySync('fire-and-forget').catch(() => {});
      }
    } catch (err) {
      console.warn('[cron/sweep-expired] pool heal step failed:', err);
    }

    // v69 (2026-05-11): Type-1 zombie healer.
    //
    // Fixes the case where:
    //   - device_sessions row is alive (kicked_at IS NULL)
    //   - device_sessions.vpn_key_id points at a vpn_key with is_active=FALSE
    //   - user's subscription is active
    //
    // Symptom: user's Happ caches the UUID; /api/xray/clients excludes it
    // (filter requires vk.is_active=TRUE on the active_session_keys CTE);
    // Xray rejects every connection with "invalid request user id".
    //
    // The system normally self-heals when the user re-polls /api/sub/[token]
    // (ensureSessionUuid flips is_active=TRUE there), but a user whose Happ
    // already failed to connect may not poll for hours. This cron tick
    // reactivates the key proactively so VPN works on next reconnect.
    //
    // Idempotent — restricted by `is_active = FALSE` so re-running it on a
    // healthy DB is a no-op.
    let type1Healed = 0;
    try {
      const t1 = await pool.query(
        `UPDATE vpn_keys vk
            SET is_active = TRUE
           FROM device_sessions ds, subscriptions s
          WHERE vk.id = ds.vpn_key_id
            AND ds.kicked_at IS NULL
            AND vk.is_active = FALSE
            AND vk.key_hash IS NOT NULL
            AND vk.key_hash NOT LIKE 'pending-%'
            AND s.user_id = vk.user_id
            AND s.status = 'active'
            AND s.end_date > NOW()`,
      );
      type1Healed = t1.rowCount ?? 0;
      if (type1Healed > 0) {
        console.log(`[cron/sweep-expired] reactivated ${type1Healed} zombie vpn_keys (Type-1), firing webhook`);
        triggerXraySync('fire-and-forget').catch(() => {});
      }
    } catch (err) {
      console.warn('[cron/sweep-expired] Type-1 heal step failed:', err);
    }

    // 2026-05-16: hard-DELETE orphan pool rows (rows whose linked vpn_key is
    // is_active=FALSE or no longer exists). Without this they accumulate
    // forever — v48 switched expiration from hard-DELETE to soft-kick (filter
    // at SELECT time in /api/xray/clients), and nobody ever cleaned the DB
    // side. Result: admin sees inflated "assigned" counts (e.g. 1500
    // assigned but only 500 actually serving real users), making pool stats
    // useless for capacity planning.
    //
    // Safe because /api/xray/clients filter `WHERE up.assigned_to_key_id IS
    // NULL OR ak.vpn_key_id IS NOT NULL` already excluded these rows from
    // every snapshot — Xray never had them, so DELETE is invisible to the
    // VPS layer. No webhook needed.
    let orphansPurged = 0;
    try {
      orphansPurged = await purgeOrphanUuids();
      if (orphansPurged > 0) {
        console.log(`[cron/sweep-expired] purged ${orphansPurged} orphan pool rows`);
      }
    } catch (err) {
      console.warn('[cron/sweep-expired] orphan purge step failed:', err);
    }

    return NextResponse.json({
      ok: true,
      poolHealed,
      type1Healed,
      orphansPurged,
      note: 'Expired subscriptions / vpn_keys deactivated; zombie pool rows healed; Type-1 zombies (live session, dead key) reactivated; orphan pool rows hard-DELETED; Xray sync webhook fired (fire-and-forget).',
    });
  } catch (error) {
    console.error('[cron/sweep-expired] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Allow POST as well so cron services that require POST (e.g. some
// HTTP-trigger panels) can call the same logic.
export async function POST(req: Request) {
  return GET(req);
}
