import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { parseSubToken, buildVlessLink, countryCodeToFlag } from '@/lib/sub-token';

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

    const result = await dbQuery<VpnKeyRow>(
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

    if (result.rows.length === 0) {
      return new Response('No active subscription', { status: 404 });
    }

    const links = result.rows
      .map((row) => buildVlessLink(row.key_hash))
      .filter(Boolean)
      .join('\n');

    if (!links) {
      return new Response('Server configuration incomplete', { status: 500 });
    }

    const encoded = Buffer.from(links).toString('base64');

    const latestExpiry = result.rows[0]?.expires_at;
    const expireTs = latestExpiry
      ? Math.floor(new Date(latestExpiry).getTime() / 1000)
      : 0;

    const country = process.env.XRAY_VLESS_COUNTRY ?? '';
    const flag = country ? countryCodeToFlag(country) : '';
    const baseRemark = process.env.XRAY_VLESS_REMARK ?? 'HundlerVPN';
    const profileTitle = flag ? `${flag} ${baseRemark}` : baseRemark;

    const headers = new Headers({
      'Content-Type': 'text/plain; charset=utf-8',
      'subscription-userinfo': `upload=0; download=0; total=0; expire=${expireTs}`,
      'profile-update-interval': '12',
      'profile-title': Buffer.from(profileTitle).toString('base64'),
      'Cache-Control': 'no-store',
    });

    return new Response(encoded, { status: 200, headers });
  } catch (error) {
    console.error('Subscription endpoint error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
