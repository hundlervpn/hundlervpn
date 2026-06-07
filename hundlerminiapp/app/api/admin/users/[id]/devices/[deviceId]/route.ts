import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { triggerXraySync } from '@/lib/xray-webhook';

/**
 * Admin-only device control for a specific user's session.
 *
 * DELETE — kicks the device (same logic as the owner's own DELETE in
 *   /api/users/devices), with the key difference that it works regardless
 *   of who owns the session.
 *
 * POST   — un-kicks the device. Clears `kicked_at` so the session is
 *   visible/usable again. The UUID was already purged from the pool at
 *   kick time (HARD kick) so the next subscription refresh re-allocates
 *   a fresh UUID via `ensureSessionUuid` in /api/sub/[token].
 */

export const dynamic = 'force-dynamic';

async function resolveAdmin(url: URL): Promise<boolean> {
  const adminTgId = url.searchParams.get('telegramId');
  return isAdmin(adminTgId);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; deviceId: string }> }
) {
  try {
    const url = new URL(req.url);
    if (!(await resolveAdmin(url))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id, deviceId } = await params;
    const userId = Number(id);
    const sessionId = Number(deviceId);
    if (!Number.isFinite(userId) || !Number.isFinite(sessionId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const hard = url.searchParams.get('hard') === '1';

    // Load the row first so we know its vpn_key_id regardless of whether it's
    // already kicked or still active (hard delete must handle BOTH states).
    const existing = await dbQuery<{ id: string; vpn_key_id: number | null; kicked_at: string | null }>(
      `SELECT id::text, vpn_key_id, kicked_at
         FROM device_sessions
        WHERE id = $1 AND user_id = $2
        LIMIT 1`,
      [sessionId, userId]
    );
    if (existing.rowCount === 0) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 });
    }

    // For SOFT kick: refuse if already kicked (idempotency).
    // For HARD delete: allow regardless (explicitly removing the row).
    if (!hard && existing.rows[0].kicked_at) {
      return NextResponse.json({ error: 'Device already kicked' }, { status: 409 });
    }

    // Mark kicked_at first (soft kick). For hard delete this is redundant but
    // keeps the execution order consistent with the non-hard path below.
    const kickResult = await dbQuery<{ id: string; vpn_key_id: number | null }>(
      `
      UPDATE device_sessions
         SET kicked_at = COALESCE(kicked_at, NOW()),
             last_seen_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id::text, vpn_key_id;
      `,
      [sessionId, userId]
    );

    const vpnKeyId = kickResult.rows[0].vpn_key_id;
    let hardKick = false;
    if (vpnKeyId) {
      // Shared-key check (legacy pre-v41 users).
      const sharedRes = await dbQuery<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM device_sessions
          WHERE vpn_key_id = $1 AND id != $2 AND kicked_at IS NULL`,
        [vpnKeyId, sessionId]
      );
      const shared = (sharedRes.rows[0]?.cnt ?? 0) > 0;

      if (!shared) {
        await dbQuery(
          `DELETE FROM uuid_pool WHERE assigned_to_key_id = $1`,
          [vpnKeyId],
        ).catch((err) => console.error('admin kick: pool purge failed:', err));
        await dbQuery(
          `DELETE FROM vpn_keys WHERE id = $1`,
          [vpnKeyId],
        ).catch((err) => console.error('admin kick: vpn_keys delete failed:', err));
        await dbQuery(
          `UPDATE device_sessions SET vpn_key_id = NULL WHERE id = $1`,
          [sessionId],
        ).catch(() => {});
        hardKick = true;
      } else {
        await dbQuery(
          `UPDATE device_sessions SET vpn_key_id = NULL WHERE id = $1`,
          [sessionId],
        ).catch(() => {});
        console.warn(
          `[admin-kick] soft-kick (shared key) sessionId=${sessionId} vpnKeyId=${vpnKeyId}`
        );
      }
    }

    // Hard delete removes the row entirely so the device_hash can re-register.
    // The UUID was already purged above (if vpnKeyId was set), so this is just
    // a row delete — no Xray state to revoke.
    let hardDeleted = false;
    if (hard) {
      const del = await dbQuery(
        `DELETE FROM device_sessions WHERE id = $1 AND user_id = $2`,
        [sessionId, userId]
      );
      hardDeleted = (del.rowCount ?? 0) > 0;
    }

    console.log(
      `[admin-kick] adminTg=${url.searchParams.get('telegramId')} userId=${userId} `
      + `sessionId=${sessionId} vpnKeyId=${vpnKeyId ?? '-'} hardKick=${hardKick} hardDeleted=${hardDeleted}`
    );

    // Instant Xray hot-reload — same pattern as /api/users/devices.
    await triggerXraySync('wait');

    return NextResponse.json({
      ok: true,
      sessionId,
      hardKick,
      hardDeleted,
    });
  } catch (err) {
    console.error('Admin device kick error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; deviceId: string }> }
) {
  try {
    const url = new URL(req.url);
    if (!(await resolveAdmin(url))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const action = url.searchParams.get('action') || 'unkick';
    const { id, deviceId } = await params;
    const userId = Number(id);
    const sessionId = Number(deviceId);
    if (!Number.isFinite(userId) || !Number.isFinite(sessionId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    if (action !== 'unkick') {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Clear kicked_at. The session's UUID is already gone (purged on kick),
    // so the next /api/sub/[token] poll from this device_hash will hit
    // ensureSessionUuid and allocate a fresh UUID from the pool.
    //
    // NOTE: device_hash stays the same, so when the client auto-refreshes
    // within 60s after unkick, it lands on this row and gets a new UUID.
    const res = await dbQuery<{ id: string }>(
      `
      UPDATE device_sessions
         SET kicked_at = NULL,
             last_seen_at = NOW()
       WHERE id = $1 AND user_id = $2 AND kicked_at IS NOT NULL
       RETURNING id::text;
      `,
      [sessionId, userId]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Device not found or not kicked' }, { status: 404 });
    }

    console.log(
      `[admin-unkick] adminTg=${url.searchParams.get('telegramId')} userId=${userId} sessionId=${sessionId}`
    );

    return NextResponse.json({ ok: true, sessionId, action: 'unkick' });
  } catch (err) {
    console.error('Admin device unkick error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
