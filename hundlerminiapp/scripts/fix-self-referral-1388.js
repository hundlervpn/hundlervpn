// One-shot cleanup for user 1388 (fallensai) self-referral loop reported
// 2026-05-09. The user clicked their own ?startapp=ref_<own_code> link
// and got `referred_by_user_id = id` (self) on their own row, polluting
// their invitee list in the modal.
//
// Sweeps the whole users table for self-loops (idempotent — finds 0 rows
// after the first run) so any other users in the same situation get
// fixed alongside 1388. The /api/users/sync route guard (added in the
// same commit) prevents NEW self-loops from being written.

const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL ||
  'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db';

(async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    // Show the affected rows BEFORE clearing for an audit trail.
    const before = await c.query(
      `SELECT id, telegram_id, username, first_name, referral_code
       FROM users
       WHERE referred_by_user_id = id`
    );
    console.log(`Found ${before.rowCount} user(s) with self-referral loop:`);
    for (const r of before.rows) {
      console.log(`  - id=${r.id} tg=${r.telegram_id} ${r.username ?? ''} (${r.first_name ?? ''}) ref_code=${r.referral_code}`);
    }
    if (before.rowCount === 0) {
      console.log('Nothing to clean up.');
      return;
    }
    const upd = await c.query(
      `UPDATE users SET referred_by_user_id = NULL
       WHERE referred_by_user_id = id
       RETURNING id`
    );
    console.log(`Cleared referred_by_user_id on ${upd.rowCount} row(s):`);
    for (const r of upd.rows) console.log(`  - id=${r.id}`);
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
