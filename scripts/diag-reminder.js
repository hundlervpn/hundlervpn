// Why is durov0379@gmail.com not getting the expiring reminder?
// Inspects users + subscriptions + reminders state to figure out which
// of the cron's filters is eliminating the row.
//
// Usage: node scripts/diag-reminder.js durov0379@gmail.com

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

async function main() {
  const email = process.argv[2] || 'durov0379@gmail.com';
  const client = await pool.connect();
  try {
    const u = await client.query(
      `SELECT id, telegram_id, email, is_banned, auth_type, created_at
       FROM users WHERE email = $1`,
      [email]
    );
    console.log(`\n=== USER (email=${email}) ===`);
    console.log(JSON.stringify(u.rows, null, 2));

    if (u.rows.length === 0) {
      console.log('No user found for that email.');
      return;
    }
    const user = u.rows[0];

    const s = await client.query(
      `SELECT id, status, end_date, created_at,
              (end_date > NOW()) AS not_expired,
              (end_date <= NOW() + INTERVAL '24 hours') AS within_24h,
              EXTRACT(EPOCH FROM (end_date - NOW()))/3600 AS hours_left
       FROM subscriptions
       WHERE user_id = $1
       ORDER BY end_date DESC
       LIMIT 5`,
      [user.id]
    );
    console.log(`\n=== SUBSCRIPTIONS (latest 5) ===`);
    console.log(JSON.stringify(s.rows, null, 2));

    const r = await client.query(
      `SELECT subscription_id, kind, delivered, error_text, sent_at
       FROM subscription_reminders
       WHERE user_id = $1
       ORDER BY sent_at DESC`,
      [user.id]
    );
    console.log(`\n=== REMINDERS already sent ===`);
    console.log(JSON.stringify(r.rows, null, 2));

    console.log(`\n=== ELIGIBILITY CHECK (cron criteria) ===`);
    console.log(`telegram_id IS NOT NULL: ${user.telegram_id !== null} (telegram_id=${user.telegram_id})`);
    console.log(`is_banned = FALSE: ${!user.is_banned}`);
    if (s.rows.length > 0) {
      const top = s.rows[0];
      console.log(`status='active': ${top.status === 'active'} (status=${top.status})`);
      console.log(`end_date > NOW(): ${top.not_expired} (hours_left=${Number(top.hours_left).toFixed(2)})`);
      console.log(`end_date <= NOW()+24h: ${top.within_24h}`);
      const reminded = r.rows.find(x => String(x.subscription_id) === String(top.id) && x.kind === 'expiring_1d');
      console.log(`already reminded for THIS sub (id=${top.id}): ${!!reminded}`);
      if (reminded) {
        console.log(`  -> sent_at=${reminded.sent_at} delivered=${reminded.delivered} error=${reminded.error_text}`);
      }
    } else {
      console.log('User has no subscription rows at all.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
