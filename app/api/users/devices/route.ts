import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { getUserHwidDevices, deleteUserHwidDevice, remnawaveConfigured } from '@/lib/remnawave';
import { ensureRemnawaveUser } from '@/lib/remnawave-sync';
import { vpnBackend } from '@/lib/vpn-access';

/**
 * Personal-cabinet device list.
 *
 * Phase B: device / HWID tracking is now owned by Remnawave. The subscription
 * endpoint (/api/sub/[token]) is a thin proxy to the panel and no longer writes
 * to the local `device_sessions` table, so that table is empty and the cabinet
 * used to show "no devices". This endpoint therefore reads the user's HWID
 * devices straight from the Remnawave panel and maps them onto the exact shape
 * the cabinet UI already expects:
 *
 *   id           = hwid          (stable per-device id; also the delete key)
 *   device_name  = deviceModel || platform
 *   ip_address   = requestIp
 *   last_seen_at = updatedAt
 *   created_at   = createdAt
 *
 * The device limit still comes from the user's active plan (default 3).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function resolveUserParams(url: URL) {
  const telegramIdRaw = url.searchParams.get('telegramId');
  const userIdRaw = url.searchParams.get('userId');
  if (!telegramIdRaw && !userIdRaw) return null;
  const telegramId = telegramIdRaw ? Number(telegramIdRaw) : null;
  const userId = userIdRaw ? Number(userIdRaw) : null;
  if ((telegramIdRaw && !Number.isFinite(telegramId)) || (userIdRaw && !Number.isFinite(userId))) return null;
  const whereClause = telegramId ? 'u.telegram_id = $1' : 'u.id = $1';
  const param = (telegramId ?? userId) as number;
  return { whereClause, param };
}

/**
 * Resolve the Remnawave uuid for the requested user. Uses the cached
 * users.remnawave_uuid when present; otherwise provisions/reconciles the
 * Remnawave user via ensureRemnawaveUser (idempotent) and returns its uuid.
 */
async function resolveRemnawaveUuid(whereClause: string, param: number): Promise<string | null> {
  const res = await dbQuery<{ id: string | number; remnawave_uuid: string | null }>(
    `SELECT u.id, u.remnawave_uuid FROM users u WHERE ${whereClause} LIMIT 1`,
    [param],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.remnawave_uuid) return row.remnawave_uuid;
  // No cached mapping yet — provision on the panel (idempotent) and use it.
  const ensured = await ensureRemnawaveUser(Number(row.id));
  return ensured.rwUser.uuid;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const resolved = resolveUserParams(url);
    if (!resolved) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    // Device limit still comes from the user's active plan (default 3 if none).
    const limitResult = await dbQuery<{ max_devices: number }>(
      `
      SELECT COALESCE(p.max_devices, 3) AS max_devices
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      JOIN users u ON u.id = s.user_id
      WHERE ${resolved.whereClause} AND s.status = 'active' AND s.end_date > NOW()
      ORDER BY s.end_date DESC
      LIMIT 1;
      `,
      [resolved.param]
    );
    const maxDevices = limitResult.rows[0]?.max_devices ?? 3;

    if (vpnBackend() === '3xui' || !remnawaveConfigured()) {
      // 3x-ui has no HWID registry (device limiting via limitIp happens on the
      // panel, not per-device here) — return an empty list to keep the UI
      // functional. Also the fallback when no panel is configured at all.
      return NextResponse.json({ ok: true, devices: [], maxDevices });
    }

    const uuid = await resolveRemnawaveUuid(resolved.whereClause, resolved.param);
    if (!uuid) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const rwDevices = await getUserHwidDevices(uuid);
    const devices = rwDevices
      .map((d) => ({
        id: d.hwid,
        device_name: d.deviceModel || d.platform || null,
        platform: d.platform,
        os_version: d.osVersion,
        ip_address: d.requestIp,
        last_seen_at: d.updatedAt,
        created_at: d.createdAt,
      }))
      .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime());

    return NextResponse.json({ ok: true, devices, maxDevices });
  } catch (error) {
    console.error('Devices fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const resolved = resolveUserParams(url);
    // The cabinet passes the device id (== hwid) back as `deviceId`.
    const hwid = url.searchParams.get('deviceId');

    if (!resolved || !hwid) {
      return NextResponse.json({ error: 'User identifier and deviceId are required' }, { status: 400 });
    }

    if (vpnBackend() === '3xui') {
      // No HWID devices to delete on 3x-ui; report success so the UI clears.
      return NextResponse.json({ ok: true, deletedId: hwid });
    }
    if (!remnawaveConfigured()) {
      return NextResponse.json({ error: 'Remnawave not configured' }, { status: 503 });
    }

    const uuid = await resolveRemnawaveUuid(resolved.whereClause, resolved.param);
    if (!uuid) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Removing the HWID device frees a slot; the device is forced to
    // re-register (and re-count) the next time its client fetches the sub.
    await deleteUserHwidDevice(uuid, hwid);

    return NextResponse.json({ ok: true, deletedId: hwid });
  } catch (error) {
    console.error('Device delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
