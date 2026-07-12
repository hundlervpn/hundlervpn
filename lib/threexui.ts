/**
 * 3x-ui master panel API client (VPN backend "3xui").
 *
 * Thin, dependency-free wrapper over the 3x-ui v3 REST API
 * (https://github.com/MHSanaei/3x-ui). Mirrors the role lib/remnawave.ts
 * plays for the Remnawave backend: business logic stays in our Postgres,
 * this module is the ONLY bridge to the VPN layer when VPN_BACKEND=3xui.
 *
 * Uses node:http/https directly (not fetch) so we can support a pinned
 * self-signed panel certificate via THREEXUI_TLS_PIN_SHA256 without
 * disabling TLS verification process-wide.
 *
 * Env:
 *   THREEXUI_API_URL         panel base incl. web base path, no trailing slash,
 *                            e.g. https://1.2.3.4:2053/a1b2c3
 *   THREEXUI_API_TOKEN       Bearer API token (panel: Settings -> API tokens) [SECRET]
 *   THREEXUI_INBOUND_ID      numeric id of the production VLESS-XHTTP inbound
 *   THREEXUI_TLS_PIN_SHA256  optional sha256 fingerprint (hex, no colons) of the
 *                            panel TLS cert; when set, CA verification is replaced
 *                            by exact fingerprint pinning (self-signed friendly)
 */

import { request as httpsRequest, type RequestOptions } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { TLSSocket } from 'node:tls';

const API_URL = (process.env.THREEXUI_API_URL || '').replace(/\/+$/, '');
const API_TOKEN = process.env.THREEXUI_API_TOKEN || '';
const PIN_SHA256 = (process.env.THREEXUI_TLS_PIN_SHA256 || '').replace(/:/g, '').toLowerCase();

export const THREEXUI_INBOUND_ID = Number(process.env.THREEXUI_INBOUND_ID || '0');

export class ThreeXuiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = 'ThreeXuiError';
  }
}

export const threexuiConfigured = (): boolean =>
  Boolean(API_URL && API_TOKEN && THREEXUI_INBOUND_ID > 0);

function assertConfigured(): void {
  if (!threexuiConfigured()) {
    throw new ThreeXuiError(
      '3x-ui not configured: set THREEXUI_API_URL, THREEXUI_API_TOKEN, THREEXUI_INBOUND_ID',
      500,
    );
  }
}

interface PanelResponse<T> {
  success: boolean;
  msg?: string;
  obj?: T;
}

/** Raw HTTP call to the panel. Resolves with the parsed panel envelope. */
function panelRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<PanelResponse<T>> {
  assertConfigured();
  const url = new URL(API_URL + path);
  const isHttps = url.protocol === 'https:';
  const payload = body !== undefined ? JSON.stringify(body) : undefined;

  const options: RequestOptions = {
    method,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    timeout: 15_000,
    headers: {
      Authorization: 'Bearer ' + API_TOKEN,
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  };
  if (isHttps && PIN_SHA256) {
    // Self-signed panel cert: replace CA validation with exact pinning below.
    options.rejectUnauthorized = false;
  }

  return new Promise<PanelResponse<T>>((resolve, reject) => {
    const req = (isHttps ? httpsRequest : httpRequest)(options, (res) => {
      if (isHttps && PIN_SHA256) {
        const fp = ((res.socket as TLSSocket).getPeerCertificate()?.fingerprint256 || '')
          .replace(/:/g, '')
          .toLowerCase();
        if (fp !== PIN_SHA256) {
          res.destroy();
          reject(new ThreeXuiError('3x-ui panel TLS fingerprint mismatch (got ' + fp + ')', 495));
          return;
        }
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown;
        try { parsed = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(new ThreeXuiError('3x-ui ' + method + ' ' + path + ' -> HTTP ' + status, status, parsed ?? text));
          return;
        }
        resolve((parsed ?? { success: false, msg: 'empty response' }) as PanelResponse<T>);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => reject(new ThreeXuiError('3x-ui ' + method + ' ' + path + ' failed: ' + err.message, 0)));
    if (payload) req.write(payload);
    req.end();
  });
}

async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const resp = await panelRequest<T>(method, path, body);
  if (!resp.success) {
    throw new ThreeXuiError('3x-ui ' + method + ' ' + path + ' -> ' + (resp.msg || 'unknown panel error'), 400, resp);
  }
  return resp.obj as T;
}

/** Client record as stored by the panel (subset we care about). */
export interface XuiClient {
  id: string;          // VLESS UUID (= users.remnawave_uuid)
  email: string;       // stable identifier: 'u' + users.id
  flow?: string;
  limitIp?: number;
  totalGB?: number;    // traffic cap in BYTES (panel field name is historical)
  expiryTime?: number; // unix ms; values <= now render the client inactive in xray
  enable?: boolean;
  subId?: string;
  comment?: string;
}

export interface XuiClientTraffic {
  email: string;
  up: number;
  down: number;
  total: number;
  expiryTime: number;
  enable: boolean;
}

/** Look up a client by email. Returns null when the panel has no such client. */
export async function getClientByEmail(email: string): Promise<XuiClient | null> {
  try {
    const obj = await api<{ client?: XuiClient } | XuiClient>('GET', '/panel/api/clients/get/' + encodeURIComponent(email));
    const client = (obj as { client?: XuiClient })?.client ?? (obj as XuiClient);
    return client && (client as XuiClient).email ? (client as XuiClient) : null;
  } catch (e) {
    if (e instanceof ThreeXuiError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

export interface CreateClientInput {
  uuid: string;
  email: string;
  expiryTime: number;   // unix ms
  enable: boolean;
  totalBytes?: number;  // 0 = unlimited
  limitIp?: number;     // 0 = unlimited
  tgId?: number | null;
  comment?: string;
}

export async function createClient(input: CreateClientInput): Promise<void> {
  await api('POST', '/panel/api/clients/add', {
    client: {
      id: input.uuid,
      email: input.email,
      flow: '',
      limitIp: input.limitIp ?? 0,
      totalGB: input.totalBytes ?? 0,
      expiryTime: input.expiryTime,
      enable: input.enable,
      tgId: input.tgId ?? 0,
      subId: '',
      comment: input.comment ?? '',
      reset: 0,
    },
    inboundIds: [THREEXUI_INBOUND_ID],
  });
}

/**
 * Update a client by email. The panel replaces the stored record with the
 * posted one, so we merge over the current server-side state to avoid
 * zeroing fields we do not manage here.
 */
export async function updateClient(email: string, patch: Partial<XuiClient>): Promise<void> {
  const current = await getClientByEmail(email);
  if (!current) throw new ThreeXuiError('3x-ui client not found for update: ' + email, 404);
  const merged: XuiClient = {
    id: current.id,
    email: current.email,
    flow: current.flow ?? '',
    limitIp: current.limitIp ?? 0,
    totalGB: current.totalGB ?? 0,
    expiryTime: current.expiryTime ?? 0,
    enable: current.enable ?? true,
    subId: current.subId ?? '',
    comment: current.comment ?? '',
    ...patch,
  };
  await api('POST', '/panel/api/clients/update/' + encodeURIComponent(email), merged);
}

/** Per-client traffic counters (for subscription-userinfo). Null when unknown. */
export async function getClientTraffic(email: string): Promise<XuiClientTraffic | null> {
  try {
    const obj = await api<XuiClientTraffic | XuiClientTraffic[]>('GET', '/panel/api/clients/traffic/' + encodeURIComponent(email));
    const t = Array.isArray(obj) ? obj[0] : obj;
    return t && typeof t.up === 'number' ? t : null;
  } catch {
    return null; // best-effort: headers are optional
  }
}
