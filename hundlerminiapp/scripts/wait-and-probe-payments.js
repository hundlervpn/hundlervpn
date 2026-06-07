// Poll until v2 (with ?probe=1) is live, then list all pending payments
// with their canonical Platega status. Identifies which payments are
// actually CONFIRMED on Platega's side and need recovery.

const TOKEN = 'hVpN2026sEcReT_xR4y';
const BASE = 'https://hundlervpn.xyz/api/admin/payments/recover';
const INTERVAL = 30_000;
const MAX_ATTEMPTS = 30;

async function main() {
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const ts = new Date().toISOString();
    console.log(`\n[${i}/${MAX_ATTEMPTS}] ${ts} — probing …`);

    let r;
    try {
      r = await fetch(`${BASE}?token=${TOKEN}&pending=1&probe=1`);
    } catch (e) {
      console.log(`  fetch error: ${e.message}`);
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    if (!r.ok) {
      console.log(`  HTTP ${r.status}`);
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    const body = await r.json();
    if (!body.payments || !body.payments[0] || body.payments[0].platega_status === undefined) {
      console.log('  v2 NOT YET DEPLOYED (no platega_status field)');
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    console.log(`\n  v2 LIVE — ${body.count} pending payments\n`);

    const groups = {
      CONFIRMED: [],
      PENDING: [],
      CANCELED: [],
      CHARGEBACKED: [],
      OTHER: [],
    };
    for (const p of body.payments) {
      const k = ['CONFIRMED', 'PENDING', 'CANCELED', 'CHARGEBACKED'].includes(p.platega_status)
        ? p.platega_status
        : 'OTHER';
      groups[k].push(p);
    }

    for (const [status, list] of Object.entries(groups)) {
      if (list.length === 0) continue;
      console.log(`  === ${status} (${list.length}) ===`);
      for (const p of list) {
        console.log(`    payment_id=${p.id}  ${p.amount}₽  user=${p.first_name || p.username || '?'} (id=${p.user_id}, tg=${p.telegram_id ?? 'none'})  ext=${p.external_payment_id || 'null'}  days=${p.metadata?.days || '?'}  created=${p.created_at}`);
      }
      console.log();
    }

    console.log('=== ACTIONABLE ===');
    if (groups.CONFIRMED.length === 0) {
      console.log('  No CONFIRMED-but-stuck payments. All clear.');
    } else {
      console.log(`  ${groups.CONFIRMED.length} payments need recovery:`);
      for (const p of groups.CONFIRMED) {
        console.log(`    POST ${BASE}?token=...&payment_id=${p.id}`);
      }
    }
    return;
  }
  console.log('\nMax attempts reached.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
