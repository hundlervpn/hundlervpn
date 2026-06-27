/**
 * Remnawave <-> local DB bridge.
 *
 * Single source of truth for keeping a local business user (users.id) in sync
 * with its Remnawave VPN identity. Call ensureRemnawaveUser() at every point
 * the user's access should change: signup, payment, renewal, expiry, ban.
 *
 * Invariants:
 *  - panel username = 'u' + users.id   (stable, unique, reversible)
 *  - expireAt       = active subscription end_date (or ~now if none/expired)
 *  - status         = ACTIVE while paid+unbanned, DISABLED otherwise
 *  - users.remnawave_uuid / remnawave_short_uuid cache the mapping
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

export interface LocalUserAccess {
  id: number;
  telegramId: number | null;
  banned: boolean;
  expiresAt: Date | null;
  trafficLimitBytes: number;
}

type AccessRow = {
  id: string | number;
  telegram_id: string | number | null;
  status: string | null;
  ban_reason: string | null;
  remnawave_uuid: string | null;
  remnawave_short_uuid: string | null;
  end_date: Date | string | null;
  sub_status: string | null;
  traffic_limit: string | number | null;
};

const ACCESS_SQL = [
  'SELECT u.id, u.telegram_id, u.status, u.ban_reason,',
  '       u.remnawave_uuid, u.remnawave_short_uuid,',
  '       s.end_date, s.status AS sub_status, p.traffic_limit',
  '  FROM users u',
  '  LEFT JOIN LATERAL (',
  '    SELECT end_date, status, plan_id',
  '      FROM subscriptions',
  '     WHERE user_id = u.id',
  '     ORDER BY end_date DESC NULLS LAST',
  '     LIMIT 1',
  '  ) s ON TRUE',
  '  LEFT JOIN plans p ON p.id = s.plan_id',
  ' WHERE u.id = $1',
].join('\n');

/** Load the access-relevant view of a local user (joins newest subscription). */
export async function loadLocalUserAccess(userId: number): Promise<LocalUserAccess | null> {
  const res = await dbQuery<AccessRow>(ACCESS_SQL, [userId]);
  const row = res.rows[0];
  if (!row) return null;

  const end = row.end_date ? new Date(row.end_date) : null;
  const subActive = row.sub_status === 'active' && end !== null && end.getTime() > Date.now();
  const banned = row.status === 'banned' || Boolean(row.ban_reason);
  const traffic = row.traffic_limit != null ? Number(row.traffic_limit) : 0;

  return {
    id: Number(row.id),
    telegramId: row.telegram_id != null ? Number(row.telegram_id) : null,
    banned,
    expiresAt: subActive ? end : null,
    trafficLimitBytes: Number.isFinite(traffic) ? traffic : 0,
  };
}

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
 * Find-or-create the Remnawave user for a local user, then reconcile
 * expiry/status/traffic to match local business state. Idempotent.
 */
export async function ensureRemnawaveUser(userId: number): Promise<EnsureResult> {
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
 * bonus, ban/unban, ...) if the Remnawave panel is momentarily unreachable.
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
      '[remnawave-sync] ensureRemnawaveUser failed for user=' + userId +
        (context ? ' (' + context + ')' : '') + ':',
      err,
    );
  }
}
