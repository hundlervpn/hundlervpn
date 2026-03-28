const { Client } = require('pg');

const client = new Client({
  host: '5.42.118.215',
  port: 5432,
  user: 'gen_user',
  password: 'sE*Hn5,Ar=9bc6',
  database: 'default_db',
  ssl: false,
});

async function debug() {
  try {
    await client.connect();
    
    // Check vpn_keys for user 2
    const keys = await client.query(`
      SELECT vk.id, vk.key_hash, vk.is_active, vk.subscription_id, vk.expires_at,
             s.status as sub_status, s.end_date
      FROM vpn_keys vk
      LEFT JOIN subscriptions s ON s.id = vk.subscription_id
      WHERE vk.user_id = 2
      ORDER BY vk.created_at DESC
    `);
    console.log('VPN Keys for user 2:');
    console.log(JSON.stringify(keys.rows, null, 2));
    
    // Fix: reactivate the key
    if (keys.rows.length > 0 && !keys.rows[0].is_active) {
      console.log('\nReactivating key...');
      await client.query('UPDATE vpn_keys SET is_active = TRUE WHERE id = $1', [keys.rows[0].id]);
      console.log('Key reactivated!');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

debug();
