// One-shot cleanup: invalidate all "ghost" UUIDs left over from the
// pre-v47 soft-kick era. Run ONCE after deploying v47.
//
// Usage:  node scripts/purge-legacy-uuids.js
//
// Prints the pool stats before, runs purge-free, prints stats after.

const TOKEN = 'hVpN2026sEcReT_xR4y';
const BASE = 'https://hundlervpn.xyz/api/xray/pool';

async function main() {
  console.log('=== Pool stats BEFORE ===');
  const before = await fetch(`${BASE}?token=${TOKEN}`).then((r) => r.json());
  console.log(JSON.stringify(before, null, 2));

  // Try the new name first; fall back to the older 'rotate-free' if the
  // deploy of f781c61 hasn't propagated to Timeweb yet.
  console.log('\n=== Running purge ===');
  let purge = await fetch(`${BASE}?token=${TOKEN}&action=purge-free`, {
    method: 'POST',
  }).then((r) => r.json());
  if (purge && purge.error && /unknown action/i.test(purge.error)) {
    console.log('purge-free not deployed yet, falling back to rotate-free');
    purge = await fetch(`${BASE}?token=${TOKEN}&action=rotate-free`, {
      method: 'POST',
    }).then((r) => r.json());
  }
  console.log(JSON.stringify(purge, null, 2));

  console.log('\n=== Pool stats AFTER ===');
  const after = await fetch(`${BASE}?token=${TOKEN}`).then((r) => r.json());
  console.log(JSON.stringify(after, null, 2));

  console.log(
    `\nDone. Removed ${purge.purged ?? 0} legacy UUIDs. Webhook fired \u2014 NL+DE Xray restarting now.`,
  );
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
