import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { triggerXraySync } from '@/lib/xray-webhook';

function resolveUserParams(url: URL) {
  const telegramIdRaw = url.searchParams.get('telegramId');
  const userIdRaw = url.searchParams.get('userId');
  if (!telegramIdRaw && !userIdRaw) return null;
  const telegramId = telegramIdRaw ? Number(telegramIdRaw) : null;
  const userId = userIdRaw ? Number(userIdRaw) : null;
  if ((telegramIdRaw && !Number.isFinite(telegramId)) || (userIdRaw && !Number.isFinite(userId))) return null;
  const whereClause = telegramId ? 'u.telegram_id = $1' : 'u.id = $1';
  const param = telegramId ?? userId;
  return { whereClause, param };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const resolved = resolveUserParams(url);
    if (!resolved) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    // Resolve user's device limit first (default 3 if no active plan)
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

    // Return ONLY active-slot devices (rank <= maxDevices by created_at).
    // Kicked (`kicked_at IS NOT NULL`) and over-limit devices stay in DB for
    // idempotent enforcement in /api/sub/[token] but are hidden from UI.
    const result = await dbQuery(
      `
      WITH ranked AS (
        SELECT
          ds.id,
          ds.device_name,
          ds.ip_address,
          ds.last_seen_at,
          ds.created_at,
          ROW_NUMBER() OVER (ORDER BY ds.created_at ASC, ds.id ASC) AS rank
        FROM device_sessions ds
        JOIN users u ON u.id = ds.user_id
        WHERE ${resolved.whereClause}
          AND ds.last_seen_at > NOW() - INTERVAL '30 days'
          AND ds.kicked_at IS NULL
      )
      SELECT id, device_name, ip_address, last_seen_at, created_at
      FROM ranked
      WHERE rank <= $2
      ORDER BY last_seen_at DESC;
      `,
      [resolved.param, maxDevices]
    );

    return NextResponse.json({ ok: true, devices: result.rows, maxDevices });
  } catch (error) {
    console.error('Devices fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const resolved = resolveUserParams(url);
    const deviceIdRaw = url.searchParams.get('deviceId');

    if (!resolved || !deviceIdRaw) {
      return NextResponse.json({ error: 'User identifier and deviceId are required' }, { status: 400 });
    }

    const deviceId = Number(deviceIdRaw);
    if (!Number.isFinite(deviceId)) {
      return NextResponse.json({ error: 'Invalid deviceId' }, { status: 400 });
    }

    const userSubquery = resolved.whereClause.includes('telegram_id')
      ? `(SELECT id FROM users WHERE telegram_id = $2 LIMIT 1)`
      : `$2::bigint`;

    // HARD DELETE (v48, 2026-05-17): the session row is removed entirely on
    // an owner-initiated kick. Combined with v48's per-session Hy2 password
    // and the existing UUID purge, this gives the user-visible behaviour
    // described in the spec ("удалил → отвалилось мгновенно → жму обновить
    // в клиенте → вернулось 3/3"):
    //
    //   T+0   row + uuid_pool + vpn_keys gone, triggerXraySync('wait')
    //         fires → xray reload drops the UUID for the active inbound,
    //         VLESS-side traffic stops within ~1 s.
    //   T+1s  Hy2 server's next /api/hysteria/auth call for this session's
    //         password fails (the `s${sessionId}` lookup misses) → Hy2
    //         disconnects. QUIC sessions are short-lived (idle ~30 s,
    //         migrate on IP change) so the user sees the drop within seconds
    //         to a minute even on the same network.
    //   T+60s client auto-refresh hits /api/sub/[token]; the UNIQUE
    //         (user_id, device_hash) slot is free again so a fresh row +
    //         UUID + per-session Hy2 password get allocated. The user's
    //         "обновить" button works without any extra UI plumbing.
    //
    // The original v45 soft-kick + persistent `kicked_at` model was
    // designed for a Hy2-less world; with v62's Hy2 re-enable the only way
    // to make the kick actually disconnect the device on both transports
    // is to invalidate Hy2's password too, which v48 does by tying the
    // password to `device_sessions.id`. Once the row is gone, the password
    // can never auth again — even before the row is replaced by the
    // auto-refresh, the Hy2 disconnect is guaranteed.
    //
    // Flow:
    //   1. SELECT the target session + its vpn_key_id (ownership check).
    //   2. If the vpn_key is exclusive to this session → DELETE uuid_pool
    //      row, DELETE vpn_keys row.
    //   3. If the vpn_key is shared (legacy pre-v41 users) → leave the key
    //      alone; other sessions still need it.
    //   4. DELETE the device_sessions row.
    //   5. triggerXraySync('wait') so all VPN servers reload xray within ~1s.
    const selectRes = await dbQuery<{ id: number; vpn_key_id: number | null }>(
      `
      SELECT id, vpn_key_id
        FROM device_sessions
       WHERE id = $1
         AND user_id = ${userSubquery}
       LIMIT 1;
      `,
      [deviceId, resolved.param]
    );

    if (selectRes.rowCount === 0) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 });
    }

    const vpnKeyId = selectRes.rows[0].vpn_key_id;
    let hardKick = false;
    if (vpnKeyId) {
      const sharedRes = await dbQuery<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM device_sessions
          WHERE vpn_key_id = $1 AND id != $2 AND kicked_at IS NULL`,
        [vpnKeyId, deviceId],
      );
      const shared = (sharedRes.rows[0]?.cnt ?? 0) > 0;

      if (!shared) {
        await dbQuery(
          `DELETE FROM uuid_pool WHERE assigned_to_key_id = $1`,
          [vpnKeyId],
        ).catch((err) => {
          console.error('Failed to purge kicked UUID from pool:', err);
        });
        await dbQuery(
          `DELETE FROM vpn_keys WHERE id = $1`,
          [vpnKeyId],
        ).catch((err) => {
          console.error('Failed to delete kicked vpn_key:', err);
        });
        hardKick = true;
      } else {
        console.warn(
          `[device-delete] shared vpn_key=${vpnKeyId} — not purging, ${sharedRes.rows[0]?.cnt ?? 0} siblings still use it`,
        );
      }
    }

    // Remove the session row last so the vpn_key FK cleanup above has valid
    // references to work with. Kills the per-session Hy2 password too —
    // /api/hysteria/auth's session lookup will fail for this id from now on.
    const delRes = await dbQuery(
      `DELETE FROM device_sessions WHERE id = $1`,
      [deviceId],
    );

    console.log(
      `[device-delete] tg/userId_param=${resolved.param} sessionId=${deviceId} `
      + `vpnKeyId=${vpnKeyId ?? '-'} hardKick=${hardKick} deleted=${delRes.rowCount ?? 0}`,
    );

    // Instant Xray hot-reload so the kicked device loses its connection
    // within ~1 second instead of waiting up to 5 min for cron. For a HARD
    // kick (exclusive UUID purged), Xray restart removes the UUID from the
    // accepted-clients list, killing the cached config.
    await triggerXraySync('wait');

    return NextResponse.json({ ok: true, deletedId: deviceId, hardKick });
  } catch (error) {
    console.error('Device delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
