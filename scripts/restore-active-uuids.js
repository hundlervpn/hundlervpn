// Emergency recovery (v48):
// For every active vpn_key whose UUID is missing from uuid_pool (because
// past GC runs deleted/rotated it), re-insert a pool row with that exact
// UUID so the user's existing VLESS configs reconnect WITHOUT needing
// a re-import.
//
// Run: node scripts/restore-active-uuids.js

const TOKEN = 'hVpN2026sEcReT_xR4y';
const BASE = 'https://hundlervpn.xyz/api/xray/pool';

async function main() {
  console.log('=== Pool stats BEFORE ===');
  const before = await fetch(`${BASE}?token=${TOKEN}`).then((r) => r.json());
  console.log(JSON.stringify(before, null, 2));

  console.log('\n=== Running restore-active ===');
  const res = await fetch(`${BASE}?token=${TOKEN}&action=restore-active`, {
    method: 'POST',
  }).then((r) => r.json());
  console.log(JSON.stringify(res, null, 2));

  console.log('\n=== Pool stats AFTER ===');
  const after = await fetch(`${BASE}?token=${TOKEN}`).then((r) => r.json());
  console.log(JSON.stringify(after, null, 2));

  if (res.error) {
    console.log('\n\u274c FAILED — endpoint may not be deployed yet (wait ~3 min for Hostman).');
    process.exit(1);
  }

  console.log(
    `\n\u2705 Restored ${res.restored ?? 0} pool rows. Webhook fired \u2014 NL+DE Xray restarting now.`,
  );
  console.log(
    'Affected users with cached VLESS configs should reconnect within ~5 seconds.',
  );
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
