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
