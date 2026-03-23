import { dbQuery } from '@/lib/db';
import {
  parseSubToken,
  buildVlessLink,
  buildVlessLinkFromServer,
  type ServerConfig,
} from '@/lib/sub-token';

type VpnKeyRow = {
  key_hash: string;
  expires_at: string | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const telegramId = parseSubToken(token);

    if (!telegramId) {
      return new Response('Invalid subscription token', { status: 403 });
    }

    const keysResult = await dbQuery<VpnKeyRow>(
      `
      SELECT vk.key_hash, vk.expires_at
      FROM vpn_keys vk
      JOIN users u ON u.id = vk.user_id
      LEFT JOIN subscriptions s ON s.id = vk.subscription_id
      WHERE u.telegram_id = $1
        AND vk.is_active = TRUE
        AND vk.key_hash IS NOT NULL
        AND (vk.expires_at IS NULL OR vk.expires_at > NOW())
        AND (s.id IS NULL OR (s.status = 'active' AND s.end_date > NOW()))
      ORDER BY vk.created_at DESC
      LIMIT 5;
      `,
      [telegramId]
    );

    if (keysResult.rows.length === 0) {
      return new Response('No active subscription', { status: 404 });
    }

    const serversResult = await dbQuery<ServerConfig>(
      `
      SELECT name, host, port, country, public_key, sni, short_id, fingerprint, flow
      FROM servers
      WHERE is_active = TRUE
        AND public_key IS NOT NULL
        AND sni IS NOT NULL
        AND short_id IS NOT NULL
      ORDER BY country, name;
      `
    );

    const allLinks: string[] = [];

    for (const key of keysResult.rows) {
      if (serversResult.rows.length > 0) {
        for (const server of serversResult.rows) {
          allLinks.push(buildVlessLinkFromServer(key.key_hash, server));
        }
      } else {
        const envLink = buildVlessLink(key.key_hash);
        if (envLink) allLinks.push(envLink);
      }
    }

    const uniqueLinks = [...new Set(allLinks)];

    if (uniqueLinks.length === 0) {
      return new Response('Server configuration incomplete', { status: 500 });
    }

    const encoded = Buffer.from(uniqueLinks.join('\n')).toString('base64');

    const latestExpiry = keysResult.rows[0]?.expires_at;
    const expireTs = latestExpiry
      ? Math.floor(new Date(latestExpiry).getTime() / 1000)
      : 0;

    const profileTitle = 'Hundler VPN';

    const headers = new Headers({
      'Content-Type': 'text/plain; charset=utf-8',
      'subscription-userinfo': `upload=0; download=0; total=0; expire=${expireTs}`,
      'profile-update-interval': '12',
      'profile-title': profileTitle,
      'Cache-Control': 'no-store',
    });

    return new Response(encoded, { status: 200, headers });
  } catch (error) {
    console.error('Subscription endpoint error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
