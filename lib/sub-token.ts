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

export function buildVlessLinkFromServer(uuid: string, server: ServerConfig): string {
  const flag = server.country ? countryCodeToFlag(server.country) : '';
  const remark = flag ? `${flag} ${server.name}` : server.name;

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
  const baseRemark = process.env.XRAY_VLESS_REMARK ?? 'HundlerVPN';
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
  if (!appUrl) return null;
  const token = generateSubToken(telegramId);
  return `${appUrl}/api/sub/${token}`;
}
