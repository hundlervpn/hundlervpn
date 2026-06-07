// Quick reachability probe for the Xray webhook listeners.
// Tests /health endpoint on each known VPN VPS port 9999.

const http = require('http');

const targets = [
  { name: 'DE (Germany exit)',      host: '213.182.213.183',  port: 9999 },
  { name: 'NL (Netherlands exit)',  host: '185.238.169.235',  port: 9999 },
  { name: 'YC (Yandex Cloud bridge)', host: '158.160.254.104', port: 9999 },
];

function probe(t) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(
      { host: t.host, port: t.port, path: '/health', timeout: 5000 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolve({ ...t, status: res.statusCode, body: body.trim().substring(0, 120), elapsed: Date.now() - started });
        });
      }
    );
    req.on('error', (err) => {
      resolve({ ...t, error: err.code || err.message, elapsed: Date.now() - started });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ...t, error: 'TIMEOUT', elapsed: Date.now() - started });
    });
  });
}

(async () => {
  for (const t of targets) {
    const r = await probe(t);
    if (r.error) {
      console.log(`  ❌ ${t.name.padEnd(30)} ${t.host}:${t.port}  ERROR=${r.error}  (${r.elapsed}ms)`);
    } else {
      console.log(`  ✅ ${t.name.padEnd(30)} ${t.host}:${t.port}  status=${r.status}  body="${r.body}"  (${r.elapsed}ms)`);
    }
  }
})();
