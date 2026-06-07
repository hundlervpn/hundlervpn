// Poll until v52 (dedupe-user action) is live, then run it for tid 2029065770.

const TOKEN = 'hVpN2026sEcReT_xR4y';
const BASE = 'https://hundlervpn.xyz/api/xray/pool';
const TID = 2029065770;
const INTERVAL = 30_000;
const MAX_ATTEMPTS = 30;

async function main() {
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const ts = new Date().toISOString();
    console.log(`\n[${i}/${MAX_ATTEMPTS}] ${ts} — probing v52 …`);

    let r;
    try {
      r = await fetch(`${BASE}?token=${TOKEN}&action=dedupe-user&tid=${TID}`, {
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
        console.log('  v52 NOT YET DEPLOYED');
        await new Promise((res) => setTimeout(res, INTERVAL));
        continue;
      }
      console.log(`  HTTP 400: ${body}`);
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    const body = await r.json();
    console.log('  v52 LIVE — dedupe response:', JSON.stringify(body, null, 2));

    // Verify the user can still connect.
    console.log('\n  --- Verifying with diag-user ---');
    const { spawn } = await import('node:child_process');
    const path = await import('node:path');
    await new Promise((resolve) => {
      const p = spawn(process.execPath, [
        path.join(import.meta.dirname || __dirname, 'diag-user.js'),
        String(TID),
      ], { stdio: 'inherit' });
      p.on('exit', resolve);
    });

    return;
  }
  console.log('\nMax attempts reached. v52 still not live.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
