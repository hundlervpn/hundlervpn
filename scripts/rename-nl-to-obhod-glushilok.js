/**
 * rename-nl-to-obhod-glushilok.js — DB migration (2026-05-12).
 *
 * Sets the Netherlands server's display name to "Обход Глушилок" so the full
 * client-visible server tag becomes:
 *
 *     🇳🇱 Нидерланды | Обход Глушилок
 *
 * The tag is rendered by `buildServerTag()` in `lib/sub-token.ts` as:
 *
 *     `{flag emoji} {COUNTRY_NAMES_RU[country]} | {server.name}`
 *
 * so changing the `name` column propagates everywhere that uses this helper:
 *   - sing-box JSON config (Hundler-app via /api/sub/{token})
 *   - Happ multi-profile JSON array (per-server entries)
 *   - v2rayTun / v2rayNG / NekoBox profiles
 *   - admin panel list
 *
 * Idempotent — safe to run multiple times.
 *
 * Run:
 *   DATABASE_URL='postgresql://...' node scripts/rename-nl-to-obhod-glushilok.js
 */
const { Client } = require('pg');

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

const TARGET_NAME = 'Обход Глушилок';

async function main() {
  const c = new Client({ connectionString: CONNECTION_STRING });
  await c.connect();
  console.log('═══════ NL → "Обход Глушилок" rename ═══════\n');

  const before = await c.query(
    `SELECT id, name, country, host, is_active FROM servers WHERE country = 'NL'`
  );
  if (before.rows.length === 0) {
    console.log('No NL server in DB — nothing to do.');
    await c.end();
    return;
  }

  for (const row of before.rows) {
    if (row.name === TARGET_NAME) {
      console.log(`  NL #${row.id} (${row.host}): already "${TARGET_NAME}" — skip`);
    } else {
      await c.query(`UPDATE servers SET name = $1 WHERE id = $2`, [TARGET_NAME, row.id]);
      console.log(`  NL #${row.id} (${row.host}): "${row.name}" → "${TARGET_NAME}"`);
    }
  }

  console.log('\n▶ Verification:');
  const after = await c.query(
    `SELECT id, name, country, is_active FROM servers ORDER BY id`
  );
  for (const row of after.rows) {
    console.log(
      `  #${row.id}: ${row.country} "${row.name}" ${row.is_active ? '✓' : '×'}`
    );
  }

  console.log('\n═══════════════════════════════════════════════');
  await c.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
