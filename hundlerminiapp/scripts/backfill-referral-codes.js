// One-shot backfill: assign `users.referral_code` to every account that
// doesn't have one yet. Required so existing email / Google users (and any
// pre-referral-code Telegram users) can share their invite link from
// ProfileView. Idempotent — safe to re-run.
//
// Format rules (mirrors lib/referral-code.ts):
//   - rows with telegram_id !== NULL → 'u' + base36(telegram_id)
//   - all other rows                  → 'e' + base36(id)
//
// Both prefixes are collision-free against each other AND against codes that
// /api/users/sync writes today, so the UNIQUE index won't bite.
//
// Usage: node scripts/backfill-referral-codes.js

const { Client } = require('pg');

const conn = process.env.DATABASE_URL
  || `postgresql://gen_user:${encodeURIComponent('HundlerVPN2026Strong')}@132.243.242.196:5432/default_db`;

const toBase36 = (n) => Number(n).toString(36);

async function main() {
  const c = new Client({ connectionString: conn, ssl: false });
  await c.connect();
  console.log('Connected to DB.');

  const before = await c.query(`
    SELECT
      COUNT(*) FILTER (WHERE referral_code IS NULL) AS missing,
      COUNT(*) AS total
    FROM users;
  `);
  console.log(`Before: ${before.rows[0].missing} / ${before.rows[0].total} users missing referral_code`);

  // Pull every user that needs a code in one round trip; then issue per-row
  // UPDATEs (so the unique constraint can reject any individual collision
  // without rolling back the whole batch).
  const rows = await c.query(`
    SELECT id, telegram_id
    FROM users
    WHERE referral_code IS NULL
    ORDER BY id ASC;
  `);

  let ok = 0;
  let failed = 0;
  for (const r of rows.rows) {
    const code = r.telegram_id
      ? `u${toBase36(r.telegram_id)}`
      : `e${toBase36(r.id)}`;
    try {
      await c.query(
        `UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL;`,
        [r.id, code]
      );
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`  ✗ user_id=${r.id} (${code}):`, err.message);
    }
  }
  console.log(`  ✓ assigned referral_code to ${ok} users (failed: ${failed})`);

  const after = await c.query(`
    SELECT
      COUNT(*) FILTER (WHERE referral_code IS NULL) AS missing,
      COUNT(*) FILTER (WHERE referral_code LIKE 'u%') AS u_codes,
      COUNT(*) FILTER (WHERE referral_code LIKE 'e%') AS e_codes,
      COUNT(*) AS total
    FROM users;
  `);
  console.log('After:', after.rows[0]);

  await c.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
