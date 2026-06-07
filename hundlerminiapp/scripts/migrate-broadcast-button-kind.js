// 2026-05-05: add button_kind + button_promo_code to broadcasts so the
// admin can send a button that opens the Mini App (with optional
// promo-code auto-apply). Idempotent — safe to re-run.

const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

(async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    // button_kind
    await c.query(`
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS button_kind TEXT
        NOT NULL DEFAULT 'url'
        CHECK (button_kind IN ('url', 'app', 'promo'))
    `);
    console.log('button_kind column ensured.');

    // button_promo_code
    await c.query(`
      ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS button_promo_code TEXT
    `);
    console.log('button_promo_code column ensured.');

    // Verify the schema
    const cols = await c.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'broadcasts'
        AND column_name IN ('button_kind', 'button_promo_code')
      ORDER BY column_name
    `);
    console.log('Result:');
    for (const r of cols.rows) {
      console.log(`  - ${r.column_name} (${r.data_type}) default=${r.column_default ?? 'NULL'}`);
    }
  } finally {
    await c.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
