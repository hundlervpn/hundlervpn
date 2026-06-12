// Конфиг агента — всё через ENV, никаких config-файлов. Совместимо с
// systemd Environment= блоком в xray-sync.service.

import { readFileSync, existsSync } from 'node:fs';

export interface AgentConfig {
  /**
   * URL `/api/xray/clients` в mini-app. Тот же endpoint что и
   * bash xray-sync.sh использует, ответ pre-filtered по `sync_token`.
   */
  apiUrl: string;

  /**
   * Per-server sync_token. Совпадает с `servers.sync_token` в БД
   * mini-app. Передаётся как `?token=...` параметр.
   */
  syncToken: string;

  /**
   * Адрес локального Xray HandlerService gRPC. Дефолт совпадает с тем
   * что прописано во всех setup-*.sh: dokodemo-door listening на
   * 127.0.0.1:10085. НЕ должен быть публичным — gRPC over TLS через
   * ТСПУ возможен но создаёт fingerprint риск, см. AGENTS.md.
   */
  grpcTarget: string;

  /**
   * Tag VLESS inbound внутри config.json. Должен совпадать с тем что
   * прописано в setup-*.sh `INBOUND_TAG`.
   */
  inboundTag: string;

  /**
   * Опциональный второй inbound для CDN-обхода (VLESS+WebSocket за
   * Caddy/CDN, для режима «белых списков»/БС). Если задан — агент
   * синхронизирует ТОТ ЖЕ пул клиентов и в него, но с пустым `flow`
   * (xtls-rprx-vision работает только по прямому TCP, не через WS/CDN).
   * Пусто (default) = фича выключена, поведение не меняется.
   * Соответствует тегу inbound из deploy/add-cdn-inbound.sh.
   */
  cdnInboundTag: string;

  /**
   * Header `X-Server-Host` чтобы /api/xray/clients вернул правильный
   * flow для этой ноды (NL=xtls-rprx-vision, DE/RU="" XUDP). См.
   * authenticateToken() в app/api/xray/clients/route.ts.
   */
  serverHost: string;

  /**
   * Polling-интервал в миллисекундах. Бекап для случая когда mini-app
   * не смог пушнуть через webhook (network blip, deploy и т.д.).
   * Webhook остаётся primary триггером — это safety net.
   */
  pullIntervalMs: number;

  /**
   * Порт HTTP listener'а для webhook push'ей от mini-app.
   * Совместимо с XRAY_WEBHOOK_PORT в lib/xray-webhook.ts (default 9999).
   */
  webhookPort: number;

  /**
   * Token для webhook auth. Тот же что mini-app передаёт в
   * `?token=...`. Чаще всего совпадает с syncToken.
   */
  webhookToken: string;

  /**
   * Путь к config.json Xray. Agent периодически дампит сюда
   * актуальный state из gRPC ListInbounds — это нужно чтобы после
   * `systemctl restart xray` (kernel update, OOM kill) inbound поднялся
   * с текущими клиентами, а не с пустым clients[] из stale config.
   */
  xrayConfigPath: string;

  /**
   * Floor for sanity check — refuse to apply a sync that would result
   * in fewer than this many clients. Та же логика что в bash version:
   * "0 clients" almost always = transient backend hiccup, не реальная
   * массовая expirea. См. инцидент 2026-05-07.
   */
  sanityFloor: number;
}

function envOr(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v != null && v.length > 0) return v;
  if (fallback != null) return fallback;
  throw new Error(`Missing required env ${name}`);
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v.length === 0) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} is not a number: ${v}`);
  return n;
}

/**
 * Auto-detect public IP так же как webhook.py — читаем /etc/hostname,
 * либо `/etc/xray-agent/server-host` если оператор зашил вручную.
 * Используется как fallback для X-Server-Host если оператор не задал.
 */
function detectServerHost(): string {
  const overridePath = '/etc/xray-agent/server-host';
  if (existsSync(overridePath)) {
    try {
      const v = readFileSync(overridePath, 'utf8').trim();
      if (v.length > 0) return v;
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function loadConfig(): AgentConfig {
  const syncToken = envOr('SYNC_TOKEN');
  return {
    apiUrl: envOr('API_URL', 'https://hundlervpn.xyz/api/xray/clients'),
    syncToken,
    grpcTarget: envOr('GRPC_TARGET', '127.0.0.1:10085'),
    inboundTag: envOr('INBOUND_TAG', 'vless-in'),
    cdnInboundTag: process.env.CDN_INBOUND_TAG?.trim() ?? '',
    serverHost: envOr('SERVER_HOST', detectServerHost()),
    pullIntervalMs: envNum('PULL_INTERVAL_MS', 300_000), // 5 минут, как старый cron
    webhookPort: envNum('WEBHOOK_PORT', 9999),
    webhookToken: envOr('WEBHOOK_TOKEN', syncToken),
    xrayConfigPath: envOr('XRAY_CONFIG_PATH', '/usr/local/etc/xray/config.json'),
    sanityFloor: envNum('SANITY_FLOOR', 1),
  };
}
