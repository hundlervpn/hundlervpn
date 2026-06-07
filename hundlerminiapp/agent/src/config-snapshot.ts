// Периодический дамп текущего состояния клиентов в config.json.
//
// Зачем: HandlerService.AlterInbound делает hot-reload — Xray
// добавляет/удаляет клиента в running memory БЕЗ записи в config.json.
// Если Xray ребутнется (kernel update, OOM kill, manual restart),
// при следующем старте он прочитает СТАРЫЙ config.json и поднимется
// с stale clients[] — все добавления через gRPC потеряются.
//
// Решение: каждые N минут agent пишет полный desired state в config.json
// (только clients[] внутри vless-in inbound, ничего другого не трогает).
// Это создаёт persistent baseline. После рестарта Xray поднимется с
// последним snapshot, потом agent догонит дельту через gRPC.
//
// ВАЖНО: write atomic (temp file → rename), config validation через
// `xray -test` перед apply. Та же логика что и в bash xray-sync.sh,
// но без cron lag и ARG_MAX issues — полный desired state у нас уже
// в памяти, не надо парсить argv.

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { XrayClient } from './xray-grpc-client.ts';
import { log } from './logger.ts';

interface XrayConfig {
  inbounds?: Array<{
    tag?: string;
    settings?: {
      clients?: Array<{ id: string; flow?: string; email?: string }>;
    };
  }>;
}

export async function writeConfigSnapshot(
  configPath: string,
  inboundTag: string,
  desiredClients: XrayClient[],
): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    log.error('Failed to read config.json', { configPath, error: String(err) });
    throw err;
  }

  let config: XrayConfig;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    log.error('config.json is not valid JSON, refusing to overwrite', {
      configPath,
      error: String(err),
    });
    throw err;
  }

  if (!Array.isArray(config.inbounds)) {
    throw new Error('config.json has no inbounds array');
  }

  const target = config.inbounds.find((i) => i.tag === inboundTag);
  if (!target) {
    throw new Error(`Inbound ${inboundTag} not found in config.json`);
  }

  // Sanity guard — та же логика что в bash xray-sync.sh: refuse to
  // wipe a non-trivial running set with an empty/tiny snapshot. Защита
  // от race-condition где fetchClients вернул [] непосредственно перед
  // тем как мы пишем (хотя API теперь сам отдаёт 503 для empty pool,
  // defence-in-depth).
  const oldCount = target.settings?.clients?.length ?? 0;
  const newCount = desiredClients.length;
  if (newCount < 1) {
    log.warn('writeConfigSnapshot: refusing to write empty clients[]', {
      oldCount,
      newCount,
    });
    return;
  }
  if (oldCount > 100 && newCount < oldCount / 2) {
    log.warn('writeConfigSnapshot: refusing >50% drop', { oldCount, newCount });
    return;
  }

  // Replace clients[] only — leave streamSettings / sniffing / port etc untouched.
  if (!target.settings) target.settings = {};
  target.settings.clients = desiredClients.map((c) => ({
    id: c.id,
    flow: c.flow,
    email: c.email,
  }));

  // Atomic write: temp file → xray -test → rename. Same convention as
  // xray-sync.sh used `${XRAY_CONFIG%.json}.new.json` because Xray v26
  // determines format by extension and rejects `.tmp`.
  const dir = path.dirname(configPath);
  const base = path.basename(configPath, '.json');
  const tmpPath = path.join(dir, `${base}.new.json`);

  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf8');

  const valid = await validateXrayConfig(tmpPath);
  if (!valid.ok) {
    await fs.unlink(tmpPath).catch(() => undefined);
    log.error('writeConfigSnapshot: xray -test rejected new config', {
      reason: valid.reason,
    });
    throw new Error(`xray -test failed: ${valid.reason}`);
  }

  await fs.rename(tmpPath, configPath);
  log.info('config.json snapshot written', { newCount, oldCount, inboundTag });
}

async function validateXrayConfig(
  configPath: string,
): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('/usr/local/bin/xray', ['-test', '-config', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stdout?.on('data', () => undefined); // discard
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      resolve({ ok: false, reason: `spawn failed: ${err.message}` });
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        // Возьмём только последние 5 строк — обычно там самое полезное.
        const tail = stderr.trim().split('\n').slice(-5).join(' | ');
        resolve({ ok: false, reason: `exit=${code}: ${tail}` });
      }
    });
  });
}
