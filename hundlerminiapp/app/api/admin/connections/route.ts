import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { triggerTrafficRefresh, type TrafficRefreshResult } from '@/lib/xray-webhook';

/**
 * GET /api/admin/connections?telegramId=…
 *
 * Возвращает живую картину "кто сейчас на каждом сервере".
 *
 * Источник правды — таблица `user_server_traffic` которую обновляет
 * `/api/xray/traffic` каждые 5 минут (cron на каждом VPS вызывает
 * `xray api statsquery --reset`). Если у юзера `updated_at` свежее
 * 10 минут — значит он реально гонял трафик через этот сервер
 * недавно = считаем "online".
 *
 * Возвращаемая структура:
 * ```
 * {
 *   ok: true,
 *   generated_at: "2026-05-15T20:42:00Z",
 *   servers: [
 *     {
 *       id: 3,
 *       name: "Yandex Cloud",
 *       country: "RU",
 *       host: "vpn.hundlervpn.xyz",
 *       is_active: true,
 *       active_now: 14,           // юзеров с трафиком < 10 мин назад
 *       last_24h: 42,             // юзеров с трафиком < 24 часа назад
 *       last_7d:  218,            // юзеров с трафиком < 7 дней назад
 *       total_bytes_24h: 12345678,// сумма байт за 24 часа
 *       users: [
 *         {
 *           user_id: 4111,
 *           telegram_id: null,
 *           username: null,
 *           first_name: null,
 *           email: "user@example.com",
 *           bytes_used: 1234567,
 *           updated_at: "2026-05-15T20:38:00Z",
 *           minutes_ago: 4,
 *           is_online: true,      // updated_at < 10 минут назад
 *           sub_status: "active",
 *           sub_end: "2026-06-01T..."
 *         },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 * }
 * ```
 *
 * UI в админке показывает таблицу "Сервер | Online | 24h | 7d" + при
 * раскрытии серверной строки — список юзеров с указанием "X минут назад".
 *
 * NOTE: HEAD-only сервера (Yandex Cloud bridge без xray) НЕ появятся в
 * `users` потому что не репортят stats. Реальный coverage — только на
 * NL/DE VPS, которые гоняют xray-traffic.sh. Для bridge-only видны
 * только агрегаты "сколько подписок активно" в `subscriptions` (это
 * другой scope).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ServerRow = {
  id: number;
  name: string;
  country: string;
  host: string;
  is_active: boolean;
  has_hy2: boolean;
  vless_active_now: string;
  vless_last_24h: string;
  vless_last_7d: string;
  vless_total_bytes_24h: string;
  hy2_active_now: string;
  hy2_last_24h: string;
  hy2_last_7d: string;
  hy2_total_bytes_24h: string;
};

type UserOnServerRow = {
  server_id: number;
  protocol: 'vless' | 'hy2';
  user_id: number;
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  bytes_used: string;
  updated_at: string;
  minutes_ago: string;
  sub_status: string | null;
  sub_end: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isAdmin(url.searchParams.get('telegramId'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Опциональный фильтр — только конкретный server_id
  const serverFilter = url.searchParams.get('serverId');
  // Опциональный фильтр — окно "online" в минутах (default 10)
  const onlineWindowMin = Math.max(
    1,
    Math.min(60, parseInt(url.searchParams.get('onlineMin') ?? '10', 10) || 10),
  );
  // Лимит юзеров на сервер (default 200, max 1000)
  const userLimit = Math.max(
    10,
    Math.min(1000, parseInt(url.searchParams.get('userLimit') ?? '200', 10) || 200),
  );
  // ?refresh=1 — синхронный fan-out на все VPN серверы: дёрнуть
  // /opt/xray-traffic.sh + /opt/hy2-traffic.sh, дождаться пока они
  // допушат свежие байты в /api/xray/traffic, и только потом читать
  // user_server_traffic. Используется кнопкой «Обновить» в админке —
  // без этого юзер ждал бы до 5 минут пока сработает cron.
  const refresh = url.searchParams.get('refresh') === '1';

  // Per-VPS results of the refresh fan-out — surfaced back to UI so
  // admin видит «3/3 ok» / «2/3 ok (NL: timeout)».
  let refreshInfo: { ok: boolean; servers: TrafficRefreshResult[] } | null = null;

  try {
    if (refresh) {
      // Не валим админку если webhook не сконфигурирован или один из
      // collector'ов упал — просто возвращаем что есть в БД и кладём
      // диагностику в `refresh.servers`.
      refreshInfo = await triggerTrafficRefresh();
      // Маленькая пауза чтобы UPSERT'ы из коллекторов точно докатились
      // до replica/connection pool. xray-traffic.sh / hy2-traffic.sh
      // отвечают только после того как backend ответил 200 OK на их
      // POST, так что 200ms — про запас на edge cases.
      await new Promise((r) => setTimeout(r, 200));
    }

    // Per-server aggregates с разделением по protocol. user_server_traffic
    // имеет PK (user_id, server_id, protocol) — отдельные строки на VLESS
    // и Hy2 (xray-traffic.sh пишет vless, hy2-traffic.sh пишет hy2).
    //
    // 2026-05-16: фильтр по `last_active_at` (а не `updated_at`). Идея —
    // показывать в админке РЕАЛЬНО активных юзеров, а не тех у кого
    // прошёл просто handshake / keep-alive. last_active_at обновляется
    // только когда в 5-мин батче было ≥ 100 KB трафика (см.
    // /api/xray/traffic). Это убирает 10-20% false-positive online'ов.
    const serversRes = await dbQuery<ServerRow>(
      `
      SELECT
        s.id,
        s.name,
        COALESCE(s.country, '') AS country,
        COALESCE(s.host, '') AS host,
        s.is_active,
        (s.hysteria2_port IS NOT NULL AND s.hysteria2_password IS NOT NULL) AS has_hy2,
        COUNT(*) FILTER (
          WHERE ust.protocol = 'vless'
            AND ust.last_active_at > NOW() - (INTERVAL '1 minute' * $1)
        )::text AS vless_active_now,
        COUNT(*) FILTER (
          WHERE ust.protocol = 'vless'
            AND ust.last_active_at > NOW() - INTERVAL '24 hours'
        )::text AS vless_last_24h,
        COUNT(*) FILTER (
          WHERE ust.protocol = 'vless'
            AND ust.last_active_at > NOW() - INTERVAL '7 days'
        )::text AS vless_last_7d,
        COALESCE(SUM(ust.bytes_used) FILTER (
          WHERE ust.protocol = 'vless'
            AND ust.last_active_at > NOW() - INTERVAL '24 hours'
        ), 0)::text AS vless_total_bytes_24h,
        COUNT(*) FILTER (
          WHERE ust.protocol = 'hy2'
            AND ust.last_active_at > NOW() - (INTERVAL '1 minute' * $1)
        )::text AS hy2_active_now,
        COUNT(*) FILTER (
          WHERE ust.protocol = 'hy2'
            AND ust.last_active_at > NOW() - INTERVAL '24 hours'
        )::text AS hy2_last_24h,
        COUNT(*) FILTER (
          WHERE ust.protocol = 'hy2'
            AND ust.last_active_at > NOW() - INTERVAL '7 days'
        )::text AS hy2_last_7d,
        COALESCE(SUM(ust.bytes_used) FILTER (
          WHERE ust.protocol = 'hy2'
            AND ust.last_active_at > NOW() - INTERVAL '24 hours'
        ), 0)::text AS hy2_total_bytes_24h
      FROM servers s
      LEFT JOIN user_server_traffic ust ON ust.server_id = s.id
      ${serverFilter ? 'WHERE s.id = $2' : ''}
      GROUP BY s.id, s.name, s.country, s.host, s.is_active,
               s.hysteria2_port, s.hysteria2_password
      ORDER BY s.is_active DESC, s.sort_order ASC NULLS LAST,
               s.country ASC, s.name ASC;
      `,
      serverFilter
        ? [onlineWindowMin, parseInt(serverFilter, 10)]
        : [onlineWindowMin],
    );

    // Юзеры по (серверам, протоколам) — за последние 7 дней реальной
    // активности. Фильтр и сортировка по last_active_at (а не updated_at)
    // чтобы юзеры с только-handshake'ом не торчали в списке.
    const usersRes = await dbQuery<UserOnServerRow>(
      `
      WITH ranked AS (
        SELECT
          ust.server_id,
          ust.protocol,
          u.id AS user_id,
          u.telegram_id::text AS telegram_id,
          u.username,
          u.first_name,
          u.last_name,
          u.email,
          ust.bytes_used::text AS bytes_used,
          ust.last_active_at AS updated_at,
          ROUND(EXTRACT(EPOCH FROM (NOW() - ust.last_active_at)) / 60)::text AS minutes_ago,
          sub.status AS sub_status,
          sub.end_date AS sub_end,
          ROW_NUMBER() OVER (
            PARTITION BY ust.server_id, ust.protocol
            ORDER BY ust.last_active_at DESC
          ) AS rn
        FROM user_server_traffic ust
        JOIN users u ON u.id = ust.user_id
        LEFT JOIN LATERAL (
          SELECT status, end_date FROM subscriptions
          WHERE user_id = u.id
          ORDER BY end_date DESC NULLS LAST
          LIMIT 1
        ) sub ON TRUE
        WHERE ust.last_active_at > NOW() - INTERVAL '7 days'
        ${serverFilter ? 'AND ust.server_id = $1' : ''}
      )
      SELECT * FROM ranked
      WHERE rn <= ${userLimit}
      ORDER BY server_id ASC, protocol ASC, updated_at DESC;
      `,
      serverFilter ? [parseInt(serverFilter, 10)] : [],
    );

    // Группируем юзеров по (server_id, protocol) — у каждой карточки
    // VLESS/Hy2 свой список.
    const usersByServerProtocol = new Map<string, Array<Record<string, unknown>>>();
    for (const u of usersRes.rows) {
      const k = `${u.server_id}:${u.protocol}`;
      const list = usersByServerProtocol.get(k) ?? [];
      // Bug-fix 2026-05-16: НЕ использовать `parseInt(...) || 9999` для
      // is_online — `parseInt('0') === 0` falsy, тогда expression
      // возвращает 9999 и юзер с самым свежим трафиком (minutes_ago = 0,
      // "только что") получает is_online=false и проваливается в
      // "Недавняя активность", а юзер 6-минутной давности — в "Онлайн".
      // Полная инверсия там где она бьёт сильнее всего.
      const parsedMinAgo = Number.parseInt(u.minutes_ago, 10);
      const minAgo = Number.isFinite(parsedMinAgo) ? parsedMinAgo : 9999;
      const parsedBytes = Number.parseInt(u.bytes_used, 10);
      list.push({
        user_id: u.user_id,
        telegram_id: u.telegram_id,
        username: u.username,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
        bytes_used: Number.isFinite(parsedBytes) ? parsedBytes : 0,
        updated_at: u.updated_at,
        minutes_ago: minAgo,
        is_online: minAgo <= onlineWindowMin,
        sub_status: u.sub_status,
        sub_end: u.sub_end,
      });
      usersByServerProtocol.set(k, list);
    }

    // Build the response. Servers with Hy2 inbound get emitted as TWO rows:
    //   1. VLESS card with vless_* aggregates from user_server_traffic
    //      WHERE protocol = 'vless'.
    //   2. Hy2 card with hy2_* aggregates from user_server_traffic
    //      WHERE protocol = 'hy2' (filled by /opt/hy2-traffic.sh on the
    //      Hy2-enabled VPS).
    // The composite `key` field is what the UI uses for React keys and for
    // tracking expanded state — `${id}-vless` / `${id}-hy2` are unique.
    // hy2_pending_collector сигнал UI'у нарисовать сноску «collector не
    // подключён» вместо тупого «нет данных». Сетим его только если 0 строк
    // в последние 7 дней — если есть хоть одна запись, считаем collector
    // живым (даже если сейчас никого онлайн).
    type CardOut = {
      key: string;
      id: number;
      name: string;
      protocol: 'vless' | 'hy2';
      country: string;
      host: string;
      is_active: boolean;
      active_now: number;
      last_24h: number;
      last_7d: number;
      total_bytes_24h: number;
      users: Array<Record<string, unknown>>;
      hy2_pending_collector?: boolean;
    };

    const servers: CardOut[] = [];
    for (const s of serversRes.rows) {
      const baseName = s.name;
      const vlessUsers = usersByServerProtocol.get(`${s.id}:vless`) ?? [];
      servers.push({
        key: `${s.id}-vless`,
        id: s.id,
        name: s.has_hy2 ? `${baseName} VLESS` : baseName,
        protocol: 'vless',
        country: s.country,
        host: s.host,
        is_active: s.is_active,
        active_now: parseInt(s.vless_active_now, 10) || 0,
        last_24h: parseInt(s.vless_last_24h, 10) || 0,
        last_7d: parseInt(s.vless_last_7d, 10) || 0,
        total_bytes_24h: parseInt(s.vless_total_bytes_24h, 10) || 0,
        users: vlessUsers,
      });

      if (s.has_hy2) {
        const hy2Users = usersByServerProtocol.get(`${s.id}:hy2`) ?? [];
        const hy2Last7d = parseInt(s.hy2_last_7d, 10) || 0;
        servers.push({
          key: `${s.id}-hy2`,
          id: s.id,
          name: `${baseName} Hysteria`,
          protocol: 'hy2',
          country: s.country,
          host: s.host,
          is_active: s.is_active,
          active_now: parseInt(s.hy2_active_now, 10) || 0,
          last_24h: parseInt(s.hy2_last_24h, 10) || 0,
          last_7d: hy2Last7d,
          total_bytes_24h: parseInt(s.hy2_total_bytes_24h, 10) || 0,
          users: hy2Users,
          // Если за 7 дней не было ни одной записи hy2 — считаем что
          // /opt/hy2-traffic.sh не работает. Сразу после install будет
          // 0 пока юзеры не подключатся; через ~5 мин после первого
          // подключения карточка наполнится и сноска уйдёт.
          ...(hy2Last7d === 0 ? { hy2_pending_collector: true } : {}),
        });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        online_window_minutes: onlineWindowMin,
        servers,
        // Diagnostic block — present only when called with ?refresh=1.
        // Lets the admin UI render «обновлено: 3/3 серверов / 2.4с»
        // and surface per-VPS errors (e.g. collector not installed).
        ...(refreshInfo ? { refresh: refreshInfo } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[admin/connections] error:', err);
    return NextResponse.json(
      { error: (err as Error).message ?? 'Internal error' },
      { status: 500 },
    );
  }
}
