/**
 * Remnawave Panel API client.
 *
 * Thin, dependency-free wrapper over the panel REST API. Replaces the old
 * custom Xray gRPC agent (agent/, vpn-agent/) — Remnawave now owns all VPN
 * user/key/node state. Business logic (payments, referrals, tickets) stays
 * in our Postgres; this module is the ONLY bridge to the VPN layer.
 *
 * Env:
 *   REMNAWAVE_API_URL    panel base, e.g. https://panel.hundlervpn.xyz
 *   REMNAWAVE_API_TOKEN  Bearer API token (role: API)   [SECRET]
 *   REMNAWAVE_SQUAD_UUID default internal-squad assigned to new users
 */

const API_URL = (process.env.REMNAWAVE_API_URL || '').replace(/\/+$/, '');
const API_TOKEN = process.env.REMNAWAVE_API_TOKEN || '';
const DEFAULT_SQUAD = process.env.REMNAWAVE_SQUAD_UUID || '';

export type RwUserStatus = 'ACTIVE' | 'DISABLED' | 'LIMITED' | 'EXPIRED';

export interface RwUser {
  uuid: string;
  shortUuid: string;
  username: string;
  status: RwUserStatus;
  expireAt: string;
  telegramId: number | null;
  email: string | null;
  subscriptionUrl: string;
  trafficLimitBytes: number;
  usedTrafficBytes?: number;
  activeInternalSquads?: Array<{ uuid: string; name: string }>;
}

export class RemnawaveError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = 'RemnawaveError';
  }
}

function assertConfigured(): void {
  if (!API_URL || !API_TOKEN) {
    throw new RemnawaveError('Remnawave not configured: set REMNAWAVE_API_URL and REMNAWAVE_API_TOKEN', 500);
  }
}

async function rw<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  assertConfigured();
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + API_TOKEN,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    // panel is internal+fast; fail loud rather than hang a request thread
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }

  if (!res.ok) {
    const msg = (parsed as { message?: string })?.message || res.statusText;
    throw new RemnawaveError('Remnawave ' + method + ' ' + path + ' -> ' + res.status + ': ' + msg, res.status, parsed);
  }
  // panel wraps payloads in { response: ... }
  return ((parsed as { response?: T })?.response ?? parsed) as T;
}

/** Look up a user by Remnawave UUID. Returns null on 404. */
export async function getUserByUuid(uuid: string): Promise<RwUser | null> {
  try {
    return await rw<RwUser>('GET', '/api/users/' + encodeURIComponent(uuid));
  } catch (e) {
    if (e instanceof RemnawaveError && e.status === 404) return null;
    throw e;
  }
}

/** Look up a user by Telegram id. Panel returns an array; we take the first. */
export async function getUserByTelegramId(telegramId: number): Promise<RwUser | null> {
  try {
    const list = await rw<RwUser[]>('GET', '/api/users/by-telegram-id/' + telegramId);
    return Array.isArray(list) && list.length ? list[0] : null;
  } catch (e) {
    if (e instanceof RemnawaveError && e.status === 404) return null;
    throw e;
  }
}

export interface CreateUserInput {
  /** unique, stable username in the panel. We use 'u' + local users.id. */
  username: string;
  expireAt: Date;
  telegramId?: number | null;
  email?: string | null;
  /** 0 = unlimited */
  trafficLimitBytes?: number;
  squadUuids?: string[];
  status?: RwUserStatus;
}

export async function createUser(input: CreateUserInput): Promise<RwUser> {
  return rw<RwUser>('POST', '/api/users', {
    username: input.username,
    status: input.status || 'ACTIVE',
    expireAt: input.expireAt.toISOString(),
    trafficLimitBytes: input.trafficLimitBytes ?? 0,
    trafficLimitStrategy: 'NO_RESET',
    telegramId: input.telegramId ?? undefined,
    email: input.email ?? undefined,
    activeInternalSquads: input.squadUuids && input.squadUuids.length ? input.squadUuids : (DEFAULT_SQUAD ? [DEFAULT_SQUAD] : []),
  });
}

export interface UpdateUserInput {
  uuid: string;
  expireAt?: Date;
  status?: RwUserStatus;
  telegramId?: number | null;
  email?: string | null;
  trafficLimitBytes?: number;
  squadUuids?: string[];
}

export async function updateUser(input: UpdateUserInput): Promise<RwUser> {
  const body: Record<string, unknown> = { uuid: input.uuid };
  if (input.expireAt) body.expireAt = input.expireAt.toISOString();
  if (input.status) body.status = input.status;
  if (input.telegramId !== undefined) body.telegramId = input.telegramId;
  if (input.email !== undefined) body.email = input.email;
  if (input.trafficLimitBytes !== undefined) body.trafficLimitBytes = input.trafficLimitBytes;
  if (input.squadUuids) body.activeInternalSquads = input.squadUuids;
  return rw<RwUser>('PATCH', '/api/users', body);
}

export async function disableUser(uuid: string): Promise<RwUser> {
  return updateUser({ uuid, status: 'DISABLED' });
}

export async function enableUser(uuid: string): Promise<RwUser> {
  return updateUser({ uuid, status: 'ACTIVE' });
}

export async function deleteUser(uuid: string): Promise<void> {
  await rw('DELETE', '/api/users/' + encodeURIComponent(uuid));
}

export const remnawaveConfigured = (): boolean => Boolean(API_URL && API_TOKEN);
