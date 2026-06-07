/**
 * Native-return URL whitelist for OAuth callback flows.
 *
 * Native clients (Android / iOS / Windows / macOS) pass `nativeReturn` to
 * `/api/auth/{google,telegram}/start`. After the OAuth provider posts back
 * to our `/api/auth/{...}/callback`, we mint a session token and bounce
 * the user's browser to `${nativeReturn}?token=<sessionToken>` so the
 * native client can capture it.
 *
 * The token IS the session credential — a malicious nativeReturn would let
 * an attacker exfiltrate it. So we strictly whitelist schemes/hosts here.
 *
 * Allowed targets:
 *
 *   1. `hundler://...` / `hundlervpn://...`
 *      Custom URL schemes registered by our Android (manifest), iOS
 *      (Info.plist), Windows (`protocol_handler.register('hundler')`)
 *      apps. Mobile uses these via `flutter_web_auth_2` /
 *      `ASWebAuthenticationSession` which gives proper single-instance
 *      forwarding.
 *
 *   2. `http://127.0.0.1:<port>/...` and `http://localhost:<port>/...`
 *      Windows desktop fallback: the Flutter client spins up a temporary
 *      `HttpServer.bind(loopbackIPv4, 0)` and uses its address as
 *      `nativeReturn`. We accept BOTH the IP literal and `localhost`
 *      because Hostman's Caddy reverse proxy (Via: 1.1 Caddy) rewrites
 *      `127.0.0.1` to `localhost` in query parameters — observed
 *      empirically (production debug 2026-05-14). Without `localhost`
 *      in the whitelist the OAuth-start endpoint always rejects.
 *
 *      Security trade-off accepted:
 *        - **port 1024..65535** — reserves the standard ephemeral range.
 *        - On 99.9% of machines /etc/hosts contains `127.0.0.1 localhost`
 *          (Windows defaults to this too), so `localhost` resolves to the
 *          loopback interface. Browser → loopback traffic never leaves
 *          the device.
 *        - DNS rebinding theoretical risk: a corporate DNS could resolve
 *          `localhost` to an external host. Mitigated by the fact that
 *          our Flutter client only binds on `loopbackIPv4`, so even if
 *          the browser hits a remote IP it gets ECONNREFUSED — token
 *          never leaves the user's machine.
 *
 *      We do NOT accept `https://(127.0.0.1|localhost)` — bind on
 *      loopback doesn't need TLS, and self-signed certs would just
 *      create a TLS warning in the browser.
 */

const LOOPBACK_PORT_RE =
  /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{1,5})(?:\/[^\s]*)?$/i;

/**
 * Checks if `url` is allowed as nativeReturn target.
 * Trim/encoding is the caller's responsibility — pass raw query param.
 */
export function isAllowedNativeReturn(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();

  if (lower.startsWith('hundler://') || lower.startsWith('hundlervpn://')) {
    return true;
  }

  const m = LOOPBACK_PORT_RE.exec(lower);
  if (!m) return false;
  const port = parseInt(m[1], 10);
  return port >= 1024 && port <= 65535;
}
