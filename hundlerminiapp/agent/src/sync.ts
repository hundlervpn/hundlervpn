// One full sync iteration: fetch desired state from /api/xray/clients,
// list current state via gRPC, compute diff, apply add/remove operations
// minimally, occasionally dump snapshot to config.json.
//
// Идемпотентно — можно дёргать сколько угодно раз (cron, webhook, manual).

import type { AgentConfig } from './config.ts';
import { fetchClients, ApiClientError } from './api-client.ts';
import { computeDiff } from './diff.ts';
import { XrayGrpcClient, type XrayClient } from './xray-grpc-client.ts';
import { writeConfigSnapshot } from './config-snapshot.ts';
import { log } from './logger.ts';

export interface SyncResult {
  ok: boolean;
  desiredCount: number;
  currentCount: number;
  added: number;
  removed: number;
  failedAdds: number;
  failedRemoves: number;
  durationMs: number;
  /** Был ли в этом ране дамп в config.json. Для observability. */
  snapshotWritten: boolean;
}

export interface SyncOptions {
  /**
   * Если true, всегда пишем config.json snapshot, даже если diff
   * пустой. Используется для startup и периодического (раз в N минут)
   * snapshot'а. По умолчанию false (write только при изменениях).
   */
  forceSnapshot?: boolean;
}

export async function runSync(
  config: AgentConfig,
  grpc: XrayGrpcClient,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const startedAt = Date.now();

  // 1. Fetch desired state (HTTPS /api/xray/clients).
  let desired: XrayClient[];
  try {
    desired = await fetchClients({
      apiUrl: config.apiUrl,
      syncToken: config.syncToken,
      serverHost: config.serverHost,
    });
  } catch (err) {
    log.error('sync: fetchClients failed', {
      error: err instanceof Error ? err.message : String(err),
      retryable: err instanceof ApiClientError ? err.retryable : true,
    });
    return makeFailureResult(startedAt);
  }

  // 2. Sanity floor — defence-in-depth. Backend уже возвращает 503 если
  // пул empty, но если он сломан и вернул { ok: true, clients: [] },
  // мы тоже не делаем ничего. Лучше stale state чем пустой Xray.
  if (desired.length < config.sanityFloor) {
    log.warn('sync: desired below sanity floor, skipping', {
      desiredCount: desired.length,
      floor: config.sanityFloor,
    });
    return makeFailureResult(startedAt);
  }

  // 3. List current state via gRPC.
  let currentEmails: Set<string>;
  try {
    currentEmails = await grpc.listInboundUserEmails(config.inboundTag);
  } catch (err) {
    log.error('sync: listInboundUserEmails failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return makeFailureResult(startedAt);
  }

  // 4. Compute diff and apply.
  const diff = computeDiff(desired, currentEmails);
  log.info('sync: diff computed', {
    desired: desired.length,
    current: currentEmails.size,
    toAdd: diff.toAdd.length,
    toRemove: diff.toRemove.length,
    unchanged: diff.unchanged,
  });

  let failedAdds = 0;
  let failedRemoves = 0;

  // Removes first — освобождает email-slot если у нас есть add'ы с тем
  // же email (relabelling pool-N → tg-… между signups).
  for (const email of diff.toRemove) {
    try {
      await grpc.removeUser(config.inboundTag, email);
    } catch (err) {
      failedRemoves++;
      log.warn('sync: removeUser failed', {
        email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const client of diff.toAdd) {
    try {
      await grpc.addUser(config.inboundTag, client);
    } catch (err) {
      failedAdds++;
      log.warn('sync: addUser failed', {
        email: client.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5. Snapshot to config.json. Делаем когда:
  //    (a) есть реальные изменения (toAdd/toRemove > 0);
  //    (b) opts.forceSnapshot — startup hook + раз в N минут от main loop.
  // Если diff пустой и opts.forceSnapshot=false, config.json не трогаем.
  const hasChanges = diff.toAdd.length > 0 || diff.toRemove.length > 0;
  let snapshotWritten = false;
  if (hasChanges || opts.forceSnapshot) {
    try {
      await writeConfigSnapshot(config.xrayConfigPath, config.inboundTag, desired);
      snapshotWritten = true;
    } catch (err) {
      log.error('sync: writeConfigSnapshot failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      // НЕ считаем ошибку фатальной для всего sync'а — gRPC уже применили,
      // running Xray в нужном состоянии. Snapshot — это только для
      // post-restart recovery, и следующий run его повторит.
    }
  }

  const durationMs = Date.now() - startedAt;
  log.info('sync: done', {
    durationMs,
    added: diff.toAdd.length - failedAdds,
    removed: diff.toRemove.length - failedRemoves,
    failedAdds,
    failedRemoves,
    snapshotWritten,
  });

  return {
    ok: failedAdds === 0 && failedRemoves === 0,
    desiredCount: desired.length,
    currentCount: currentEmails.size,
    added: diff.toAdd.length - failedAdds,
    removed: diff.toRemove.length - failedRemoves,
    failedAdds,
    failedRemoves,
    durationMs,
    snapshotWritten,
  };
}

function makeFailureResult(startedAt: number): SyncResult {
  return {
    ok: false,
    desiredCount: 0,
    currentCount: 0,
    added: 0,
    removed: 0,
    failedAdds: 0,
    failedRemoves: 0,
    durationMs: Date.now() - startedAt,
    snapshotWritten: false,
  };
}
