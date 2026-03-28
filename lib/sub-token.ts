import { createHmac } from 'crypto';

export function generateSubToken(telegramId: number): string {
  const secret = process.env.XRAY_SYNC_TOKEN ?? '';
  const idPart = Buffer.from(String(telegramId)).toString('base64url');
  const sig = createHmac('sha256', secret)
    .update(`sub:${telegramId}`)
    .digest('base64url')
    .slice(0, 12);
  return `${idPart}${sig}`;
}

export function parseSubToken(token: string): number | null {
  const secret = process.env.XRAY_SYNC_TOKEN ?? '';
  if (!secret || token.length < 13) return null;

  const sig = token.slice(-12);
  const idPart = token.slice(0, -12);

  let telegramIdStr: string;
  try {
    telegramIdStr = Buffer.from(idPart, 'base64url').toString();
  } catch {
    return null;
  }

  const num = Number(telegramIdStr);
  if (!Number.isFinite(num) || num <= 0) return null;

  const expectedSig = createHmac('sha256', secret)
    .update(`sub:${num}`)
    .digest('base64url')
    .slice(0, 12);

  if (sig !== expectedSig) return null;
  return num;
}

export function countryCodeToFlag(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return '';
  const base = 0x1f1e6;
  return (
    String.fromCodePoint(base + upper.charCodeAt(0) - 65) +
    String.fromCodePoint(base + upper.charCodeAt(1) - 65)
  );
}

export type ServerConfig = {
  name: string;
  host: string;
  port: number;
  country: string;
  public_key: string;
  sni: string;
  short_id: string;
  fingerprint: string;
  flow: string;
};

function normalizeRemarkName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Hundler VPN';

  const compact = trimmed.replace(/\s+/g, '').toLowerCase();
  if (compact === 'hundlervpn') {
    return 'Hundler VPN';
  }

  return trimmed;
}

export function buildVlessLinkFromServer(uuid: string, server: ServerConfig): string {
  const displayName = normalizeRemarkName(server.name);
  const flag = server.country ? countryCodeToFlag(server.country) : '';
  const remark = flag ? `${flag} ${displayName}` : displayName;

  const query = new URLSearchParams({
    encryption: 'none',
    security: 'reality',
    type: 'tcp',
    sni: server.sni,
    fp: server.fingerprint,
    pbk: server.public_key,
    sid: server.short_id,
    flow: server.flow,
  });

  return `vless://${uuid}@${server.host}:${server.port}?${query.toString()}#${encodeURIComponent(remark)}`;
}

export function buildVlessLink(uuid: string): string | null {
  const host = process.env.XRAY_VLESS_HOST;
  const port = process.env.XRAY_VLESS_PORT ?? '443';
  const publicKey = process.env.XRAY_REALITY_PUBLIC_KEY;
  const serverName = process.env.XRAY_REALITY_SNI;
  const shortId = process.env.XRAY_REALITY_SHORT_ID;
  const fingerprint = process.env.XRAY_REALITY_FINGERPRINT ?? 'chrome';
  const flow = process.env.XRAY_VLESS_FLOW ?? 'xtls-rprx-vision';
  const country = process.env.XRAY_VLESS_COUNTRY ?? '';
  const flag = country ? countryCodeToFlag(country) : '';
  const baseRemark = normalizeRemarkName(process.env.XRAY_VLESS_REMARK ?? 'Hundler VPN');
  const remark = flag ? `${flag} ${baseRemark}` : baseRemark;

  if (!host || !publicKey || !serverName || !shortId) {
    return null;
  }

  const query = new URLSearchParams({
    encryption: 'none',
    security: 'reality',
    type: 'tcp',
    sni: serverName,
    fp: fingerprint,
    pbk: publicKey,
    sid: shortId,
    flow,
  });

  return `vless://${uuid}@${host}:${port}?${query.toString()}#${encodeURIComponent(remark)}`;
}

export function getSubscriptionUrl(telegramId: number): string | null {
  const appUrl = process.env.APP_URL;
  const secret = process.env.XRAY_SYNC_TOKEN;
  if (!appUrl || !secret) return null;
  const token = generateSubToken(telegramId);
  return `${appUrl}/api/sub/${token}`;
}

export async function getInstallCode(): Promise<string | null> {
  const providerCode = process.env.HAPP_PROVIDER_CODE;
  const authKey = process.env.HAPP_AUTH_KEY;
  const installLimit = process.env.HAPP_INSTALL_LIMIT || '3';
  
  if (!providerCode || !authKey) {
    return null;
  }
  
  try {
    const url = `https://api.happ-proxy.com/api/add-install?provider_code=${encodeURIComponent(providerCode)}&auth_key=${encodeURIComponent(authKey)}&install_limit=${installLimit}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Happ install API error:', res.status);
      return null;
    }
    const data = await res.json();
    if (data.rc === 1 && data.install_code) {
      return data.install_code;
    }
    console.error('Happ install API error:', data.msg);
    return null;
  } catch (err) {
    console.error('Happ install code error:', err);
    return null;
  }
}

export async function getSubscriptionUrlWithLimit(telegramId: number): Promise<string | null> {
  const baseUrl = getSubscriptionUrl(telegramId);
  if (!baseUrl) return null;
  
  const installCode = await getInstallCode();
  if (installCode) {
    // Add InstallID as URL fragment parameter
    return `${baseUrl}#Hundler_VPN?installid=${installCode}`;
  }
  
  return baseUrl;
}

export async function encryptSubscriptionUrl(url: string): Promise<string> {
  try {
    const res = await fetch('https://crypto.happ.su/api-v2.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      console.error('Happ encryption API error:', res.status, res.statusText);
      return url;
    }
    const text = await res.text();
    const trimmed = text.trim();
    console.log('Happ encryption response:', trimmed.slice(0, 100));
    if (trimmed && (trimmed.startsWith('happ://crypt4/') || trimmed.startsWith('happ://crypt5/'))) {
      return trimmed;
    }
    // Try parsing as JSON in case API returns JSON
    try {
      const json = JSON.parse(trimmed);
      if (json.url && (json.url.startsWith('happ://crypt4/') || json.url.startsWith('happ://crypt5/'))) {
        return json.url;
      }
      if (json.encrypted && (json.encrypted.startsWith('happ://crypt4/') || json.encrypted.startsWith('happ://crypt5/'))) {
        return json.encrypted;
      }
    } catch { /* not JSON */ }
    return url;
  } catch (err) {
    console.error('Happ encryption error:', err);
    return url;
  }
}
