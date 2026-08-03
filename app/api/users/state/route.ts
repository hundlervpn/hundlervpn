import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { getSubscriptionUrl, getSubscriptionUrlForUser, getRemnawaveDirectSubscriptionUrl } from '@/lib/sub-token';
import { ensureRemnawaveUser } from '@/lib/remnawave-sync';
import { vpnBackend } from '@/lib/vpn-access';
import { getClientByEmail } from '@/lib/threexui';
import { clientEmailFor } from '@/lib/threexui-sync';

/**
 * The panel's own subscription URL for a local user: `<base>/<subId>`, where
 * `subId` is whatever 3x-ui stores on the client (the same link the panel UI
 * shows). Base comes from THREEXUI_SUB_BASE, e.g.
 *   https://panel.hundlervpn.xyz:2096/sub
 *
 * Returns null when the panel is unreachable or the client has no subId, so the
 * caller can fall back to our own signed-token endpoint.
 */
async function panelSubscriptionUrl(userId: number): Promise<string | null> {
  const base = (process.env.THREEXUI_SUB_BASE || '').trim().replace(/\/+$/, '');
  if (!base) return null;

  const email = clientEmailFor(userId);
  let client = await getClientByEmail(email).catch(() => null);
  if (!client) {
    // Not provisioned yet — create it, then re-read to pick up the subId the
    // panel generated. Idempotent.
    try {
      await ensureRemnawaveUser(userId);
    } catch (err) {
      console.error('[users/state] 3x-ui provisioning failed:', err);
      return null;
    }
    client = await getClientByEmail(email).catch(() => null);
  }

  const subId = (client?.subId || '').trim();
  if (!subId) {
    console.error('[users/state] 3x-ui client has no subId', { userId, email });
    return null;
  }
  return `${base}/${encodeURIComponent(subId)}`;
}

type UserState = {
  userId: number;
  telegramId: number | null;
  isBanned: boolean;
  banReason: string | null;
  banType: string | null;
  status: 'active' | 'expired' | 'canceled' | 'none';
  endDate: string | null;
  daysLeft: number;
  hasActiveKey: boolean;
  unreadSupportCount: number;
  referralCode: string | null;
  remnawaveSyncedAt: string | null;
  remnawaveShortUuid?: string | null;
  subscriptionUrl?: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramIdRaw = url.searchParams.get('telegramId');
    const userIdRaw = url.searchParams.get('userId');

    if (!telegramIdRaw && !userIdRaw) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    const telegramId = telegramIdRaw ? Number(telegramIdRaw) : null;
    const userId = userIdRaw ? Number(userIdRaw) : null;
    if ((telegramIdRaw && !Number.isFinite(telegramId)) || (userIdRaw && !Number.isFinite(userId))) {
      return NextResponse.json({ error: 'Invalid id parameter' }, { status: 400 });
    }

    const userWhereClause = telegramId ? 'telegram_id = $1' : 'id = $1';
    const userParam = telegramId ?? userId;

    // v62: This UPDATE was previously running on EVERY GET, mutating
    // vpn_keys.is_active for users with legacy (non-per-device) keys. The
    // admin panel and the Mini App both poll /api/users/state often, so the
    // UPDATE fired dozens of times per minute. For users with multiple
    // legacy keys whose `candidate` flipped (e.g. created_at race or
    // expires_at on the boundary), is_active toggled TRUE↔FALSE → /api/xray/clients
    // returned a different UUID set every 5 min → xray-sync.sh saw a diff →
    // `systemctl restart xray` → the entire VPN dropped for 5-15 sec.
    //
    // v62 fix: add `AND vk.is_active != ...` so the UPDATE is a NO-OP when
    // the rows are already in the desired state. Same end behaviour
    // (deactivates duplicate legacy keys for users with multiple), but
    // idempotent — calling /api/users/state 100 times in a row writes
    // exactly zero rows when nothing has changed. End of restart-storm.
    //
    // v67 (2026-05-07): exclude vpn_keys that are linked to a LIVE
    // device_session. The earlier v62 candidate UPDATE assumed every
    // non-`per-device` row was a stale legacy duplicate and freely
    // deactivated all of them except the one chosen candidate. That
    // assumption is wrong for users whose iPhone / Windows session is
    // bound to an old `key_uri = vless://…` row — those rows ARE the
    // active per-session keys, just with a legacy URI. Deactivating them
    // here purges their UUID from `/api/xray/clients`, the next 5-min
    // cron sync drops the UUID from Xray, and the device starts failing
    // with "user not found" while `/api/sub/[token]` keeps re-activating
    // the row on every poll → race → flapping. Diagnosed via
    // `scripts/debug-user-full.js`: see the iPhone session 1839 + Win
    // session 2557 of admin user 2029065770 (vpn_keys 260, 300). The
    // `NOT EXISTS` clause below carves them out so only orphan legacy
    // rows (no live session) are deduplicated.
    await dbQuery(
      `
      WITH target_user AS (
        SELECT id
        FROM users
        WHERE ${userWhereClause}
        LIMIT 1
      ),
      candidate AS (
        SELECT vk.id
        FROM vpn_keys vk
        JOIN target_user tu ON tu.id = vk.user_id
        LEFT JOIN subscriptions s ON s.id = vk.subscription_id
        WHERE (vk.expires_at IS NULL OR vk.expires_at > NOW())
          AND (
            (s.id IS NOT NULL AND s.status = 'active' AND s.end_date > NOW())
            OR s.id IS NULL
          )
        ORDER BY 
          CASE WHEN s.id IS NOT NULL AND s.status = 'active' THEN 0 ELSE 1 END,
          vk.created_at DESC
        LIMIT 1
      )
      UPDATE vpn_keys vk
      SET is_active = (vk.id = (SELECT id FROM candidate))
      WHERE vk.user_id IN (SELECT id FROM target_user)
        AND vk.key_uri != 'per-device'
        AND NOT EXISTS (
          SELECT 1 FROM device_sessions ds
          WHERE ds.vpn_key_id = vk.id
            AND ds.kicked_at IS NULL
        )
        AND EXISTS (SELECT 1 FROM candidate)
        AND vk.is_active IS DISTINCT FROM (vk.id = (SELECT id FROM candidate));
      `,
      [userParam]
    );

    const result = await dbQuery<UserState>(
      `
      SELECT
        u.id AS "userId",
        u.telegram_id AS "telegramId",
        u.is_banned AS "isBanned",
        u.ban_reason AS "banReason",
        u.ban_type AS "banType",
        u.referral_code AS "referralCode",
        u.remnawave_synced_at AS "remnawaveSyncedAt",
        u.remnawave_short_uuid AS "remnawaveShortUuid",
        CASE
          WHEN s.status = 'active' AND s.end_date > NOW() THEN 'active'
          WHEN s.status IS NULL THEN 'none'
          ELSE 'none'
        END::text AS status,
        CASE
          WHEN s.status = 'active' AND s.end_date > NOW() THEN s.end_date
          ELSE NULL
        END AS "endDate",
        CASE
          WHEN s.end_date IS NULL THEN 0
          WHEN s.end_date <= NOW() THEN 0
          WHEN s.status <> 'active' THEN 0
          ELSE CEIL(EXTRACT(EPOCH FROM (s.end_date - NOW())) / 86400)::int
        END AS "daysLeft",
        EXISTS (
          SELECT 1
          FROM vpn_keys vk
          WHERE vk.user_id = u.id
            AND vk.key_hash IS NOT NULL
        ) AS "hasActiveKey",
        COALESCE((
          SELECT SUM(unread)::int FROM (
            SELECT (
              SELECT COUNT(*) FROM support_ticket_messages stm
              WHERE stm.ticket_id = st.id
                AND stm.sender_type IN ('admin', 'system')
                AND (st.last_user_read_at IS NULL OR stm.created_at > st.last_user_read_at)
            ) AS unread
            FROM support_tickets st
            WHERE st.user_id = u.id
          ) sub
        ), 0) AS "unreadSupportCount"
      FROM users u
      LEFT JOIN LATERAL (
        SELECT status, end_date
        FROM subscriptions
        WHERE user_id = u.id
        ORDER BY end_date DESC NULLS LAST
        LIMIT 1
      ) s ON TRUE
      WHERE u.${userWhereClause}
      LIMIT 1;
      `,
      [userParam]
    );

    if (!result.rows[0]) {
      return NextResponse.json({
        ok: true,
        profile: null,
      });
    }

    const { status, hasActiveKey, telegramId: tgId } = result.rows[0];
    console.log('User state check:', { status, hasActiveKey, telegramId: tgId });
    
    // Subscription link handed to the Mini App / bots.
    //
    // 3x-ui (current backend): hand out the PANEL'S OWN subscription link,
    // `<THREEXUI_SUB_BASE>/<subId>` — the exact URL 3x-ui shows for that client.
    // No custom token layer in between: the panel already serves a working
    // subscription (VLESS + Hysteria2 for every node), so we just point users at
    // it. `subId` is read straight from the panel client.
    //
    // Never fall back to getRemnawaveDirectSubscriptionUrl() here: users migrated
    // off Remnawave still carry a stale `remnawave_short_uuid`, and handing that
    // out kept pointing live clients at the retired sub.hundlervpn.xyz panel.
    //
    // Remnawave (rollback path only): keep the original behaviour.
    let subscriptionUrl: string | null = null;
    const backend = vpnBackend();
    const ownSubUrl = () =>
      tgId ? getSubscriptionUrl(Number(tgId)) : getSubscriptionUrlForUser(result.rows[0].userId);

    if (backend === '3xui') {
      // Panel link first; our signed-token endpoint is only a last-ditch
      // fallback for when the panel is unreachable / the client has no subId.
      subscriptionUrl = (await panelSubscriptionUrl(result.rows[0].userId)) ?? ownSubUrl();
    } else {
      let shortUuid: string | null = (result.rows[0] as { remnawaveShortUuid?: string | null }).remnawaveShortUuid ?? null;
      if (!result.rows[0].remnawaveSyncedAt || !shortUuid) {
        try {
          const ensured = await ensureRemnawaveUser(result.rows[0].userId);
          shortUuid = ensured.shortUuid || shortUuid;
          if (ensured.subscriptionUrl) {
            subscriptionUrl = ensured.subscriptionUrl;
          }
        } catch (err) {
          console.error('[users/state] ensureRemnawaveUser failed (best-effort):', err);
        }
      }
      if (!subscriptionUrl) {
        subscriptionUrl = getRemnawaveDirectSubscriptionUrl(shortUuid);
      }
      if (!subscriptionUrl) {
        subscriptionUrl = ownSubUrl();
      }
    }
    console.log('Subscription URL:', subscriptionUrl);

    return NextResponse.json({
      ok: true,
      profile: {
        ...result.rows[0],
        subscriptionUrl,
      },
    });
  } catch (error) {
    console.error('User state error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}