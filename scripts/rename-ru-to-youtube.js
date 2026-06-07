/**
 * rename-ru-to-youtube.js — DB migration (2026-05-12).
 *
 * Sets the Russia server's display name to "YouTube" so the full client-visible
 * tag becomes:
 *
 *     🇷🇺 Россия | YouTube
 *
 * Покрывает кейс пользователей, которые подключаются к RU-серверу, чтобы
 * обойти YouTube-замедление РКН (RU server виден как российский IP, но трафик
 * на YouTube идёт через WARP/VLESS). Имя серверной строки в подписке/UI
 * подсказывает прямо назначение.
 *
 * Idempotent — safe to run multiple times.
 *
 * Run:
 *   node scripts/rename-ru-to-youtube.js
 */
const { Client } = require('pg');

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

const TARGET_NAME = 'YouTube';

async function main() {
  const c = new Client({ connectionString: CONNECTION_STRING });
  await c.connect();
  console.log('═══════ RU → "YouTube" rename ═══════\n');

  const before = await c.query(
    `SELECT id, name, country, host, is_active FROM servers WHERE country = 'RU'`
  );
  if (before.rows.length === 0) {
    console.log('No RU server in DB — nothing to do.');
    await c.end();
    return;
  }

  for (const row of before.rows) {
    if (row.name === TARGET_NAME) {
      console.log(`  RU #${row.id} (${row.host}): already "${TARGET_NAME}" — skip`);
    } else {
      await c.query(`UPDATE servers SET name = $1 WHERE id = $2`, [TARGET_NAME, row.id]);
      console.log(`  RU #${row.id} (${row.host}): "${row.name}" → "${TARGET_NAME}"`);
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
