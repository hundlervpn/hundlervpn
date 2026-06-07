import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import {
  ensureInitialPool,
  getPoolStats,
  maybeRefill,
  purgeOrphanUuids,
  refillPool,
  POOL_INITIAL_SIZE,
  POOL_LOW_WATERMARK,
  POOL_REFILL_BATCH,
} from '@/lib/uuid-pool';
import { triggerXraySync } from '@/lib/xray-webhook';

/**
 * Admin-gated proxy for the UUID pool. The xray sync endpoint
 * `/api/xray/pool` requires XRAY_SYNC_TOKEN (for the VPN servers); this
 * variant requires ADMIN_TELEGRAM_IDS membership so the admin UI can
 * display / refill the pool without handing out the sync secret.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isAdmin(url.searchParams.get('telegramId'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const stats = await getPoolStats();
    return NextResponse.json({
      ok: true,
      ...stats,
      config: {
        initial_size: POOL_INITIAL_SIZE,
        low_watermark: POOL_LOW_WATERMARK,
        refill_batch: POOL_REFILL_BATCH,
      },
    });
  } catch (err) {
    console.error('[admin/pool] GET error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST — manage the pool.
 *   ?action=seed           → ensure initial pool size (1000) exists
 *   ?action=refill         → add POOL_REFILL_BATCH (50)
 *   ?action=auto           → top up only if free < watermark
 *   ?action=add&n=N        → add exactly N UUIDs (1..10000)
 *   ?action=sync           → just fire the Xray webhook (no pool changes)
 *   ?action=purge-orphans  → DELETE every pool row whose linked vpn_key is
 *                            inactive / gone (2026-05-16). Idempotent.
 *                            Does NOT touch Xray — orphans were already
 *                            filtered out of /api/xray/clients, so this is
 *                            a pure DB cleanup with no client-visible effect.
 *
 * Whenever the pool actually grew (added > 0) we also fire
 * `triggerXraySync('wait')` so the new UUIDs are loaded into Xray on all
 * VPN servers immediately. Without that, UUIDs live in DB but Xray does
 * NOT know about them until the 5-minute cron runs — which would cause
 * "user not found" failures for any client trying to connect with one
 * of the new UUIDs. Admin actions are infrequent, so the 5-15s restart
 * is acceptable.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!isAdmin(url.searchParams.get('telegramId'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const action = (url.searchParams.get('action') || 'auto').toLowerCase();
  const n = parseInt(url.searchParams.get('n') || '0', 10);

  try {
    let added = 0;
    let purged = 0;
    let synced = false;
    if (action === 'seed') {
      added = await ensureInitialPool();
    } else if (action === 'refill') {
      added = await refillPool(POOL_REFILL_BATCH);
    } else if (action === 'auto') {
      added = await maybeRefill();
    } else if (action === 'add') {
      if (!Number.isFinite(n) || n <= 0 || n > 10_000) {
        return NextResponse.json({ error: 'n must be 1..10000' }, { status: 400 });
      }
      added = await refillPool(n);
    } else if (action === 'sync') {
      synced = await triggerXraySync('wait');
      const stats = await getPoolStats();
      return NextResponse.json({ ok: true, action, synced, ...stats });
    } else if (action === 'purge-orphans') {
      // Hard-DELETE pool rows whose vpn_key is_active=FALSE or gone. These
      // rows are invisible to Xray (filtered in /api/xray/clients), so no
      // restart needed — purely a DB-side cleanup so admin stats stop
      // showing inflated "assigned" counts.
      purged = await purgeOrphanUuids();
      const stats = await getPoolStats();
      return NextResponse.json({ ok: true, action, purged, ...stats });
    } else {
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
    }

    // Pool grew → push new UUIDs onto Xray so they're immediately usable.
    if (added > 0) {
      synced = await triggerXraySync('wait');
    }

    const stats = await getPoolStats();
    return NextResponse.json({ ok: true, action, added, purged, synced, ...stats });
  } catch (err) {
    console.error('[admin/pool] POST error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
