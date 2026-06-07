// Poll until v53 (audit GET param) is live, then run audit.

const TOKEN = 'hVpN2026sEcReT_xR4y';
const URL = `https://hundlervpn.xyz/api/xray/pool?token=${TOKEN}&audit=1`;
const INTERVAL = 30_000;
const MAX_ATTEMPTS = 30;

async function main() {
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const ts = new Date().toISOString();
    console.log(`\n[${i}/${MAX_ATTEMPTS}] ${ts} — probing v53 audit …`);

    let r;
    try {
      r = await fetch(URL);
    } catch (e) {
      console.log(`  fetch error: ${e.message}`);
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    const body = await r.json();
    if (!body.audit) {
      console.log('  v53 NOT YET DEPLOYED (no audit field)');
      console.log('  pool:', JSON.stringify(body));
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    console.log('  v53 LIVE — full audit:');
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  console.log('\nMax attempts reached.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
