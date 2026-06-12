// Entry point for hundler-xray-agent.
//
// Lifecycle:
//   1. Load config from env.
//   2. Open gRPC client to local Xray (127.0.0.1:10085 by default).
//   3. Run initial sync at startup (force snapshot to repair stale config.json).
//   4. Start HTTP listener (drop-in for xray-webhook.py).
//   5. Start periodic timer (default 5 min) — pull /api/xray/clients,
//      sync any drift via gRPC. Hourly enforce config.json snapshot
//      regardless of diff.
//   6. Graceful shutdown on SIGTERM / SIGINT.
//
// Бинарь распространяется как single-file via `bun build --compile`.
// Никакого runtime install (npm/node_modules) на VPS не требуется.

import { loadConfig } from './config.ts';
import { XrayGrpcClient } from './xray-grpc-client.ts';
import { runSync } from './sync.ts';
import { startWebhookServer } from './webhook-server.ts';
import { log } from './logger.ts';

const SNAPSHOT_INTERVAL_TICKS = 12; // Раз в 12 sync-ticks (≈ раз в час
                                    // при дефолтном PULL_INTERVAL_MS=5min)
                                    // принудительно пишем config.json
                                    // даже если diff пустой.

async function main(): Promise<void> {
  const config = loadConfig();
  log.info('hundler-xray-agent starting', {
    apiUrl: redactToken(config.apiUrl),
    grpcTarget: config.grpcTarget,
    inboundTag: config.inboundTag,
    cdnInboundTag: config.cdnInboundTag || '<disabled>',
    pullIntervalMs: config.pullIntervalMs,
    webhookPort: config.webhookPort,
    serverHost: config.serverHost || '<not set>',
  });

  const grpc = new XrayGrpcClient(config.grpcTarget);

  // Гард чтобы webhook не запускал параллельные sync'ы и cron не
  // наезжал на webhook. Все вызовы runSync проходят через wrap.
  let running = false;
  let tickCounter = 0;

  const wrappedRunSync = async (forceSnapshot = false) => {
    if (running) {
      log.debug('runSync skipped: already running');
      return makeNoopResult();
    }
    running = true;
    try {
      tickCounter++;
      const force = forceSnapshot || tickCounter % SNAPSHOT_INTERVAL_TICKS === 0;
      return await runSync(config, grpc, { forceSnapshot: force });
    } finally {
      running = false;
    }
  };

  // 1. Initial sync. force=true — гарантируем что config.json приведён
  // к актуальному desired state перед тем как webhook начнёт принимать
  // запросы. Если sync падает — НЕ exit (будем повторять); единственный
  // сценарий когда exit — gRPC недоступен (no Xray running). Это
  // системная ошибка, перезагрузка systemd unit help.
  log.info('startup: initial sync');
  try {
    const result = await wrappedRunSync(true);
    log.info('startup: initial sync done', result);
  } catch (err) {
    log.error('startup sync failed (will retry on next tick)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Webhook listener.
  startWebhookServer({
    config,
    runSync: () => wrappedRunSync(false),
    isSyncRunning: () => running,
  });

  // 3. Periodic pull (safety net + drift detection).
  const interval = setInterval(() => {
    void wrappedRunSync(false).catch((err) => {
      log.error('periodic sync failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, config.pullIntervalMs);

  // 4. Graceful shutdown. Bun + Node both handle SIGTERM the same way.
  const shutdown = (signal: string) => {
    log.info('shutting down', { signal });
    clearInterval(interval);
    grpc.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Heartbeat для observability — раз в минуту в info-лог чтобы было
  // видно что процесс жив (systemd journal иначе пустой пока diff
  // нулевой).
  setInterval(() => {
    log.debug('heartbeat', { running, tickCounter });
  }, 60_000);
}

function redactToken(url: string): string {
  return url.replace(/([?&]token=)[^&]+/g, '$1<redacted>');
}

function makeNoopResult() {
  return {
    ok: true,
    desiredCount: 0,
    currentCount: 0,
    added: 0,
    removed: 0,
    failedAdds: 0,
    failedRemoves: 0,
    durationMs: 0,
    snapshotWritten: false,
  };
}

main().catch((err) => {
  log.error('fatal init error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
