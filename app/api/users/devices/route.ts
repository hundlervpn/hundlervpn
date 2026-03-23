import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

function resolveUserParams(url: URL) {
  const telegramIdRaw = url.searchParams.get('telegramId');
  const userIdRaw = url.searchParams.get('userId');
  if (!telegramIdRaw && !userIdRaw) return null;
  const telegramId = telegramIdRaw ? Number(telegramIdRaw) : null;
  const userId = userIdRaw ? Number(userIdRaw) : null;
  if ((telegramIdRaw && !Number.isFinite(telegramId)) || (userIdRaw && !Number.isFinite(userId))) return null;
  const whereClause = telegramId ? 'u.telegram_id = $1' : 'u.id = $1';
  const param = telegramId ?? userId;
  return { whereClause, param };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const resolved = resolveUserParams(url);
    if (!resolved) {
      return NextResponse.json({ error: 'telegramId or userId is required' }, { status: 400 });
    }

    const result = await dbQuery(
      `
      SELECT
        vk.id,
        vk.device_name,
        vk.key_uri,
        vk.is_active,
        vk.created_at
      FROM vpn_keys vk
      JOIN users u ON u.id = vk.user_id
      WHERE ${resolved.whereClause}
      ORDER BY vk.created_at DESC;
      `,
      [resolved.param]
    );

    return NextResponse.json({ ok: true, devices: result.rows });
  } catch (error) {
    console.error('Devices fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const resolved = resolveUserParams(url);
    const deviceIdRaw = url.searchParams.get('deviceId');

    if (!resolved || !deviceIdRaw) {
      return NextResponse.json({ error: 'User identifier and deviceId are required' }, { status: 400 });
    }

    const deviceId = Number(deviceIdRaw);
    if (!Number.isFinite(deviceId)) {
      return NextResponse.json({ error: 'Invalid deviceId' }, { status: 400 });
    }

    const userSubquery = resolved.whereClause.includes('telegram_id')
      ? `(SELECT id FROM users WHERE telegram_id = $2 LIMIT 1)`
      : `$2::bigint`;

    const result = await dbQuery(
      `
      DELETE FROM vpn_keys
      WHERE id = $1
        AND user_id = ${userSubquery}
      RETURNING id;
      `,
      [deviceId, resolved.param]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deletedId: result.rows[0].id });
  } catch (error) {
    console.error('Device delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
