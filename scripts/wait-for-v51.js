// Poll until v51 (force-restore-user action) is live, then run it.

const TOKEN = 'hVpN2026sEcReT_xR4y';
const BASE = 'https://hundlervpn.xyz/api/xray/pool';
const TID = 2029065770;
const INTERVAL = 30_000;
const MAX_ATTEMPTS = 30;

async function main() {
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const ts = new Date().toISOString();
    console.log(`\n[${i}/${MAX_ATTEMPTS}] ${ts} — probing v51 …`);

    let r;
    try {
      r = await fetch(`${BASE}?token=${TOKEN}&action=force-restore-user&tid=${TID}`, {
        method: 'POST',
      });
    } catch (e) {
      console.log(`  fetch error: ${e.message}`);
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    if (r.status === 400) {
      const body = await r.text();
      if (body.includes('unknown action')) {
        console.log('  v51 NOT YET DEPLOYED (400 unknown action)');
        await new Promise((res) => setTimeout(res, INTERVAL));
        continue;
      }
      console.log(`  HTTP 400: ${body}`);
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    const body = await r.json();
    console.log('  v51 IS LIVE — response:', JSON.stringify(body, null, 2));

    // Now run bulk fix as well.
    console.log('\n  --- Running force-restore-all to repair every active subscriber ---');
    const bulkRes = await fetch(`${BASE}?token=${TOKEN}&action=force-restore-all`, {
      method: 'POST',
    });
    const bulk = await bulkRes.json();
    console.log('  bulk:', JSON.stringify(bulk, null, 2));

    console.log('\n✅ Done. Webhook fired — NL+DE Xray restarting now.');
    console.log('Affected users (including', TID, ') should reconnect within ~5 sec.');
    return;
  }
  console.log('\nMax attempts reached. v51 still not live. Investigate Hostman manually.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
