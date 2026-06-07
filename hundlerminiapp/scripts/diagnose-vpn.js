// Emergency diagnostic — check what's going on with VPN servers and API.

const TOKEN = 'hVpN2026sEcReT_xR4y';

const targets = [
  { name: 'API: pool stats', url: `https://hundlervpn.xyz/api/xray/pool?token=${TOKEN}` },
  { name: 'API: xray clients', url: `https://hundlervpn.xyz/api/xray/clients?token=${TOKEN}` },
  { name: 'NL VPS port 443 (VLESS)', tcp: '185.238.169.235:443' },
  { name: 'DE VPS port 443 (VLESS)', tcp: '213.182.213.183:443' },
  { name: 'YC bridge port 443', tcp: '158.160.254.104:443' },
];

const net = require('node:net');

async function probeTcp(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, msg) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ ok, msg });
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish(true, 'TCP CONNECT OK'));
    sock.on('timeout', () => finish(false, 'TCP TIMEOUT'));
    sock.on('error', (err) => finish(false, `TCP ERROR: ${err.code || err.message}`));
    sock.connect(port, host);
  });
}

async function probeHttp(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const text = await r.text();
    const trimmed = text.length > 200 ? text.slice(0, 200) + '...' : text;
    return { ok: r.ok, msg: `HTTP ${r.status} (${text.length} bytes) ${trimmed}` };
  } catch (err) {
    return { ok: false, msg: `HTTP ERROR: ${err.name}: ${err.message}` };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  for (const t of targets) {
    let result;
    if (t.url) {
      result = await probeHttp(t.url);
    } else {
      const [host, port] = t.tcp.split(':');
      result = await probeTcp(host, Number(port));
    }
    const icon = result.ok ? 'OK' : 'FAIL';
    console.log(`[${icon}] ${t.name}: ${result.msg}`);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
