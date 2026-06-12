// One full sync iteration: fetch desired state from /api/xray/clients,
// list current state via gRPC, compute diff, apply add/remove operations
// minimally, occasionally dump snapshot to config.json.
//
// Идемпотентно — можно дёргать сколько угодно раз (cron, webhook, manual).

import type { AgentConfig } from './config.ts';
import { fetchClients, ApiClientError } from './api-client.ts';
import { computeDiff } from './diff.ts';
import { XrayGrpcClient, type XrayClient } from './xray-grpc-client.ts';
import { writeConfigSnapshotMulti, type SnapshotEntry } from './config-snapshot.ts';
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

  // 3-4. Sync primary inbound (Reality). Ошибки тут фатальны для всего
  // ран — это боевой inbound, в котором сидят все юзеры.
  let primary: InboundSyncStats;
  try {
    primary = await applyInboundDiff(grpc, config.inboundTag, desired);
  } catch (err) {
    log.error('sync: primary inbound sync failed', {
      inboundTag: config.inboundTag,
      error: err instanceof Error ? err.message : String(err),
    });
    return makeFailureResult(startedAt);
  }

  // 3b-4b. Опционально — CDN-inbound (VLESS+WS за CDN, режим БС).
  // Тот же пул клиентов, но flow="" (vision не работает через WS/CDN).
  // Best-effort: ошибки тут НЕ роняют primary sync.
  const cdnEnabled = config.cdnInboundTag.length > 0;
  const cdnDesired: XrayClient[] = cdnEnabled
    ? desired.map((c) => ({ ...c, flow: '' }))
    : [];
  let cdn: InboundSyncStats | null = null;
  if (cdnEnabled) {
    try {
      cdn = await applyInboundDiff(grpc, config.cdnInboundTag, cdnDesired);
    } catch (err) {
      log.warn('sync: cdn inbound sync failed (non-fatal)', {
        cdnInboundTag: config.cdnInboundTag,
        error: err instanceof Error ? err.message : String(err),
        hint: 'inbound может быть ещё не добавлен — см. deploy/add-cdn-inbound.sh',
      });
    }
  }

  // 5. Snapshot to config.json. Делаем когда:
  //    (a) есть реальные изменения (toAdd/toRemove > 0) в любом inbound;
  //    (b) opts.forceSnapshot — startup hook + раз в N минут от main loop.
  // Если diff пустой и opts.forceSnapshot=false, config.json не трогаем.
  const hasChanges =
    primary.added > 0 ||
    primary.removed > 0 ||
    (cdn != null && (cdn.added > 0 || cdn.removed > 0));
  let snapshotWritten = false;
  if (hasChanges || opts.forceSnapshot) {
    const entries: SnapshotEntry[] = [
      { inboundTag: config.inboundTag, desiredClients: desired, required: true },
    ];
    if (cdnEnabled) {
      // required:false — если CDN-inbound ещё не в config.json, просто
      // пропускаем его в snapshot, не роняя primary recovery-baseline.
      entries.push({
        inboundTag: config.cdnInboundTag,
        desiredClients: cdnDesired,
        required: false,
      });
    }
    try {
      await writeConfigSnapshotMulti(config.xrayConfigPath, entries);
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

  const failedAdds = primary.failedAdds + (cdn?.failedAdds ?? 0);
  const failedRemoves = primary.failedRemoves + (cdn?.failedRemoves ?? 0);

  const durationMs = Date.now() - startedAt;
  log.info('sync: done', {
    durationMs,
    added: primary.added,
    removed: primary.removed,
    failedAdds: primary.failedAdds,
    failedRemoves: primary.failedRemoves,
    cdn: cdn
      ? { added: cdn.added, removed: cdn.removed, failedAdds: cdn.failedAdds, failedRemoves: cdn.failedRemoves }
      : undefined,
    snapshotWritten,
  });

  return {
    ok: failedAdds === 0 && failedRemoves === 0,
    desiredCount: desired.length,
    currentCount: primary.currentCount,
    added: primary.added,
    removed: primary.removed,
    failedAdds: primary.failedAdds,
    failedRemoves: primary.failedRemoves,
    durationMs,
    snapshotWritten,
  };
}

interface InboundSyncStats {
  added: number;
  removed: number;
  failedAdds: number;
  failedRemoves: number;
  currentCount: number;
}

/**
 * list → diff → apply для одного inbound. Возвращает счётчики.
 * Если inbound не зарегистрирован в running Xray (handler not found),
 * первый же addUser кинет ошибку с "not found" — мы её детектим и
 * сразу пробрасываем, чтобы не спамить варнингами на каждого клиента.
 */
async function applyInboundDiff(
  grpc: XrayGrpcClient,
  inboundTag: string,
  desired: XrayClient[],
): Promise<InboundSyncStats> {
  const currentEmails = await grpc.listInboundUserEmails(inboundTag);
  const diff = computeDiff(desired, currentEmails);
  log.info('sync: diff computed', {
    inboundTag,
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
      await grpc.removeUser(inboundTag, email);
    } catch (err) {
      failedRemoves++;
      log.warn('sync: removeUser failed', {
        inboundTag,
        email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const client of diff.toAdd) {
    try {
      await grpc.addUser(inboundTag, client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Inbound отсутствует в running Xray — нет смысла перебирать весь
      // пул, пробрасываем сразу (caller решит — фатально или best-effort).
      if (/not\s*found/i.test(msg)) {
        throw new Error(`inbound ${inboundTag} not registered in Xray: ${msg}`);
      }
      failedAdds++;
      log.warn('sync: addUser failed', {
        inboundTag,
        email: client.email,
        error: msg,
      });
    }
  }

  return {
    added: diff.toAdd.length - failedAdds,
    removed: diff.toRemove.length - failedRemoves,
    failedAdds,
    failedRemoves,
    currentCount: currentEmails.size,
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
