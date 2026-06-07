const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false
});

async function main() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT u.id, u.telegram_id, vk.id as key_id, vk.key_hash, vk.is_active, vk.device_name, vk.last_connected_at
      FROM users u 
      LEFT JOIN vpn_keys vk ON vk.user_id = u.id 
      WHERE u.telegram_id = '2029065770'
    `);
    
    console.log('User 2029065770 keys:');
    console.log(JSON.stringify(result.rows, null, 2));
    
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
