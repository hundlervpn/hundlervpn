// Diagnose why a user's payment didn't activate their subscription.
// Usage: node scripts/diag-payment.js <username_or_telegram_id>

const { Client } = require('pg');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/diag-payment.js <username|telegram_id>');
  process.exit(1);
}

const conn = process.env.DATABASE_URL
  || `postgresql://gen_user:${encodeURIComponent('HundlerVPN2026Strong')}@132.243.242.196:5432/default_db`;

async function main() {
  const c = new Client({ connectionString: conn, ssl: false });
  await c.connect();

  // 1. Find user — try multiple matching strategies
  let user;
  if (/^\d+$/.test(target)) {
    const r = await c.query(
      `SELECT * FROM users WHERE telegram_id = $1 OR id = $1 LIMIT 1`,
      [Number(target)],
    );
    user = r.rows[0];
  } else {
    // Try exact username, then ILIKE wildcard, then first_name match
    let r = await c.query(`SELECT * FROM users WHERE username = $1 LIMIT 1`, [target]);
    if (r.rows.length === 0) {
      r = await c.query(`SELECT * FROM users WHERE username ILIKE $1 LIMIT 5`, [`%${target}%`]);
    }
    if (r.rows.length === 0) {
      r = await c.query(
        `SELECT * FROM users WHERE first_name ILIKE $1 OR last_name ILIKE $1 LIMIT 5`,
        [`%${target}%`],
      );
    }
    if (r.rows.length > 1) {
      console.log(`\nMultiple matches for "${target}":`);
      for (const u of r.rows) {
        console.log({
          id: u.id,
          telegram_id: u.telegram_id,
          username: u.username,
          first_name: u.first_name,
          last_name: u.last_name,
          created_at: u.created_at,
        });
      }
      console.log('\nRe-run with telegram_id of the correct user.');
      await c.end();
      return;
    }
    user = r.rows[0];
  }
  if (!user) {
    console.log(`No user found for "${target}"`);
    await c.end();
    return;
  }
  console.log('=== USER ===');
  console.log({
    id: user.id,
    telegram_id: user.telegram_id,
    username: user.username,
    first_name: user.first_name,
    auth_type: user.auth_type,
    status: user.status,
    is_banned: user.is_banned,
    referred_by_user_id: user.referred_by_user_id,
    created_at: user.created_at,
    last_seen_at: user.last_seen_at,
  });

  // 2. Subscriptions
  const subs = await c.query(
    `SELECT s.*, p.name AS plan_name, p.duration_days, p.price
     FROM subscriptions s
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC`,
    [user.id],
  );
  console.log(`\n=== SUBSCRIPTIONS (${subs.rows.length}) ===`);
  for (const s of subs.rows) {
    console.log({
      id: s.id,
      plan: `${s.plan_name} (${s.duration_days}d, ${s.price}₽)`,
      status: s.status,
      start_date: s.start_date,
      end_date: s.end_date,
      created_at: s.created_at,
      updated_at: s.updated_at,
    });
  }

  // 3. Payments — full detail including metadata
  const pays = await c.query(
    `SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC`,
    [user.id],
  );
  console.log(`\n=== PAYMENTS (${pays.rows.length}) ===`);
  for (const p of pays.rows) {
    console.log({
      id: p.id,
      subscription_id: p.subscription_id,
      amount: `${p.amount} ${p.currency}`,
      status: p.status,
      provider: p.provider,
      external_payment_id: p.external_payment_id,
      created_at: p.created_at,
      paid_at: p.paid_at,
      metadata: p.metadata,
    });
  }

  // 4. Promo code uses (in case she got a 1-day promo)
  const promos = await c.query(
    `SELECT pcu.*, pc.code, pc.days, pc.discount_percent
     FROM promo_code_uses pcu
     LEFT JOIN promo_codes pc ON pc.id = pcu.promo_code_id
     WHERE pcu.user_id = $1
     ORDER BY pcu.created_at DESC`,
    [user.id],
  );
  console.log(`\n=== PROMO CODE USES (${promos.rows.length}) ===`);
  for (const p of promos.rows) {
    console.log({
      promo_code_id: p.promo_code_id,
      code: p.code,
      days: p.days,
      discount_percent: p.discount_percent,
      created_at: p.created_at,
    });
  }

  // 5. Recent logs for this user
  const logs = await c.query(
    `SELECT id, action, details, created_at FROM logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [user.id],
  );
  console.log(`\n=== RECENT LOGS (${logs.rows.length}) ===`);
  for (const l of logs.rows) {
    console.log({
      id: l.id,
      action: l.action,
      details: l.details,
      created_at: l.created_at,
    });
  }

  await c.end();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
