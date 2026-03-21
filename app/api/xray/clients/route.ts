import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

type XrayClientRow = {
  uuid: string;
  email: string;
  expiresAt: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || req.headers.get('x-xray-sync-token') || '';

    const expectedToken = process.env.XRAY_SYNC_TOKEN;
    if (!expectedToken || token !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await dbQuery<XrayClientRow>(
      `
      SELECT
        vk.key_hash AS uuid,
        CONCAT('tg-', u.telegram_id::text) AS email,
        vk.expires_at AS "expiresAt"
      FROM vpn_keys vk
      JOIN users u ON u.id = vk.user_id
      LEFT JOIN subscriptions s ON s.id = vk.subscription_id
      WHERE vk.is_active = TRUE
        AND vk.key_hash IS NOT NULL
        AND (vk.expires_at IS NULL OR vk.expires_at > NOW())
        AND (s.id IS NULL OR (s.status = 'active' AND s.end_date > NOW()))
      ORDER BY vk.created_at DESC;
      `
    );

    return NextResponse.json({
      ok: true,
      clients: result.rows.map((row) => ({
        id: row.uuid,
        flow: process.env.XRAY_VLESS_FLOW ?? 'xtls-rprx-vision',
        email: row.email,
        expiryTime: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('Xray clients export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
