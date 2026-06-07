const { Client } = require('pg');
(async () => {
  const c = new Client({
    connectionString:
      'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  });
  await c.connect();
  const r = await c.query(
    `SELECT id, product_type, period, stars_amount, price_rub, status,
            telegram_username, created_at
       FROM fragment_orders ORDER BY id DESC LIMIT 20`,
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
