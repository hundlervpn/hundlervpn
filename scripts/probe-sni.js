// One-off SNI probe. Connects to each server with each candidate SNI;
// Reality nodes respond with the decoy cert if SNI is in serverNames,
// and with a fallback cert (or RST) if not.
//
// We can't see the Reality magic — but we CAN see which `subject CN` the
// server returns per SNI. If it returns the same cert for every SNI we
// don't recognise (or RSTs), the SNI is unsupported by Reality.

const tls = require('node:tls');

const TARGETS = [
  { name: 'DE', host: 'de.hundlervpn.xyz', port: 443 },
  { name: 'NL', host: 'vpn.hundlervpn.xyz', port: 443 },
  { name: 'RU', host: '85.239.53.25', port: 443 },
];

const SNIS_DEFAULT = ['www.microsoft.com','www.cloudflare.com','www.apple.com','www.tiktok.com'];
const SNIS_RU      = ['www.microsoft.com','yastatic.net','storage.yandex.net','vk.com'];

function probe(host, port, sni, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = tls.connect({
      host,
      port,
      servername: sni,
      rejectUnauthorized: false,
      timeout: timeoutMs,
      ALPNProtocols: ['h2','http/1.1'],
    }, () => {
      const peer = sock.getPeerCertificate(false);
      const ms = Date.now() - start;
      resolve({ ok: true, ms, cn: peer?.subject?.CN || '?', issuer: peer?.issuer?.CN || '?' });
      try { sock.end(); } catch {}
    });
    sock.on('error', (e) => resolve({ ok: false, err: e.code || e.message }));
    sock.on('timeout', () => { try { sock.destroy(); } catch {}; resolve({ ok: false, err: 'TIMEOUT' }); });
  });
}

(async () => {
  for (const t of TARGETS) {
    console.log(`\n=== ${t.name} (${t.host}) ===`);
    const pool = t.name === 'RU' ? SNIS_RU : SNIS_DEFAULT;
    for (const sni of pool) {
      const r = await probe(t.host, t.port, sni);
      const label = r.ok ? `OK ${r.ms}ms CN="${r.cn}" issuer="${r.issuer}"` : `FAIL ${r.err}`;
      console.log(`  SNI=${sni.padEnd(22)} → ${label}`);
    }
  }
})();
