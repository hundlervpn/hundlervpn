// Poll Hostman deploy → run restore-active as soon as new code is live.
// Detects deploy completion by running restore-active and watching for the
// new UPSERT behaviour (it should report restored > 0 on its FIRST run on
// a broken DB; if v48 code is still live it will report 0 because DO NOTHING
// already silently skipped everything).
//
// Usage: node scripts/wait-and-restore.js [maxAttempts]

const { spawn } = require('node:child_process');
const path = require('node:path');

const TOKEN = 'hVpN2026sEcReT_xR4y';
const BASE = 'https://hundlervpn.xyz/api/xray/pool';
const MAX_ATTEMPTS = Number(process.argv[2]) || 24; // ~12 minutes at 30s
const INTERVAL_MS = 30_000;

function runDiag(tid) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'diag-user.js'), String(tid)], {
      stdio: 'inherit',
    });
    p.on('exit', (code) => resolve(code === 0));
  });
}

async function main() {
  console.log(`Polling deploy every ${INTERVAL_MS / 1000}s, up to ${MAX_ATTEMPTS} attempts.`);
  console.log('Will run restore-active each cycle and check if affected user UUID lands in Xray snapshot.\n');

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    console.log(`\n[attempt ${i}/${MAX_ATTEMPTS}] ${new Date().toISOString()}`);

    let res;
    try {
      const r = await fetch(`${BASE}?token=${TOKEN}&action=restore-active`, { method: 'POST' });
      res = await r.json();
    } catch (e) {
      console.log(`  fetch failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
      continue;
    }

    console.log(`  restore-active: restored=${res.restored} total=${res.total} assigned=${res.assigned}`);

    // Run diag to confirm the test user's UUID is now in snapshot.
    console.log('  --- diag-user 2029065770 ---');
    await runDiag(2029065770);

    // Stop if everything is consistent.
    // Heuristic: if restore-active reports 0 changes AND diag passes, we're done.
    // The diag prints ✅ in match section — we trust visual output.
    if (i === MAX_ATTEMPTS) {
      console.log('\nMax attempts reached. Manually verify above.');
      break;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
