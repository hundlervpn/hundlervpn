// Probe /api/sub/[token] from production with an iPhone/Happ UA and
// print status, X-Code-Version header, and body (first ~400 chars).
//
// Usage: node scripts/probe-sub.js [telegramId] [UA]

const { createHmac } = require('crypto');

const TELEGRAM_ID = Number(process.argv[2] || 2029065770);
const UA = process.argv[3] || 'Happ/4.7.4/ios/2604141213534';
const APP_URL = process.env.APP_URL || 'https://hundlervpn.xyz';
const SECRET = process.env.XRAY_SYNC_TOKEN || 'hVpN2026sEcReT_xR4y';

function generateSubToken(telegramId) {
  const idPart = Buffer.from(String(telegramId)).toString('base64url');
  const sig = createHmac('sha256', SECRET)
    .update(`sub:${telegramId}`)
    .digest('base64url')
    .slice(0, 12);
  return `${idPart}${sig}`;
}

async function main() {
  const token = generateSubToken(TELEGRAM_ID);
  const url = `${APP_URL}/api/sub/${token}`;
  console.log(`URL: ${url}`);
  console.log(`UA:  ${UA}`);
  console.log(`---`);

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': '*/*',
    },
  });

  console.log(`status: ${res.status}`);
  console.log(`headers:`);
  for (const [k, v] of res.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }

  const buf = await res.arrayBuffer();
  const text = Buffer.from(buf).toString('utf8');
  console.log(`---`);
  console.log(`body (${buf.byteLength} bytes, first 600):`);
  console.log(text.slice(0, 600));

  // If base64, try to decode
  if (!text.startsWith('{') && text.length < 4000) {
    try {
      const decoded = Buffer.from(text, 'base64').toString('utf8');
      if (decoded.includes('vless://') || decoded.includes('Лимит')) {
        console.log(`---`);
        console.log(`base64-decoded body:`);
        console.log(decoded);
      }
    } catch {}
  }
}

main().catch((e) => { console.error('Error:', e); process.exitCode = 1; });
