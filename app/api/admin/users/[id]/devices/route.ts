import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import {
  getSubscriptionUrl,
  getSubscriptionUrlForUser,
  getRemnawaveDirectSubscriptionUrl,
  generateSubToken,
  generateSubTokenForUser,
} from '@/lib/sub-token';

/**
 * Admin-only: list ALL device_sessions for a target user (including kicked,
 * over-limit, and legacy rows). Unlike `/api/users/devices` which hides
 * kicked / over-limit rows for the owner, the admin view shows everything
 * so the admin can understand the full state and un-kick if needed.
 *
 * Returns UUID + pool assignment info so the admin can see exactly which
 * Xray client ID each device is using.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DeviceRow = {
  id: string;
  device_hash: string;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  kicked_at: string | null;
  vpn_key_id: string | null;
  uuid: string | null;
  pool_assigned_at: string | null;
  rank: number;
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(req.url);
    const adminTgId = url.searchParams.get('telegramId');
    if (!isAdmin(adminTgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }

    // User metadata
    const userResult = await dbQuery<{
      id: string; telegram_id: string | null; username: string | null;
      first_name: string | null; last_name: string | null;
      created_at: string; is_banned: boolean; ban_reason: string | null;
      sub_status: string | null; sub_end: string | null; max_devices: number | null;
      remnawave_short_uuid: string | null;
    }>(
      `
      SELECT u.id::text AS id, u.telegram_id::text AS telegram_id,
             u.username, u.first_name, u.last_name, u.created_at,
             u.is_banned, u.ban_reason,
             u.remnawave_short_uuid,
             s.status AS sub_status, s.end_date AS sub_end,
             p.max_devices
      FROM users u
      LEFT JOIN LATERAL (
        SELECT status, end_date, plan_id FROM subscriptions
        WHERE user_id = u.id ORDER BY end_date DESC NULLS LAST LIMIT 1
      ) s ON TRUE
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE u.id = $1
      LIMIT 1;
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // All devices for this user + joined UUID info. Rank follows the same
    // ordering as /api/users/devices (created_at ASC) so the admin can see
    // exactly which sessions occupy slots.
    const devicesResult = await dbQuery<DeviceRow>(
      `
      WITH ranked AS (
        SELECT
          ds.id::text AS id,
          ds.device_hash,
          ds.device_name,
          ds.ip_address,
          ds.user_agent,
          ds.created_at,
          ds.last_seen_at,
          ds.kicked_at,
          ds.vpn_key_id::text AS vpn_key_id,
          up.uuid,
          up.assigned_at AS pool_assigned_at,
          ROW_NUMBER() OVER (
            PARTITION BY (ds.kicked_at IS NULL)
            ORDER BY ds.created_at ASC, ds.id ASC
          ) AS rank
        FROM device_sessions ds
        LEFT JOIN uuid_pool up ON up.assigned_to_key_id = ds.vpn_key_id
        WHERE ds.user_id = $1
      )
      SELECT * FROM ranked
      ORDER BY kicked_at IS NULL DESC, created_at ASC;
      `,
      [userId]
    );

    // UUID pool counters scoped to this user (for context in the admin UI).
    const poolResult = await dbQuery<{ assigned: number }>(
      `SELECT COUNT(*)::int AS assigned
         FROM uuid_pool up
         JOIN vpn_keys vk ON vk.id = up.assigned_to_key_id
        WHERE vk.user_id = $1`,
      [userId]
    );

    // Build the user's subscription URL (the 'master key' shown in the admin UI).
    // Prefer telegramId-based token when available (legacy format), otherwise
    // fall back to userId-based token for email-only accounts.
    //
    // If APP_URL env is missing, fall back to the host of the incoming request
    // so the URL still renders in the admin panel. We still require
    // XRAY_SYNC_TOKEN (needed to sign the token) — without it we return null.
    const row = userResult.rows[0];
    const tgNum = row.telegram_id ? Number(row.telegram_id) : NaN;
    // Prefer direct Remnawave panel URL when we have a shortUuid.
    let subscriptionUrl: string | null = getRemnawaveDirectSubscriptionUrl(row.remnawave_short_uuid);
    if (!subscriptionUrl) {
      subscriptionUrl = Number.isFinite(tgNum) && tgNum > 0
        ? getSubscriptionUrl(tgNum)
        : getSubscriptionUrlForUser(Number(row.id));
    }
    if (!subscriptionUrl && process.env.XRAY_SYNC_TOKEN) {
      const origin = `${url.protocol}//${url.host}`;
      const token = Number.isFinite(tgNum) && tgNum > 0
        ? generateSubToken(tgNum)
        : generateSubTokenForUser(Number(row.id));
      subscriptionUrl = `${origin}/api/sub/${token}`;
    }

    return NextResponse.json({
      ok: true,
      user: { ...row, subscription_url: subscriptionUrl },
      devices: devicesResult.rows,
      pool: { assigned: poolResult.rows[0]?.assigned ?? 0 },
    });
  } catch (err) {
    console.error('Admin devices list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
