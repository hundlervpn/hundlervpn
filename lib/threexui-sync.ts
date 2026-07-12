/**
 * 3x-ui <-> local DB bridge (VPN_BACKEND=3xui).
 *
 * Mirrors lib/remnawave-sync.ts semantics 1-to-1 so the rest of the app can
 * stay backend-agnostic:
 *  - panel client email = 'u' + users.id           (stable, unique, reversible)
 *  - client id (VLESS UUID) = users.remnawave_uuid (REUSED from Remnawave so
 *    every key users already saved keeps working; generated for new users)
 *  - expiryTime = active subscription end_date, or 1ms epoch when unpaid
 *    (an in-the-past expiry keeps the client row but removes it from xray —
 *    the 3x-ui equivalent of Remnawave's DISABLED/EXPIRED)
 *  - enable = NOT banned
 */

import { dbQuery } from '@/lib/db';
import { randomUUID } from 'crypto';
import { loadLocalUserAccess, type LocalUserAccess } from '@/lib/vpn-access';
import {
  createClient,
  updateClient,
  getClientByEmail,
  threexuiConfigured,
} from '@/lib/threexui';

export interface Ensure3xuiResult {
  uuid: string;
  email: string;
  created: boolean;
  /** ACTIVE / DISABLED — same vocabulary the Remnawave path uses. */
  status: 'ACTIVE' | 'DISABLED';
  expireAt: Date;
}

export function clientEmailFor(userId: number): string {
  return 'u' + userId;
}

function desiredExpiryMs(access: LocalUserAccess): number {
  if (access.expiresAt && access.expiresAt.getTime() > Date.now()) {
    return access.expiresAt.getTime();
  }
  return 1; // epoch+1ms => inactive in xray, client row preserved
}

const PERSIST_SQL = [
  'UPDATE users',
  '   SET remnawave_uuid = $2,',
  '       remnawave_synced_at = NOW()',
  ' WHERE id = $1',
].join('\n');

/**
 * Find-or-create the 3x-ui client for a local user, then reconcile
 * expiry/enable/traffic to match local business state. Idempotent.
 */
export async function ensure3xuiClient(userId: number): Promise<Ensure3xuiResult> {
  if (!threexuiConfigured()) {
    throw new Error('3x-ui is not configured (THREEXUI_API_URL / THREEXUI_API_TOKEN / THREEXUI_INBOUND_ID missing)');
  }
  const access = await loadLocalUserAccess(userId);
  if (!access) throw new Error('Local user ' + userId + ' not found');

  const email = clientEmailFor(access.id);
  const expiryTime = desiredExpiryMs(access);
  const enable = !access.banned;

  const cached = await dbQuery<{ remnawave_uuid: string | null }>(
    'SELECT remnawave_uuid FROM users WHERE id = $1', [userId],
  );
  const cachedUuid = cached.rows[0]?.remnawave_uuid || null;

  const existing = await getClientByEmail(email);
  let uuid: string;
  let created = false;

  if (existing) {
    // Panel state wins for the UUID (it is what live clients connect with).
    uuid = existing.id || cachedUuid || randomUUID();
    const dirty =
      existing.expiryTime !== expiryTime ||
      existing.enable !== enable ||
      (existing.totalGB ?? 0) !== access.trafficLimitBytes;
    if (dirty) {
      await updateClient(email, {
        expiryTime,
        enable,
        totalGB: access.trafficLimitBytes,
      });
    }
  } else {
    uuid = cachedUuid || randomUUID();
    await createClient({
      uuid,
      email,
      expiryTime,
      enable,
      totalBytes: access.trafficLimitBytes,
      tgId: access.telegramId,
      comment: 'auto-provisioned',
    });
    created = true;
  }

  // Persist only well-formed UUIDs — protects users.remnawave_uuid (uuid
  // column) from ever caching a malformed panel value.
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  if (looksLikeUuid && uuid !== cachedUuid) {
    await dbQuery(PERSIST_SQL, [access.id, uuid]);
  }

  const active = enable && expiryTime > Date.now();
  return {
    uuid,
    email,
    created,
    status: active ? 'ACTIVE' : 'DISABLED',
    expireAt: new Date(expiryTime),
  };
}
