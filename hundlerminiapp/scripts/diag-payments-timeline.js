// Show full payment timeline to find when webhook started failing.
// Question: was viktoriaevlanskaya the FIRST broken payment, or were there
// successful auto-activations before/after her stuck payment?
//
// Usage: node scripts/diag-payments-timeline.js

const { Client } = require('pg');

const conn = process.env.DATABASE_URL
  || `postgresql://gen_user:${encodeURIComponent('HundlerVPN2026Strong')}@132.243.242.196:5432/default_db`;

async function main() {
  const c = new Client({ connectionString: conn, ssl: false });
  await c.connect();

  // All Platega payments (SBP + card), sorted by created_at
  const r = await c.query(
    `SELECT
       p.id,
       p.user_id,
       u.username,
       u.first_name,
       u.telegram_id,
       p.amount,
       p.status,
       p.provider,
       p.external_payment_id,
       p.created_at,
       p.paid_at,
       p.metadata->>'days' AS days,
       p.metadata->>'method' AS method
     FROM payments p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.provider IN ('platega', 'platega_sbp', 'sbp')
       OR p.external_payment_id IS NOT NULL
     ORDER BY p.created_at ASC`,
  );

  console.log(`=== ALL PLATEGA PAYMENTS (${r.rows.length}) ===\n`);

  let lastPaidAt = null;
  let lastPendingAfterPaid = null;
  let firstStuckAfterLastPaid = null;

  for (const p of r.rows) {
    const created = new Date(p.created_at);
    const paid = p.paid_at ? new Date(p.paid_at) : null;
    const status = p.status;
    const ageOfPay = paid ? Math.round((paid - created) / 1000) : null;

    let marker = '   ';
    if (status === 'paid') {
      marker = ' ✅';
      lastPaidAt = created;
    } else if (status === 'pending' && p.external_payment_id) {
      marker = ' ⚠️ ';
      if (lastPaidAt && !firstStuckAfterLastPaid) {
        firstStuckAfterLastPaid = created;
      }
    } else if (status === 'failed' || status === 'canceled') {
      marker = ' ❌';
    }

    const user = p.first_name || p.username || `id=${p.user_id}`;
    console.log(
      `${marker} #${String(p.id).padStart(3)}  ${created.toISOString()}  ${String(p.amount).padStart(7)}₽  ${status.padEnd(10)}  ${(p.method || '?').padEnd(6)}  ${user}` +
      (ageOfPay !== null ? `  (auto-activated in ${ageOfPay}s)` : '') +
      (p.external_payment_id ? `  ext=${p.external_payment_id.slice(0, 8)}…` : '  (no ext_id)'),
    );
  }

  console.log(`\n=== ANALYSIS ===`);
  console.log(`Last successfully auto-activated payment: ${lastPaidAt ? lastPaidAt.toISOString() : 'NEVER'}`);
  console.log(`First stuck payment after that:           ${firstStuckAfterLastPaid ? firstStuckAfterLastPaid.toISOString() : 'NONE'}`);

  if (lastPaidAt && firstStuckAfterLastPaid) {
    const gap = Math.round((firstStuckAfterLastPaid - lastPaidAt) / (1000 * 60 * 60 * 24) * 10) / 10;
    console.log(`Gap: ${gap} days between last working webhook and first broken one`);
    console.log(`\nThis is when webhook auth started failing.`);
  }

  // Also check provider distribution
  const provs = await c.query(
    `SELECT provider, status, COUNT(*) FROM payments GROUP BY provider, status ORDER BY provider, status`,
  );
  console.log(`\n=== BY PROVIDER + STATUS ===`);
  for (const row of provs.rows) {
    console.log(`  ${row.provider}/${row.status}: ${row.count}`);
  }

  await c.end();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
