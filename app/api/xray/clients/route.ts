import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

type XrayClientRow = {
  uuid: string;
  email: string;
  expiresAt: string | null;
};

type ServerRow = {
  id: number;
  flow: string;
};

async function authenticateToken(token: string): Promise<{ flow: string } | null> {
  const globalToken = process.env.XRAY_SYNC_TOKEN;
  if (globalToken && token === globalToken) {
    return { flow: process.env.XRAY_VLESS_FLOW ?? 'xtls-rprx-vision' };
  }

  const serverResult = await dbQuery<ServerRow>(
    `SELECT id, flow FROM servers WHERE sync_token = $1 AND is_active = TRUE LIMIT 1;`,
    [token]
  );

  if (serverResult.rows.length > 0) {
    return { flow: serverResult.rows[0].flow };
  }

  return null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || req.headers.get('x-xray-sync-token') || '';

    const auth = await authenticateToken(token);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await dbQuery<XrayClientRow>(
      `
      WITH ranked_keys AS (
        SELECT
          vk.key_hash AS uuid,
          CONCAT('tg-', u.telegram_id::text) AS email,
          vk.expires_at AS "expiresAt",
          ROW_NUMBER() OVER (
            PARTITION BY vk.user_id
            ORDER BY CASE WHEN vk.is_active = TRUE THEN 0 ELSE 1 END, vk.created_at DESC
          ) AS rank_index
        FROM vpn_keys vk
        JOIN users u ON u.id = vk.user_id
        LEFT JOIN subscriptions s ON s.id = vk.subscription_id
        WHERE vk.key_hash IS NOT NULL
          AND (vk.expires_at IS NULL OR vk.expires_at > NOW())
          AND (
            (s.id IS NOT NULL AND s.status = 'active' AND s.end_date > NOW())
            OR (s.id IS NULL AND vk.is_active = TRUE)
          )
      )
      SELECT uuid, email, "expiresAt"
      FROM ranked_keys
      WHERE rank_index = 1
      ORDER BY email ASC;
      `
    );

    return NextResponse.json({
      ok: true,
      clients: result.rows.map((row) => ({
        id: row.uuid,
        flow: auth.flow,
        email: row.email,
        expiryTime: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('Xray clients export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
