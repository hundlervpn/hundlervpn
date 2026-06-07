import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

/**
 * POST /api/xray/traffic?token=XRAY_SYNC_TOKEN
 *
 * Accepts traffic stats from VPN servers. `/opt/xray-traffic.sh` on each VPN
 * VPS calls this every 5 min after collecting per-user uplink/downlink via
 * `xray api statsquery --reset`.
 *
 * Body (new format, 2026-05-10):
 *   {
 *     server_host: "vpn.hundlervpn.xyz",   // matches servers.host (optional)
 *     stats: [
 *       { email: "tg-123456-s42", uplink: 12345, downlink: 678900 },
 *       ...
 *     ]
 *   }
 *
 * Backward-compatible: requests without `server_host` still update the
 * legacy total counter `subscriptions.traffic_used_bytes` (used in the
 * `subscription-userinfo` HTTP header) but skip per-server accounting.
 *
 * Per-server quota enforcement (2026-05-10, see also /api/sub/[token]/route.ts):
 *   1. Resolve server_id by host.
 *   2. For each stats entry, UPSERT `user_server_traffic` (user_id, server_id):
 *      - If `quota_period_start` is older than 30 days, treat as start of a
 *        fresh rolling-window period (bytes_used = just-arrived bytes,
 *        quota_period_start = NOW()).
 *      - Else accumulate (bytes_used += new bytes, period unchanged).
 *   3. /api/sub/[token] reads this table and drops servers where the user has
 *      met or exceeded `servers.traffic_limit_bytes` within the live window,
 *      so the NL "Обход Глушилок" profile disappears from Happ on next poll.
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || req.headers.get('x-xray-sync-token') || '';
    const globalToken = process.env.XRAY_SYNC_TOKEN;

    if (!globalToken || token !== globalToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const serverHost: string | undefined = body?.server_host;
    const stats: { email: string; uplink: number; downlink: number }[] = body?.stats;

    if (!Array.isArray(stats) || stats.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    // Look up server_id by host (only if collector provided one).
    //
    // v68 (2026-05-17): match BOTH `host` (real backend IP, used by webhook
    // fan-out) AND `display_host` (public CDN-like hostname that some legacy
    // /opt/xray-traffic.sh installs hard-code instead of probing api.ipify).
    // Either column uniquely identifies the server, so widening the lookup
    // makes per-server traffic accounting robust to past inconsistencies in
    // collector scripts. Concrete example that motivated this: NL collector
    // shipped server_host="vpn.hundlervpn.xyz" while the row had
    // host="185.238.169.235" / display_host="vpn.hundlervpn.xyz" — the old
    // single-column SELECT silently dropped every NL batch.
    let serverId: number | null = null;
    if (serverHost) {
      const sRes = await dbQuery<{ id: number }>(
        `SELECT id FROM servers
          WHERE (host = $1 OR display_host = $1)
            AND is_active = TRUE
          LIMIT 1`,
        [serverHost],
      );
      serverId = sRes.rows[0]?.id ?? null;
      if (!serverId) {
        console.warn(`[xray-traffic] Unknown server_host=${serverHost}, per-server tracking skipped`);
      }
    }

    // Group traffic by (user_id, protocol). FOUR email-label formats accepted
    // (2026-05-16 — added `u-` family so email/Google users aren't dropped):
    //
    //   Telegram-registered users (telegram_id IS NOT NULL):
    //     VLESS (xray)      → `tg-{telegramId}-s{sessionId}` or `-k{vpnKeyId}`
    //     Hy2 (hysteria2)   → `tg-{telegramId}` (no suffix — Hy2 auth backend
    //                          returns `id: tg-<telegramId>` and that's what
    //                          /opt/hy2-traffic.sh ships as the email key)
    //
    //   Email / Google users (telegram_id IS NULL):
    //     VLESS (xray)      → `u-{userId}-s{sessionId}` or `-k{vpnKeyId}`
    //     Hy2 (hysteria2)   → `u-{userId}` (Hy2 auth returns `id: u-<userId>`
    //                          when row.telegram_id is NULL)
    //
    // Раздельная аггрегация (vless / hy2) нужна чтобы админка «Серверы» могла
    // показать отдельные карточки «Германия VLESS» и «Германия Hysteria». PK
    // таблицы user_server_traffic — (user_id, server_id, protocol).
    type ProtocolKey = 'vless' | 'hy2';
    type ParsedLabel = {
      // EXACTLY one of these is set; the other is resolved to user_id below.
      telegramId?: number;
      userId?: number;
      protocol: ProtocolKey;
      bytes: number;
    };

    const parsed: ParsedLabel[] = [];
    for (const s of stats) {
      if (!s.email) continue;
      const bytes = (s.uplink || 0) + (s.downlink || 0);
      if (bytes <= 0) continue;

      // tg-<digits>(-s<digits>|-k<digits>)? — Telegram label
      const mTg = s.email.match(/^tg-(\d+)((?:-[sk]\d+)?)$/);
      if (mTg) {
        const telegramId = parseInt(mTg[1], 10);
        if (isNaN(telegramId)) continue;
        parsed.push({
          telegramId,
          protocol: mTg[2] ? 'vless' : 'hy2',
          bytes,
        });
        continue;
      }

      // u-<digits>(-s<digits>|-k<digits>)? — Email / Google label (2026-05-16)
      const mU = s.email.match(/^u-(\d+)((?:-[sk]\d+)?)$/);
      if (mU) {
        const userId = parseInt(mU[1], 10);
        if (isNaN(userId)) continue;
        parsed.push({
          userId,
          protocol: mU[2] ? 'vless' : 'hy2',
          bytes,
        });
        continue;
      }
      // Anything else (pool-NNN, malformed, etc.) is ignored. pool-* labels
      // are placeholders for unassigned UUIDs — no real user, no traffic.
    }

    // Bulk-resolve telegram_id → user_id for tg-labelled rows. Doing a single
    // batched query is way cheaper than per-row JOINs in the UPSERT below
    // (was N × `SELECT FROM users WHERE telegram_id = $1` previously).
    const tgIdsToResolve = new Set<number>();
    for (const p of parsed) {
      if (p.telegramId !== undefined) tgIdsToResolve.add(p.telegramId);
    }
    const tgToUser = new Map<number, number>();
    if (tgIdsToResolve.size > 0) {
      const tgArr = Array.from(tgIdsToResolve);
      const res = await dbQuery<{ id: string; telegram_id: string }>(
        `SELECT id::text, telegram_id::text FROM users WHERE telegram_id = ANY($1::bigint[])`,
        [tgArr],
      );
      for (const r of res.rows) {
        tgToUser.set(parseInt(r.telegram_id, 10), parseInt(r.id, 10));
      }
    }

    // Final aggregation: (user_id, protocol) → bytes.
    const userTraffic = new Map<string, { userId: number; protocol: ProtocolKey; bytes: number }>();
    for (const p of parsed) {
      let uid: number | undefined;
      if (p.userId !== undefined) {
        uid = p.userId;
      } else if (p.telegramId !== undefined) {
        uid = tgToUser.get(p.telegramId);
      }
      if (!uid) continue; // unknown user (deleted? race with delete?) — drop
      const key = `${uid}:${p.protocol}`;
      const existing = userTraffic.get(key);
      if (existing) {
        existing.bytes += p.bytes;
      } else {
        userTraffic.set(key, { userId: uid, protocol: p.protocol, bytes: p.bytes });
      }
    }

    let updatedSubs = 0;
    let updatedPerServer = 0;

    // Чтобы не апдейтить subscriptions.traffic_used_bytes дважды (один раз
    // на VLESS row, один раз на Hy2 row) если юзер был на обоих протоколах
    // в одном push — суммируем по user_id ОТДЕЛЬНО для legacy counter.
    const subBytesPerUser = new Map<number, number>();
    for (const v of userTraffic.values()) {
      subBytesPerUser.set(v.userId, (subBytesPerUser.get(v.userId) || 0) + v.bytes);
    }
    for (const [userId, bytes] of subBytesPerUser) {
      const subRes = await dbQuery(
        `UPDATE subscriptions
         SET traffic_used_bytes = traffic_used_bytes + $2,
             updated_at = NOW()
         WHERE user_id = $1
           AND status = 'active'
           AND end_date > NOW()`,
        [userId, bytes],
      );
      if (subRes.rowCount && subRes.rowCount > 0) updatedSubs++;
    }

    // Порог "реальной активности" (2026-05-16). Идея: keep-alive TLS,
    // TCP handshake artifacts и idle pings создают 1-10 KB/5min, но это
    // НЕ означает что юзер реально пользуется VPN. Реальный browsing /
    // YouTube легко даёт >1 MB/5min. Поэтому `last_active_at` (которое
    // админка использует для "online" / "last_24h" / "last_7d") мы
    // обновляем только если в текущем батче >= 100 KB суммарного
    // трафика. `bytes_used` (lifetime, для квот) и `updated_at` (общий
    // heartbeat) обновляются как обычно — квота не должна терять байты.
    const ACTIVE_THRESHOLD_BYTES = parseInt(
      process.env.ACTIVE_BYTES_THRESHOLD || '102400',
      10,
    ); // 100 KB по умолчанию

    // Per-(server, protocol) counter — driver и для квот в /api/sub, и для
    // админ-карточек VLESS/Hy2. 2026-05-16: UPSERT now keys directly off
    // `user_server_traffic.user_id` (no `JOIN users WHERE telegram_id = $1`)
    // so email/Google users (telegram_id IS NULL) hit the same code path as
    // Telegram users.
    if (serverId) {
      for (const v of userTraffic.values()) {
        const isActive = v.bytes >= ACTIVE_THRESHOLD_BYTES;
        const upsertRes = await dbQuery(
          `INSERT INTO user_server_traffic (user_id, server_id, protocol, bytes_used, quota_period_start, updated_at, last_active_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW(), CASE WHEN $5 THEN NOW() ELSE NULL END)
           ON CONFLICT (user_id, server_id, protocol) DO UPDATE SET
             bytes_used = CASE
               WHEN user_server_traffic.quota_period_start < NOW() - INTERVAL '30 days'
                 THEN EXCLUDED.bytes_used
               ELSE user_server_traffic.bytes_used + EXCLUDED.bytes_used
             END,
             quota_period_start = CASE
               WHEN user_server_traffic.quota_period_start < NOW() - INTERVAL '30 days'
                 THEN NOW()
               ELSE user_server_traffic.quota_period_start
             END,
             updated_at = NOW(),
             last_active_at = CASE
               WHEN $5 THEN NOW()
               ELSE user_server_traffic.last_active_at
             END`,
          [v.userId, serverId, v.protocol, v.bytes, isActive],
        );
        if (upsertRes.rowCount && upsertRes.rowCount > 0) updatedPerServer++;
      }
    }

    console.log(
      `[xray-traffic] server=${serverHost || '-'} (id=${serverId || '-'}) ` +
      `stats=${stats.length} users=${userTraffic.size} ` +
      `updated_subs=${updatedSubs} updated_per_server=${updatedPerServer}`,
    );

    return NextResponse.json({
      ok: true,
      updated: updatedSubs,
      updated_per_server: updatedPerServer,
      server_id: serverId,
    });
  } catch (error) {
    console.error('[xray-traffic] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
