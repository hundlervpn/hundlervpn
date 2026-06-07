// HTTP listener — drop-in replacement for /opt/xray-webhook.py.
//
// Endpoints:
//   POST /sync?token=...        — kicks runSync (returns 200 OK with stats)
//   POST /sync?token=...&async=1 — kicks runSync, returns 202 immediately
//   GET  /health                — node liveness, returns capabilities
//   POST /traffic?token=...     — runs /opt/xray-traffic.sh + /opt/hy2-traffic.sh
//                                 (synchronous, used by admin "Обновить")
//
// Совместимо с lib/xray-webhook.ts protocol — mini-app не нужно
// модифицировать, чтобы переключиться на новый агент.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, accessSync, constants as fsConstants } from 'node:fs';

import type { AgentConfig } from './config.ts';
import type { runSync as RunSyncFn } from './sync.ts';
import { log } from './logger.ts';

interface ServerDeps {
  config: AgentConfig;
  runSync: () => ReturnType<typeof RunSyncFn>;
  isSyncRunning: () => boolean;
}

const TRAFFIC_SCRIPTS = ['/opt/xray-traffic.sh', '/opt/hy2-traffic.sh'];
const TRAFFIC_TIMEOUT_MS = 25_000;

export function startWebhookServer(deps: ServerDeps): void {
  const { config, runSync, isSyncRunning } = deps;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/health') {
      respondJson(res, 200, {
        ok: true,
        version: 'hundler-xray-agent/0.1',
        sync_script: 'grpc',
        traffic_scripts: TRAFFIC_SCRIPTS.filter(isExecutable),
      });
      return;
    }

    if (method !== 'POST') {
      respondJson(res, 405, { error: 'method not allowed' });
      return;
    }

    const token = url.searchParams.get('token');
    if (token !== config.webhookToken) {
      respondJson(res, 403, { error: 'forbidden' });
      return;
    }

    if (url.pathname === '/sync') {
      handleSync(url, res, runSync, isSyncRunning);
      return;
    }
    if (url.pathname === '/traffic') {
      handleTraffic(res);
      return;
    }
    respondJson(res, 404, { error: 'not found' });
  });

  server.listen(config.webhookPort, '0.0.0.0', () => {
    log.info('webhook listening', { port: config.webhookPort });
  });

  server.on('error', (err) => {
    log.error('webhook server error', { error: err.message });
  });
}

function handleSync(
  url: URL,
  res: ServerResponse,
  runSync: () => ReturnType<typeof RunSyncFn>,
  isSyncRunning: () => boolean,
): void {
  const isAsync = url.searchParams.get('async') === '1';

  if (isSyncRunning()) {
    // Уже идёт sync — другой webhook вызов не нужен, расход на пустую gRPC
    // round-trip. Вернём 200 с пометкой что batched.
    respondJson(res, 200, { ok: true, batched: true });
    return;
  }

  if (isAsync) {
    // Fire-and-forget — отвечаем сразу, sync в background.
    respondJson(res, 202, { ok: true, queued: true });
    runSync().catch((err) => {
      log.error('async sync failed', { error: err instanceof Error ? err.message : String(err) });
    });
    return;
  }

  // Sync — ждём завершения, отвечаем результатом.
  runSync()
    .then((result) => {
      respondJson(res, result.ok ? 200 : 500, result);
    })
    .catch((err) => {
      log.error('sync errored', { error: err instanceof Error ? err.message : String(err) });
      respondJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
}

function handleTraffic(res: ServerResponse): void {
  const present = TRAFFIC_SCRIPTS.filter(isExecutable);
  if (present.length === 0) {
    respondJson(res, 404, {
      error: 'no traffic collector installed',
      tried: TRAFFIC_SCRIPTS,
    });
    return;
  }

  Promise.all(present.map(runTrafficScript))
    .then((results) => {
      const allOk = results.every((r) => r.rc === 0);
      respondJson(res, allOk ? 200 : 207, { ok: allOk, results });
    })
    .catch((err) => {
      log.error('traffic refresh errored', { error: err instanceof Error ? err.message : String(err) });
      respondJson(res, 500, { error: 'traffic refresh failed' });
    });
}

interface TrafficResult {
  script: string;
  rc: number;
  error?: string;
}

function runTrafficScript(script: string): Promise<TrafficResult> {
  return new Promise((resolve) => {
    const proc = spawn(script, [], { stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ script, rc: -1, error: 'timeout' });
    }, TRAFFIC_TIMEOUT_MS);
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ script, rc: -1, error: err.message });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ script, rc: code ?? -1 });
    });
  });
}

function isExecutable(p: string): boolean {
  if (!existsSync(p)) return false;
  try {
    accessSync(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body) + '\n');
}

// Также игнорим body для `_req`-параметра — Node.js auto-discards если
// мы не вызываем .on('data'). Но всё равно рекомендуется явно read'ить
// чтобы освободить socket. Делаем это в createServer handler через
// stream.resume() — добавим если будут проблемы с keep-alive.
export type { IncomingMessage };
