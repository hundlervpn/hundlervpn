/**
 * VPN backend <-> local DB bridge.
 *
 * Single source of truth for keeping a local business user (users.id) in sync
 * with its VPN identity. Call ensureRemnawaveUser() at every point the user's
 * access should change: signup, payment, renewal, expiry, ban.
 *
 * VPN_BACKEND (env) selects the panel implementation:
 *  - 'remnawave' (default) — original behaviour, untouched (instant rollback)
 *  - '3xui'                — delegates to lib/threexui-sync.ts, same semantics
 *
 * Function names keep the historical `Remnawave` prefix so the ~11 call sites
 * stay unchanged; the EnsureResult shape is preserved for both backends.
 *
 * Invariants (both backends):
 *  - panel identity derives from users.id (stable, unique, reversible)
 *  - expireAt = active subscription end_date (or ~now if none/expired)
 *  - ACTIVE while paid+unbanned, DISABLED otherwise
 *  - users.remnawave_uuid caches the VLESS UUID (reused across backends so
 *    saved client configs keep working)
 */

import { dbQuery } from '@/lib/db';
import {
  createUser,
  updateUser,
  getUserByUuid,
  getUserByTelegramId,
  remnawaveConfigured,
  type RwUser,
  type RwUserStatus,
} from '@/lib/remnawave';
import { vpnBackend, loadLocalUserAccess, type LocalUserAccess } from '@/lib/vpn-access';
import { ensure3xuiClient } from '@/lib/threexui-sync';
import { getSubscriptionUrlForUser } from '@/lib/sub-token';

export { loadLocalUserAccess, type LocalUserAccess } from '@/lib/vpn-access';

function desiredStatus(access: LocalUserAccess): RwUserStatus {
  if (access.banned) return 'DISABLED';
  if (!access.expiresAt || access.expiresAt.getTime() <= Date.now()) return 'DISABLED';
  return 'ACTIVE';
}

const PERSIST_SQL = [
  'UPDATE users',
  '   SET remnawave_uuid = $2,',
  '       remnawave_short_uuid = $3,',
  '       remnawave_synced_at = NOW()',
  ' WHERE id = $1',
].join('\n');

async function persistMapping(localId: number, rw: RwUser): Promise<void> {
  await dbQuery(PERSIST_SQL, [localId, rw.uuid, rw.shortUuid]);
}

export interface EnsureResult {
  rwUser: RwUser;
  created: boolean;
  subscriptionUrl: string;
  shortUuid: string;
}

/**
 * Find-or-create the panel user for a local user, then reconcile
 * expiry/status/traffic to match local business state. Idempotent.
 * Dispatches on VPN_BACKEND.
 */
export async function ensureRemnawaveUser(userId: number): Promise<EnsureResult> {
  if (vpnBackend() === '3xui') return ensureVia3xui(userId);
  return ensureViaRemnawave(userId);
}

/** 3x-ui path: same semantics, EnsureResult synthesized for compatibility. */
async function ensureVia3xui(userId: number): Promise<EnsureResult> {
  const ensured = await ensure3xuiClient(userId);
  const access = await loadLocalUserAccess(userId);
  const subscriptionUrl = getSubscriptionUrlForUser(userId) || '';
  const rwUser: RwUser = {
    uuid: ensured.uuid,
    shortUuid: '',
    username: ensured.email,
    status: ensured.status,
    expireAt: ensured.expireAt.toISOString(),
    telegramId: access?.telegramId ?? null,
    email: access?.email ?? null,
    subscriptionUrl,
    trafficLimitBytes: access?.trafficLimitBytes ?? 0,
  };
  return { rwUser, created: ensured.created, subscriptionUrl, shortUuid: '' };
}

/** Original Remnawave path — unchanged. */
async function ensureViaRemnawave(userId: number): Promise<EnsureResult> {
  if (!remnawaveConfigured()) {
    throw new Error('Remnawave is not configured (REMNAWAVE_API_URL / REMNAWAVE_API_TOKEN missing)');
  }
  const access = await loadLocalUserAccess(userId);
  if (!access) throw new Error('Local user ' + userId + ' not found');

  const username = 'u' + String(access.id).padStart(4, '0'); // Remnawave requires username length >= 3
  const expireAt = access.expiresAt && access.expiresAt.getTime() > Date.now()
    ? access.expiresAt
    : new Date(Date.now() + 60_000); // just-future -> panel marks EXPIRED -> DISABLED
  const status = desiredStatus(access);

  // resolve existing mapping: cached uuid -> by-uuid -> by-telegram-id
  const cached = await dbQuery<{ remnawave_uuid: string | null }>(
    'SELECT remnawave_uuid FROM users WHERE id = $1', [userId],
  );
  let rwUser: RwUser | null = null;
  const cachedUuid = cached.rows[0]?.remnawave_uuid || null;
  if (cachedUuid) rwUser = await getUserByUuid(cachedUuid);
  if (!rwUser && access.telegramId != null) rwUser = await getUserByTelegramId(access.telegramId);

  let created = false;
  if (!rwUser) {
    rwUser = await createUser({
      username,
      expireAt,
      telegramId: access.telegramId,
      email: access.email,
      trafficLimitBytes: access.trafficLimitBytes,
      status,
    });
    created = true;
  } else {
    rwUser = await updateUser({
      uuid: rwUser.uuid,
      expireAt,
      status,
      telegramId: access.telegramId,
      email: access.email,
      trafficLimitBytes: access.trafficLimitBytes,
    });
  }

  await persistMapping(access.id, rwUser);
  return { rwUser, created, subscriptionUrl: rwUser.subscriptionUrl, shortUuid: rwUser.shortUuid };
}

/** Convenience: get the public subscription URL, provisioning if needed. */
export async function getRemnawaveSubscriptionUrl(userId: number): Promise<string> {
  const { subscriptionUrl } = await ensureRemnawaveUser(userId);
  return subscriptionUrl;
}

/**
 * Best-effort wrapper around ensureRemnawaveUser() for call sites that must
 * not fail their primary operation (payment, promo, box reward, referral
 * bonus, ban/unban, ...) if the VPN panel is momentarily unreachable.
 *
 * MUST be called AFTER the local DB transaction has COMMITed: ensureRemnawaveUser
 * reconciles on its own connection and needs to see the persisted access state.
 */
export async function syncRemnawaveUser(
  userId: number,
  context?: string,
): Promise<void> {
  try {
    await ensureRemnawaveUser(userId);
  } catch (err) {
    console.error(
      '[vpn-sync:' + vpnBackend() + '] ensure failed for user=' + userId +
        (context ? ' (' + context + ')' : '') + ':',
      err,
    );
  }
}
