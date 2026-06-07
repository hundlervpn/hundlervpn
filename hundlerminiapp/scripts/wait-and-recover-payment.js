// Poll until /api/admin/payments/recover is live, then:
//   1. List all pending Platega payments
//   2. Recover payment id=50 (viktoriaevlanskaya)

const TOKEN = 'hVpN2026sEcReT_xR4y';
const BASE = 'https://hundlervpn.xyz/api/admin/payments/recover';
const PAYMENT_ID = 50;
const INTERVAL = 30_000;
const MAX_ATTEMPTS = 30;

async function main() {
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const ts = new Date().toISOString();
    console.log(`\n[${i}/${MAX_ATTEMPTS}] ${ts} — probing endpoint …`);

    let r;
    try {
      r = await fetch(`${BASE}?token=${TOKEN}&pending=1`);
    } catch (e) {
      console.log(`  fetch error: ${e.message}`);
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    if (r.status === 404) {
      console.log('  endpoint NOT YET DEPLOYED (404)');
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    if (!r.ok) {
      const text = await r.text();
      console.log(`  HTTP ${r.status}: ${text}`);
      await new Promise((res) => setTimeout(res, INTERVAL));
      continue;
    }

    const body = await r.json();
    console.log(`  endpoint LIVE — pending payments: ${body.count}`);
    for (const p of body.payments || []) {
      console.log({
        id: p.id,
        user: `${p.first_name || p.username || '?'} (id=${p.user_id}, tg=${p.telegram_id ?? 'none'})`,
        amount: `${p.amount} ${p.metadata?.days ? `for ${p.metadata.days}d` : ''}`,
        external: p.external_payment_id,
        created: p.created_at,
      });
    }

    // Recover the target payment (POST)
    console.log(`\n  --- Recovering payment_id=${PAYMENT_ID} ---`);
    const recover = await fetch(`${BASE}?token=${TOKEN}&payment_id=${PAYMENT_ID}`, {
      method: 'POST',
    });
    const recoverBody = await recover.json();
    console.log('  Recovery result:', JSON.stringify(recoverBody, null, 2));

    return;
  }
  console.log('\nMax attempts reached. Endpoint still not live.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
