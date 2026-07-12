/**
 * Backend-agnostic view of a local user's VPN access state.
 *
 * Extracted from lib/remnawave-sync.ts so both VPN backends (Remnawave and
 * 3x-ui, selected via VPN_BACKEND) can share the same source of truth:
 * the newest subscription row + ban flags in OUR Postgres.
 */

import { dbQuery } from '@/lib/db';

/** Active VPN backend. Remnawave remains the default until cutover. */
export type VpnBackend = 'remnawave' | '3xui';

export function vpnBackend(): VpnBackend {
  return process.env.VPN_BACKEND === '3xui' ? '3xui' : 'remnawave';
}

export interface LocalUserAccess {
  id: number;
  telegramId: number | null;
  email: string | null;
  banned: boolean;
  expiresAt: Date | null;
  trafficLimitBytes: number;
}

type AccessRow = {
  id: string | number;
  telegram_id: string | number | null;
  email: string | null;
  status: string | null;
  ban_reason: string | null;
  remnawave_uuid: string | null;
  remnawave_short_uuid: string | null;
  end_date: Date | string | null;
  sub_status: string | null;
  traffic_limit: string | number | null;
};

const ACCESS_SQL = [
  'SELECT u.id, u.telegram_id, u.email, u.status, u.ban_reason,',
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
    email: row.email ?? null,
    banned,
    expiresAt: subActive ? end : null,
    trafficLimitBytes: Number.isFinite(traffic) ? traffic : 0,
  };
}
