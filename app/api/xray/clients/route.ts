import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

type XrayClientRow = {
  uuid: string;
  email: string;
  expiresAt: string | null;
};

type ServerRow = {
  id: number;
  flow: string;
};

async function authenticateToken(
  req: Request,
  token: string,
): Promise<{ flow: string } | null> {
  // 1) Per-server token wins outright — every VPS gets its own `servers.flow`
  //    column value (NL=xtls-rprx-vision, DE/RU="" XUDP).
  const serverResult = await dbQuery<ServerRow>(
    `SELECT id, flow FROM servers WHERE sync_token = $1 AND is_active = TRUE LIMIT 1;`,
    [token]
  );
  if (serverResult.rows.length > 0) {
    return { flow: serverResult.rows[0].flow };
  }

  // 2) Global XRAY_SYNC_TOKEN fallback. v68.4 (2026-05-17): the legacy
  //    behaviour of returning `process.env.XRAY_VLESS_FLOW ?? ''` for every
  //    server hitting the global token was the v60 XUDP-migration default,
  //    but it broke NL when servers.flow was flipped to xtls-rprx-vision —
  //    NL's xray-sync.sh kept overwriting clients[] with flow="" every cron
  //    tick, yielding the observed "Telegram works, browser dies" symptom.
  //    Now we additionally look up the calling server by an `X-Server-Host`
  //    or `X-Server-IP` header so the per-server flow can be returned even
  //    on the legacy global-token path.
  const globalToken = process.env.XRAY_SYNC_TOKEN;
  if (globalToken && token === globalToken) {
    const hostHeader =
      req.headers.get('x-server-host') ||
      req.headers.get('x-server-ip') ||
      '';
    if (hostHeader) {
      const lookup = await dbQuery<ServerRow>(
        `SELECT id, flow FROM servers
          WHERE (host = $1 OR display_host = $1) AND is_active = TRUE
          LIMIT 1;`,
        [hostHeader],
      );
      if (lookup.rows.length > 0) {
        return { flow: lookup.rows[0].flow };
      }
    }
    // Last-resort fallback for legacy sync scripts that don't ship the
    // X-Server-Host header. Behaves identically to the pre-v68.4 code.
    return { flow: process.env.XRAY_VLESS_FLOW ?? '' };
  }

  return null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || req.headers.get('x-xray-sync-token') || '';

    const auth = await authenticateToken(req, token);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // v61: this endpoint is now READ-ONLY.
    //
    // Previously it ran two UPDATE statements on every GET to expire stale
    // subscriptions / vpn_keys. That made the endpoint non-idempotent: the
    // 5-min cron on every VPN VPS hit it, the UPDATEs flipped subscriptions
    // / keys behind the scenes, the SELECT snapshot drifted between cron
    // ticks, and `xray-sync.sh` saw a diff → `systemctl restart xray` →
    // ALL connected clients lost their VPN tunnel for 5-15 seconds.
    // Combined with the natural churn of users buying / renewing subs every
    // few minutes, this produced visible client count flapping
    // (976 ↔ 977 ↔ 978) in /var/log/xray-sync.log and a restart-storm
    // (~12 restarts/hour) — the symptom users experienced as "VPN drops
    // randomly every few minutes".
    //
    // Expiration is now exclusively driven by:
    //   • `lib/access.ts deactivateExpiredAccess` (per-user, v60 conditional
    //     webhook fire) — runs on every /api/users/sync, login callback,
    //     promo apply, and payment confirm.
    //   • `/api/cron/sweep-expired` (global, every 1 min via external cron)
    //     — covers users who abandon the app and never re-open it.
    //
    // Both paths use `deactivateExpiredAccess`, which fires the Xray sync
    // webhook ONLY when a row actually changed (totalChanged > 0). So
    // restarts now happen only when there's a genuine change, not on
    // every 5-minute poll.

    // Return ALL UUIDs in the pool — both assigned (to active sessions) and
    // free (placeholders). Xray preloads the full pool on startup so that
    // assigning a free UUID to a new device does NOT require a restart: the
    // UUID is already a known client to Xray.
    //
    // Architecture (v41): 1 UUID = 1 DEVICE SESSION. Each `device_sessions`
    // row has its own `vpn_key` + UUID drawn from the pool. This enables
    // surgical device kicks: purging a single UUID from the pool invalidates
    // that specific device's cached VLESS config without affecting the user's
    // other devices.
    //
    // Email labelling (MUST be unique per row to avoid "User X already
    // exists" crash on Xray restart):
    //   • Telegram-registered user (telegram_id IS NOT NULL):
    //       active session → `tg-{telegram_id}-s{session_id}`
    //       orphan         → `tg-{telegram_id}-k{vpn_key_id}`
    //   • Email / Google user (telegram_id IS NULL, 2026-05-16 fix):
    //       active session → `u-{user_id}-s{session_id}`
    //       orphan         → `u-{user_id}-k{vpn_key_id}`
    //   • Free pool UUID → `pool-{pool_id}` (placeholder).
    //
    // The `u-` prefix mirrors what /api/hysteria/auth returns for non-tg
    // users (it has used `u-<userId>` since the email-auth rollout). Before
    // this fix, telegram_id::text on a NULL value made PostgreSQL CONCAT
    // emit `tg--s42` for email users — that label later failed the
    // /api/xray/traffic regex `^tg-(\d+)(-s\d+)?$` so their bytes were
    // silently dropped and admin "Серверы" never showed them.
    //
    // The `-s{session_id}` suffix guarantees uniqueness even if two
    // sessions somehow ended up pointing at the same vpn_key (legacy
    // shared-key users mid-migration).
    //
    // Kicked devices are excluded via `ds.kicked_at IS NULL`. Their session
    // rows remain in DB (to block re-registration of the same hash) but the
    // UUID has been DELETED from uuid_pool at kick-time — so even without
    // this filter the row wouldn't appear here.
    const result = await dbQuery<XrayClientRow>(
      `
      WITH active_subs AS (
        SELECT s.user_id, s.end_date
        FROM subscriptions s
        WHERE s.status = 'active' AND s.end_date > NOW()
      ),
      -- One row per active non-kicked session linked to an active vpn_key.
      -- (No last_seen_at filter — a stale session for a user whose
      -- subscription is currently active still needs its UUID in Xray
      -- so the user can reconnect after a long gap. Subscription
      -- expiration and explicit device kick already handle removal.)
      active_session_keys AS (
        SELECT
          vk.id AS vpn_key_id,
          CASE
            WHEN u.telegram_id IS NOT NULL
              THEN CONCAT('tg-', u.telegram_id::text, '-s', ds.id::text)
            ELSE CONCAT('u-', u.id::text, '-s', ds.id::text)
          END AS email,
          LEAST(a.end_date, COALESCE(vk.expires_at, a.end_date)) AS expires_at
        FROM device_sessions ds
        JOIN vpn_keys vk ON vk.id = ds.vpn_key_id
        JOIN active_subs a ON a.user_id = vk.user_id
        JOIN users u ON u.id = vk.user_id
        WHERE ds.kicked_at IS NULL
          AND vk.is_active = TRUE
          AND vk.key_hash IS NOT NULL
          AND vk.key_hash NOT LIKE 'pending-%'
      ),
      -- Fallback: vpn_keys with an active subscription but no live
      -- device_session row at all (legacy shared-key users, or freshly
      -- created keys that haven't been linked yet).
      orphan_keys AS (
        SELECT DISTINCT ON (vk.id)
               vk.id AS vpn_key_id,
               CASE
                 WHEN u.telegram_id IS NOT NULL
                   THEN CONCAT('tg-', u.telegram_id::text, '-k', vk.id::text)
                 ELSE CONCAT('u-', u.id::text, '-k', vk.id::text)
               END AS email,
               LEAST(a.end_date, COALESCE(vk.expires_at, a.end_date)) AS expires_at
        FROM vpn_keys vk
        JOIN active_subs a ON a.user_id = vk.user_id
        JOIN users u ON u.id = vk.user_id
        WHERE vk.is_active = TRUE
          AND vk.key_hash IS NOT NULL
          AND vk.key_hash NOT LIKE 'pending-%'
          AND NOT EXISTS (
            SELECT 1 FROM device_sessions ds
            WHERE ds.vpn_key_id = vk.id AND ds.kicked_at IS NULL
          )
        ORDER BY vk.id
      ),
      -- Pick ONE row per vpn_key_id. Prefer session-linked label; fall back
      -- to orphan label. Guarantees unique email per UUID in the output.
      active_keys AS (
        SELECT DISTINCT ON (vpn_key_id)
               vpn_key_id, email, expires_at
        FROM (
          SELECT vpn_key_id, email, expires_at, 1 AS prio FROM active_session_keys
          UNION ALL
          SELECT vpn_key_id, email, expires_at, 2 AS prio FROM orphan_keys
        ) merged
        ORDER BY vpn_key_id, prio
      )
      SELECT
        up.uuid::text AS uuid,
        COALESCE(ak.email, CONCAT('pool-', up.id::text)) AS email,
        ak.expires_at::text AS "expiresAt"
      FROM uuid_pool up
      LEFT JOIN active_keys ak ON ak.vpn_key_id = up.assigned_to_key_id
      -- Filter out orphan pool rows: rows that ARE assigned to a vpn_key
      -- but whose key is now inactive (subscription expired, key kicked,
      -- etc). Such rows linger in the pool — they are NOT deleted — so
      -- that when the user renews, ensureSessionUuid can flip the linked
      -- vpn_key back to is_active=TRUE and the UUID re-appears in this
      -- snapshot WITHOUT having to be re-assigned. The price is that
      -- Xray must NOT see them while the key is inactive (otherwise an
      -- expired user with a cached VLESS config would keep working).
      WHERE up.assigned_to_key_id IS NULL  -- always include free pool rows
         OR ak.vpn_key_id IS NOT NULL      -- assigned AND key is active
      ORDER BY up.id;
      `
    );

    // Sanity guard (upstream half of the defence-in-depth pair). The pool
    // is over-provisioned to ~1000 entries steady-state — any response with
    // 0 rows here is almost certainly a transient DB issue (e.g. the read
    // replica fell behind, or a hot-reload during deploy briefly returned
    // an empty result set), NOT a legitimate state. If we returned that
    // empty list with `ok: true`, every VPN node's xray-sync.sh would happily
    // accept it and wipe its Xray client list on the next cron tick — which
    // is exactly the failure mode incident 2026-05-07 ~21:15 MSK exhibited.
    // Returning a 503 here makes `curl -sf` exit non-zero on the syncing
    // node, which already short-circuits the script before any config write.
    if (result.rows.length === 0) {
      console.error(
        'Xray clients export: pool query returned 0 rows; refusing to ship empty list (would wipe Xray)',
      );
      return NextResponse.json(
        { ok: false, error: 'pool empty (suspected transient backend issue)' },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      clients: result.rows.map((row) => ({
        id: row.uuid,
        flow: auth.flow,
        email: row.email,
        expiryTime: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('Xray clients export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
