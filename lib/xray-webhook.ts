/**
 * Helper for triggering Xray client sync on VPN servers via their webhook.
 *
 * When the main API changes the set of allowed UUIDs (e.g. user removes a
 * device, subscription expires, new per-device UUID created), we POST to
 * each VPN server's /sync endpoint. The server then runs /opt/xray-sync.sh
 * which diffs current Xray state vs the authoritative /api/xray/clients
 * response and applies only the deltas via Xray's HandlerService gRPC API
 * (adu/rmu) — no restart, no connection drops.
 *
 * Source of webhook URL list (v67, 2026-05-17):
 *   1. Primary  — `servers` table: every row with is_active=TRUE becomes
 *                 `http://<host>:<XRAY_WEBHOOK_PORT>/sync`. Adding a VPS
 *                 in admin UI is enough — no .env edit required. This was
 *                 the v66 → v67 root cause: ENV `XRAY_WEBHOOK_URL` listed
 *                 only RU; NL/DE/etc were silently skipped, leaving them
 *                 N/A until the 5-min cron tick on /opt/xray-sync.sh.
 *   2. Fallback — comma-separated ENV `XRAY_WEBHOOK_URL`, kept for
 *                 dev setups and the case where DB lookup fails.
 *
 * Env vars:
 *   XRAY_WEBHOOK_URL   — fallback comma-separated webhook URLs.
 *                          http://<nl>:9999/sync,http://<de>:9999/sync
 *   XRAY_WEBHOOK_TOKEN — auth token (falls back to XRAY_SYNC_TOKEN)
 *   XRAY_WEBHOOK_PORT  — port the xray-webhook.py listener runs on
 *                        (default 9999; same on every VPS per playbook)
 *
 * 'wait' mode fans out to ALL configured URLs in parallel and returns true
 * only if every server confirms (any failure → false).
 * 'fire-and-forget' fires each webhook asynchronously and returns immediately.
 *
 * The call is best-effort with retry: errors are logged but never rethrown
 * so they can't break the surrounding request.
 */

import { dbQuery } from '@/lib/db';
import { remnawaveConfigured } from '@/lib/remnawave';
import { threexuiConfigured } from '@/lib/threexui';

const WEBHOOK_URL_RAW = process.env.XRAY_WEBHOOK_URL;
const WEBHOOK_TOKEN = process.env.XRAY_WEBHOOK_TOKEN || process.env.XRAY_SYNC_TOKEN;
const WEBHOOK_PORT = Number(process.env.XRAY_WEBHOOK_PORT ?? '9999');

type WebhookTarget = {
  url: string;
  token: string;
};

/** Parse comma-separated XRAY_WEBHOOK_URL into a list of clean URLs. */
function parseEnvUrls(): string[] {
  if (!WEBHOOK_URL_RAW) return [];
  return WEBHOOK_URL_RAW.split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
}

/**
 * Load webhook URLs from the live `servers` table, falling back to ENV.
 *
 * Primary path: one URL per `servers` row with `is_active = TRUE` —
 *   `http://<host>:<WEBHOOK_PORT>/sync`. Built fresh on every call so
 *   adding/removing a VPS in the admin UI takes effect within ~1ms (one
 *   indexed SELECT) — no app restart, no ENV churn.
 *
 * Fallback path: comma-separated ENV `XRAY_WEBHOOK_URL`. Kept because
 *   (a) `next dev` against a local DB might not have the servers row
 *       populated, and (b) if the DB itself is unreachable we still want
 *       the cron/payment paths to try whatever ENV says.
 *
 * Best-effort: a DB query failure logs a warning and degrades to ENV
 * instead of throwing, so the surrounding payment/promo callback never
 * fails because the webhook plumbing hiccuped.
 */
async function getWebhookUrls(): Promise<string[]> {
  const targets = await getWebhookTargets();
  return targets.map((t) => t.url);
}

async function getWebhookTargets(): Promise<WebhookTarget[]> {
  try {
    const res = await dbQuery<{ host: string; sync_token: string | null }>(
      `SELECT host, sync_token
         FROM servers
        WHERE is_active = TRUE
          AND host IS NOT NULL
          AND host <> ''
        ORDER BY id ASC`,
    );
    if (res.rows.length > 0) {
      return res.rows.map((r) => ({
        url: `http://${r.host}:${WEBHOOK_PORT}/sync`,
        token: r.sync_token || WEBHOOK_TOKEN || '',
      }));
    }
    console.warn('[xray-webhook] DB returned 0 active servers, falling back to ENV');
  } catch (err) {
    console.warn('[xray-webhook] DB lookup failed, falling back to ENV:', err);
  }
  return parseEnvUrls().map((url) => ({ url, token: WEBHOOK_TOKEN || '' }));
}

/** Timeout per attempt (ms). The webhook must complete xray-sync.sh within this. */
const TIMEOUT_MS = 10_000;
/** Max retry attempts for 'wait' mode. */
const MAX_RETRIES = 2;

export type TriggerMode = 'wait' | 'fire-and-forget';

/**
 * Ask every configured VPN server to re-sync its Xray client list.
 *
 * @param mode 'wait' — await the webhook response (up to 10s × 2 retries);
 *             the caller blocks until sync is confirmed or all retries fail.
 *             Use for new per-device UUID creation so the VPN server knows
 *             the UUID before the client tries to connect.
 *             'fire-and-forget' — returns immediately without awaiting the
 *             network round-trip.
 */
/**
 * Whether the legacy self-built Xray-sync (this module) should run at all.
 *
 * After the Phase B migration to the Remnawave panel, node client-list sync
 * is owned by Remnawave. The self-built webhook sync is then dead code: the
 * `servers` rows point at decommissioned nodes and, with XRAY_WEBHOOK_PORT
 * unset, the URLs come out as `http://<host>:0/sync`, which just times out
 * (10s x MAX_RETRIES) on every call — spamming logs and adding ~20s latency
 * to device deletes / expiry sweeps.
 *
 * So: when Remnawave is configured, the legacy sync is disabled by default.
 * Set XRAY_SYNC_FORCE_LEGACY=1 to force it back on (pre-migration / rollback).
 */
function legacyXraySyncEnabled(): boolean {
  if (process.env.XRAY_SYNC_FORCE_LEGACY === '1') return true;
  return !remnawaveConfigured() && !threexuiConfigured();
}

export async function triggerXraySync(mode: TriggerMode = 'wait'): Promise<boolean> {
  // Remnawave owns node sync post-migration — skip the dead self-built sync
  // (avoids the `http://<host>:0/sync` timeouts). Report success so callers
  // that gate on this (e.g. ensureVpnKey) proceed normally.
  if (!legacyXraySyncEnabled()) {
    return true;
  }

  // Capture short stack so we know who called this (debugging restart-storm
  // incidents). Anything after `triggerXraySync` is the real caller chain.
  const callerStack = new Error().stack
    ?.split('\n')
    .slice(2, 6)
    .map((l) => l.trim())
    .join(' <- ') ?? '<no stack>';
  console.log(`[xray-webhook] 🔥 TRIGGERED mode=${mode} from: ${callerStack}`);

  const targets = await getWebhookTargets();
  if (targets.length === 0 || targets.some((t) => !t.token)) {
    console.error(
      '[xray-webhook] ❌ XRAY_WEBHOOK_URL or XRAY_WEBHOOK_TOKEN not configured! '
      + 'New device UUIDs will NOT sync until the 5-min cron runs. '
      + 'Set XRAY_WEBHOOK_URL=http://<nl>:9999/sync,http://<de>:9999/sync on Timeweb.',
    );
    return false;
  }

  // CRITICAL: fire-and-forget uses async=1 so Python webhook returns 202
  // instantly (without running xray-sync.sh synchronously). The Python
  // HTTPServer is single-threaded — synchronous calls block it for 15-20s
  // (fetching API + restarting Xray), queuing all subsequent webhook calls.
  const asyncParam = mode === 'fire-and-forget' ? '&async=1' : '';

  const doFetch = async (baseUrl: string, attempt: number): Promise<boolean> => {
    const token = targets.find((t) => t.url === baseUrl)?.token || WEBHOOK_TOKEN;
    const separator = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${separator}token=${encodeURIComponent(token!)}${asyncParam}`;
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      const elapsed = Date.now() - t0;
      if (res.status !== 202 && res.status !== 200) {
        console.error(`[xray-webhook] ${baseUrl} attempt ${attempt}: status ${res.status} (${elapsed}ms)`);
        return false;
      }
      console.log(`[xray-webhook] ✅ ${baseUrl} OK attempt ${attempt} (${elapsed}ms)`);
      return true;
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.error(`[xray-webhook] ${baseUrl} attempt ${attempt} failed (${elapsed}ms):`, err);
      return false;
    }
  };

  if (mode === 'fire-and-forget') {
    for (const target of targets) {
      void doFetch(target.url, 1);
    }
    return true;
  }

  // 'wait' mode: fan out in parallel, retry each URL up to MAX_RETRIES times.
  const syncOne = async (baseUrl: string): Promise<boolean> => {
    for (let i = 1; i <= MAX_RETRIES; i++) {
      const ok = await doFetch(baseUrl, i);
      if (ok) return true;
      if (i < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    console.error(`[xray-webhook] ❌ all ${MAX_RETRIES} attempts failed for ${baseUrl}`);
    return false;
  };

  const results = await Promise.all(targets.map((target) => syncOne(target.url)));
  return results.every(Boolean);
}

/* ----------------------------- Traffic refresh ----------------------------- */

/** Per-server result of a traffic refresh fan-out. */
export type TrafficRefreshResult = {
  /** webhook base URL — useful for surfacing per-server status in UI/logs */
  url: string;
  /** true iff the webhook returned 2xx and all collector scripts had rc=0 */
  ok: boolean;
  /** elapsed ms for the round-trip */
  elapsed_ms: number;
  /** human-readable error if !ok (e.g. "timeout", "404 no collector") */
  error?: string;
};

/** Per-collector timeout on the VPS side (must align with TRAFFIC_TIMEOUT in
 *  scripts/xray-webhook.py). The HTTP client has to wait at least this long. */
const TRAFFIC_TIMEOUT_MS = 30_000;

/**
 * Synchronously ask every configured VPN server to push fresh traffic stats.
 *
 * On the VPS, `xray-webhook.py /traffic` runs `/opt/xray-traffic.sh` and
 * `/opt/hy2-traffic.sh` (whichever exist) and waits for them to finish before
 * responding. Those scripts in turn POST per-user bytes to /api/xray/traffic,
 * which UPSERTs `user_server_traffic` rows.
 *
 * Used by the admin "Обновить" button in the Servers tab: instead of waiting
 * for the next 5-min cron tick, we trigger collection on demand so the user
 * sees genuinely live stats.
 *
 * Returns a per-server breakdown so the UI can show which nodes failed.
 * Always resolves — never throws — so it can't break the surrounding request.
 */
export async function triggerTrafficRefresh(): Promise<{
  ok: boolean;
  servers: TrafficRefreshResult[];
}> {
  if (!legacyXraySyncEnabled()) {
    // Remnawave owns traffic accounting post-migration; nothing to refresh here.
    return { ok: true, servers: [] };
  }

  const targets = await getWebhookTargets();
  if (targets.length === 0 || targets.some((t) => !t.token)) {
    console.error(
      '[xray-webhook] /traffic refresh skipped: XRAY_WEBHOOK_URL/TOKEN not set',
    );
    return { ok: false, servers: [] };
  }

  // Each /sync URL maps 1:1 to a /traffic URL on the same listener — we just
  // swap the trailing /sync for /traffic. If a webhook URL doesn't end in /sync
  // we replace the path component anyway.
  const refreshUrl = (base: string): string => {
    try {
      const u = new URL(base);
      // strip trailing /sync if present, then add /traffic
      u.pathname = u.pathname.replace(/\/sync\/?$/, '') + '/traffic';
      return u.toString();
    } catch {
      // Fallback for malformed URLs — best-effort string replace.
      return base.replace(/\/sync(\?|$)/, '/traffic$1');
    }
  };

  const refreshOne = async (targetInfo: WebhookTarget): Promise<TrafficRefreshResult> => {
    const baseUrl = targetInfo.url;
    const target = refreshUrl(baseUrl);
    const separator = target.includes('?') ? '&' : '?';
    const url = `${target}${separator}token=${encodeURIComponent(targetInfo.token)}`;
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(TRAFFIC_TIMEOUT_MS),
        cache: 'no-store',
      });
      const elapsed = Date.now() - t0;
      if (res.status === 404) {
        return {
          url: baseUrl,
          ok: false,
          elapsed_ms: elapsed,
          error: 'no traffic collector installed on this VPS',
        };
      }
      if (res.status !== 200 && res.status !== 207) {
        return {
          url: baseUrl,
          ok: false,
          elapsed_ms: elapsed,
          error: `HTTP ${res.status}`,
        };
      }
      // 207 = Multi-Status: some collector scripts had non-zero rc. Webhook
      // returns ok:false in body in that case.
      const body = await res.json().catch(() => ({ ok: false }));
      return { url: baseUrl, ok: !!body.ok, elapsed_ms: elapsed };
    } catch (err) {
      const elapsed = Date.now() - t0;
      // Node's `fetch` swallows the underlying TCP/DNS error code into a
      // generic "fetch failed" message; the real cause sits on `.cause`
      // (typed as Error with `.code` like ECONNREFUSED / ECONNRESET /
      // ETIMEDOUT / ENOTFOUND). Surfacing this gives the admin actionable
      // info — "fetch failed" tells you nothing, "ECONNRESET" tells you
      // the listener is up but RST'ing, "ENOTFOUND" tells you DNS is bad.
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      const causeCode = cause?.code;
      const causeMsg = cause?.message;
      const baseMsg = err instanceof Error ? err.message : String(err);
      const msg = causeCode
        ? `${baseMsg} (${causeCode})`
        : causeMsg
          ? `${baseMsg}: ${causeMsg}`
          : baseMsg;
      return { url: baseUrl, ok: false, elapsed_ms: elapsed, error: msg };
    }
  };

  const servers = await Promise.all(targets.map(refreshOne));
  const allOk = servers.every((s) => s.ok);
  console.log(
    `[xray-webhook] /traffic fan-out: ${servers.filter((s) => s.ok).length}/${servers.length} ok`,
  );
  return { ok: allOk, servers };
}
