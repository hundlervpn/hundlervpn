import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramIdRaw = url.searchParams.get('telegramId');

    if (!telegramIdRaw) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }

    const telegramId = Number(telegramIdRaw);
    if (!Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is invalid' }, { status: 400 });
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
      WHERE u.telegram_id = $1
      ORDER BY vk.created_at DESC;
      `,
      [telegramId]
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
    const telegramIdRaw = url.searchParams.get('telegramId');
    const deviceIdRaw = url.searchParams.get('deviceId');

    if (!telegramIdRaw || !deviceIdRaw) {
      return NextResponse.json({ error: 'telegramId and deviceId are required' }, { status: 400 });
    }

    const telegramId = Number(telegramIdRaw);
    const deviceId = Number(deviceIdRaw);
    if (!Number.isFinite(telegramId) || !Number.isFinite(deviceId)) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    const result = await dbQuery(
      `
      DELETE FROM vpn_keys
      WHERE id = $1
        AND user_id = (SELECT id FROM users WHERE telegram_id = $2 LIMIT 1)
      RETURNING id;
      `,
      [deviceId, telegramId]
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
