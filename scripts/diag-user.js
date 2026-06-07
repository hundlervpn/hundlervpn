// Per-user VPN diagnostic.
// Usage: node scripts/diag-user.js <telegram_id>
//
// Generates the user's subscription token, fetches their VLESS configs,
// extracts UUIDs, and verifies each UUID is currently in /api/xray/clients
// (i.e. will be accepted by Xray after the next sync).

const { createHmac } = require('node:crypto');

const TOKEN = 'hVpN2026sEcReT_xR4y';
const BASE = 'https://hundlervpn.xyz';

function generateSubToken(telegramId) {
  const idPart = Buffer.from(String(telegramId)).toString('base64url');
  const sig = createHmac('sha256', TOKEN)
    .update(`sub:${telegramId}`)
    .digest('base64url')
    .slice(0, 12);
  return `${idPart}${sig}`;
}

async function main() {
  const tid = Number(process.argv[2]);
  if (!Number.isFinite(tid) || tid <= 0) {
    console.error('Usage: node scripts/diag-user.js <telegram_id>');
    process.exit(1);
  }

  const subToken = generateSubToken(tid);
  console.log(`telegram_id: ${tid}`);
  console.log(`sub URL:     ${BASE}/api/sub/${subToken}`);

  console.log('\n=== Fetching subscription ===');
  // Use plain User-Agent to get the v2ray base64-encoded VLESS list.
  const subRes = await fetch(`${BASE}/api/sub/${subToken}`, {
    headers: { 'User-Agent': 'v2rayN' },
  });
  const subBody = await subRes.text();
  console.log(`HTTP ${subRes.status} (${subBody.length} bytes)`);

  if (!subRes.ok) {
    console.log(`Body: ${subBody.slice(0, 400)}`);
    process.exit(1);
  }

  // v2ray subs are base64 of newline-separated vless:// URIs
  let decoded = '';
  try {
    decoded = Buffer.from(subBody, 'base64').toString('utf-8');
  } catch {
    decoded = subBody;
  }
  const vlessLines = decoded.split(/\r?\n/).filter((l) => l.startsWith('vless://'));
  console.log(`Found ${vlessLines.length} vless:// entries`);

  const uuids = vlessLines
    .map((l) => l.match(/vless:\/\/([0-9a-f-]{36})@/i)?.[1])
    .filter(Boolean);
  console.log('UUIDs in subscription:', uuids);

  console.log('\n=== Fetching xray client snapshot ===');
  const cliRes = await fetch(`${BASE}/api/xray/clients?token=${TOKEN}`);
  const cliBody = await cliRes.json();
  console.log(`HTTP ${cliRes.status}, total clients: ${cliBody.clients?.length ?? 'n/a'}`);

  const allUuids = new Set((cliBody.clients ?? []).map((c) => c.id));
  const allEmails = new Map((cliBody.clients ?? []).map((c) => [c.id, c.email]));

  console.log('\n=== UUID match check ===');
  for (const u of uuids) {
    if (allUuids.has(u)) {
      console.log(`✅ ${u} — in Xray snapshot, label: ${allEmails.get(u)}`);
    } else {
      console.log(`❌ ${u} — MISSING from Xray snapshot`);
    }
  }

  console.log('\n=== Summary ===');
  if (uuids.length === 0) {
    console.log('User has NO active vpn_keys. Subscription is empty.');
  } else if (uuids.every((u) => allUuids.has(u))) {
    console.log('All user UUIDs are in Xray snapshot.');
    console.log('If client still shows N/A:');
    console.log('  1. Wait 30s — VPS may not have synced yet');
    console.log('  2. Re-import the subscription URL in client');
    console.log('  3. Check client trace/log for actual error');
  } else {
    console.log('Some UUIDs are missing — sub returned UUIDs that are NOT in clients API.');
    console.log('This suggests a SQL filtering issue or DB inconsistency.');
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
