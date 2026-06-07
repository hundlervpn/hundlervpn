/**
 * rename-servers-and-fix-order.js — One-off cleanup (2026-05-11).
 *
 *   1. Renames servers to plain country names per user request:
 *        DE: "Pro"            -> "Германия"
 *        NL: "Обход Глушилок" -> "Нидерланды"
 *        RU: "YouTube"        -> "Россия"
 *      Idempotent — re-runs are no-op.
 *
 *   2. Patches Daria Savelo's fragment order #11 — UI sent stars_amount=100
 *      while period='1000 stars' (priceRub=1700). The server is now patched
 *      so future orders are correct; this one row needs manual repair so
 *      the admin actually delivers 1000 Stars to her, not 100.
 *
 * Safe to run multiple times.
 */
const { Client } = require('pg');

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

async function main() {
  const c = new Client({ connectionString: CONNECTION_STRING });
  await c.connect();

  console.log('═══════════════════ CLEANUP RUN ═══════════════════\n');

  // ───────── 1. Rename servers ─────────
  // 2026-05-12 update: NL switched to "Обход Глушилок" — UI then renders
  // the full label as "🇳🇱 Нидерланды | Обход Глушилок" via buildServerTag.
  // Keeping DE/RU short so they render as plain "🇩🇪 Германия" / "🇷🇺 Россия".
  console.log('▶ Renaming servers …');
  const renames = [
    { country: 'DE', name: 'Германия' },
    { country: 'NL', name: 'Обход Глушилок' },
    { country: 'RU', name: 'Россия' },
  ];

  for (const { country, name } of renames) {
    // Show the old name so the log is informative.
    const before = await c.query(
      `SELECT id, name, country FROM servers WHERE country = $1`,
      [country],
    );
    if (before.rows.length === 0) {
      console.log(`  ${country}: no row found, skipping`);
      continue;
    }
    for (const row of before.rows) {
      if (row.name === name) {
        console.log(`  ${country} (id=${row.id}): already "${name}" — no change`);
      } else {
        await c.query(`UPDATE servers SET name = $1 WHERE id = $2`, [name, row.id]);
        console.log(`  ${country} (id=${row.id}): "${row.name}" → "${name}"`);
      }
    }
  }
  console.log();

  // ───────── 2. Fix Daria's order #11 ─────────
  console.log('▶ Patching fragment order #11 (Daria Savelo) …');
  const order = await c.query(
    `SELECT id, stars_amount, price_rub, status, telegram_username
       FROM fragment_orders WHERE id = 11`,
  );
  if (order.rows.length === 0) {
    console.log('  Order #11 not found — skipping');
  } else {
    const r = order.rows[0];
    console.log(`  Before: stars=${r.stars_amount}, price=${r.price_rub}₽, status=${r.status}, user=@${r.telegram_username}`);
    if (Number(r.stars_amount) === 1000) {
      console.log('  Already 1000 stars — no change');
    } else if (Number(r.price_rub) === 1700) {
      await c.query(`UPDATE fragment_orders SET stars_amount = 1000 WHERE id = 11`);
      console.log('  → patched: stars_amount = 1000');
    } else {
      console.log(`  Price is ${r.price_rub}₽ — NOT 1700, skipping (manual review)`);
    }
  }
  console.log();

  // ───────── 3. Verify ─────────
  console.log('▶ Final state:');
  const after = await c.query(
    `SELECT id, name, country, is_active FROM servers ORDER BY id`,
  );
  for (const row of after.rows) {
    console.log(`  server #${row.id}: ${row.country} "${row.name}" ${row.is_active ? '✓' : '×'}`);
  }
  const o = await c.query(
    `SELECT id, stars_amount, price_rub, status FROM fragment_orders WHERE id = 11`,
  );
  if (o.rows.length) {
    const r = o.rows[0];
    console.log(`  order #11: ${r.stars_amount} stars / ${r.price_rub}₽ / ${r.status}`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  await c.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
