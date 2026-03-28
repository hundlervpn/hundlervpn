const { Client } = require('pg');

const client = new Client({
  host: '5.42.118.215',
  port: 5432,
  user: 'gen_user',
  password: 'sE*Hn5,Ar=9bc6',
  database: 'default_db',
  ssl: false,
});

async function check() {
  try {
    await client.connect();
    
    // Check user
    const user = await client.query(`
      SELECT id, telegram_id, status, is_banned 
      FROM users 
      WHERE telegram_id = 2029065770
    `);
    console.log('User:', user.rows[0]);
    
    // Check subscriptions
    const subs = await client.query(`
      SELECT id, user_id, status, start_date, end_date 
      FROM subscriptions 
      WHERE user_id = $1
      ORDER BY end_date DESC
    `, [user.rows[0]?.id]);
    console.log('Subscriptions:', subs.rows);
    
    // Check vpn_keys
    const keys = await client.query(`
      SELECT vk.id, vk.user_id, vk.subscription_id, vk.is_active, vk.expires_at, vk.key_hash
      FROM vpn_keys vk
      WHERE vk.user_id = $1
      ORDER BY vk.created_at DESC
    `, [user.rows[0]?.id]);
    console.log('VPN Keys:', keys.rows);
    
    // Check if key has valid subscription
    if (keys.rows.length > 0 && keys.rows[0].subscription_id) {
      const keySub = await client.query(`
        SELECT id, status, end_date FROM subscriptions WHERE id = $1
      `, [keys.rows[0].subscription_id]);
      console.log('Key subscription:', keySub.rows[0]);
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

check();
