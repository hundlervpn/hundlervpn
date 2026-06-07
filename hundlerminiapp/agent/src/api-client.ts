// Тонкая обёртка над fetch к /api/xray/clients. Endpoint существует
// давно и используется bash xray-sync.sh — мы просто переиспользуем
// его с теми же query/headers, чтобы не трогать backend на этом этапе.

import type { XrayClient } from './xray-grpc-client.ts';
import { log } from './logger.ts';

interface ApiResponse {
  ok: boolean;
  clients?: Array<{
    id: string;
    flow: string;
    email: string;
    expiryTime?: string | null;
  }>;
  error?: string;
}

export interface FetchOptions {
  apiUrl: string;
  syncToken: string;
  /** Заголовок чтобы /api/xray/clients вернул правильный flow для этой ноды. */
  serverHost?: string;
  /** Total fetch timeout. Должен быть < pull interval, иначе race. */
  timeoutMs?: number;
}

export class ApiClientError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function fetchClients(opts: FetchOptions): Promise<XrayClient[]> {
  const { apiUrl, syncToken, serverHost, timeoutMs = 15_000 } = opts;
  const url = new URL(apiUrl);
  url.searchParams.set('token', syncToken);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'hundler-xray-agent/0.1',
    };
    if (serverHost) headers['X-Server-Host'] = serverHost;

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (res.status === 503) {
      // Defence-in-depth signal от backend: pool empty, refusing to ship.
      // Уважаем — никаких изменений не вносим, ждём следующий tick.
      throw new ApiClientError('API returned 503 (pool empty / transient backend issue)', true);
    }
    if (!res.ok) {
      throw new ApiClientError(`API returned HTTP ${res.status}`, res.status >= 500);
    }

    const data = (await res.json()) as ApiResponse;
    if (!data.ok || !Array.isArray(data.clients)) {
      throw new ApiClientError(`API returned ok=false: ${data.error ?? 'unknown'}`, false);
    }

    return data.clients.map((c) => ({
      id: c.id,
      flow: c.flow ?? '',
      email: c.email,
    }));
  } catch (err) {
    if (err instanceof ApiClientError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiClientError(`Fetch timeout after ${timeoutMs}ms`, true);
    }
    log.error('Unexpected fetch error', { error: String(err) });
    throw new ApiClientError(`Fetch failed: ${String(err)}`, true);
  } finally {
    clearTimeout(timer);
  }
}
