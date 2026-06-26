import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

// Always fetch fresh from the DB — the UI relies on this to reflect
// server additions/removals immediately.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Public list of active VPN servers for the client UI.
 *
 * SECURITY (2026-05-12): host / port / sort_order intentionally OMITTED from
 * the public response. This endpoint is unauthenticated — leaking real entry
 * IPs (DE <DE_SERVER_IP>, NL <NL_BRIDGE_IP>, RU <RU_SERVER_IP>) gives RKN
 * scanners a free target list for VLESS+Reality endpoint fingerprinting.
 *
 * The client doesn't need host/port for anything:
 *   - VPN connection params (UUID, public_key, short_id, sni, ip, port) come
 *     via /api/sub/{token}, which is per-user gated.
 *   - The chip / picker only needs `id`, `name`, `country` to render
 *     "🇳🇱 Нидерланды | Обход Глушилок".
 *
 * The `host: 'hidden'` placeholder is returned only to keep the existing
 * Dart filter `s.host.isNotEmpty` happy (`HundlerApi.fetchServersTyped`)
 * without forcing a client-side schema migration. If the Dart filter is
 * updated to use `isActive` alone, this placeholder can be removed.
 *
 * 2026-05-15 (v62): added `protocols: string[]` per server. Lets the
 * Windows/Android/iOS clients filter the location list when the user picks
 * a protocol (VLESS / Hysteria) without leaking any keys. We DO NOT return
 * `hysteria2_password` / `hysteria2_cert_sha256` here — only the boolean
 * fact that the server has a Hy2 inbound configured. Real credentials stay
 * in the gated `/api/sub/{token}` response.
 */
export async function GET() {
  try {
    const result = await dbQuery<{
      id: number;
      name: string;
      country: string;
      is_active: boolean;
      hysteria2_port: number | null;
      hysteria2_password: string | null;
    }>(
      `
      SELECT
        s.id,
        s.name,
        s.country,
        s.is_active,
        s.hysteria2_port,
        s.hysteria2_password
      FROM servers s
      WHERE s.is_active = TRUE
        AND s.host IS NOT NULL
        AND s.host != ''
      ORDER BY s.sort_order ASC NULLS LAST, s.country ASC, s.name ASC;
      `
    );

    const sanitised = result.rows.map((s) => {
      // VLESS+Reality is the baseline — every active server speaks it
      // (the seeders enforce non-null public_key/sni/short_id). Hy2 is
      // opt-in and only present where all four hysteria2_* columns are
      // populated. Here we only need port+password to be non-null to
      // know "Hy2 is wired up"; the full credential check still lives
      // server-side in buildSingboxConfig.
      const protocols: string[] = ['vless'];
      if (s.hysteria2_port && s.hysteria2_password) {
        protocols.push('hysteria');
      }
      return {
        id: s.id,
        name: s.name,
        country: s.country,
        is_active: s.is_active,
        // Placeholder so the Dart `host.isNotEmpty` filter still passes.
        // Real host stays in `/api/sub/{token}` (gated).
        host: 'hidden',
        port: 443,
        protocols,
      };
    });

    return NextResponse.json(
      { ok: true, servers: sanitised },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    console.error('Servers fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
