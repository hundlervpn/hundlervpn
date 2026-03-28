const { Client } = require('pg');
const crypto = require('crypto');

const client = new Client({
  host: '5.42.118.215',
  port: 5432,
  user: 'gen_user',
  password: 'sE*Hn5,Ar=9bc6',
  database: 'default_db',
  ssl: false,
});

async function fix() {
  try {
    await client.connect();
    
    // Generate UUID for VPN key
    const keyHash = crypto.randomUUID();
    
    // Build VLESS URI
    const host = '2.27.40.77';
    const port = 443;
    const publicKey = 'FGoKgrmBJlHaDozJxN7uOwwMqy7BF3DFEztnd-G-onI';
    const sni = 'www.microsoft.com';
    const shortId = 'dbf97f2a1d10c1c8';
    const keyUri = `vless://${keyHash}@${host}:${port}?encryption=none&security=reality&type=tcp&sni=${sni}&fp=chrome&pbk=${publicKey}&sid=${shortId}&flow=xtls-rprx-vision#Hundler%20VPN`;
    
    // Create VPN key for user 2 with subscription 8
    const result = await client.query(`
      INSERT INTO vpn_keys (user_id, subscription_id, key_hash, key_uri, is_active, expires_at, device_name)
      SELECT 2, 8, $1, $2, TRUE, s.end_date, 'Default Device'
      FROM subscriptions s WHERE s.id = 8
      RETURNING id, key_hash, expires_at;
    `, [keyHash, keyUri]);
    
    console.log('Created VPN key:', result.rows[0]);
    
    // Verify
    const check = await client.query(`
      SELECT vk.id, vk.key_hash, vk.is_active, vk.expires_at, s.status, s.end_date
      FROM vpn_keys vk
      LEFT JOIN subscriptions s ON s.id = vk.subscription_id
      WHERE vk.user_id = 2
    `);
    console.log('Verification:', check.rows);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

fix();
