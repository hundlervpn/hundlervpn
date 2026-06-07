const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false
});

async function main() {
  const client = await pool.connect();
  try {
    // Генерируем API ключ
    const apiKey = 'sk_' + crypto.randomBytes(24).toString('hex');
    
    // Обновляем все серверы (или конкретный)
    const result = await client.query(
      `UPDATE servers SET api_key = $1 WHERE api_key IS NULL RETURNING id, name, api_key`,
      [apiKey]
    );
    
    if (result.rowCount === 0) {
      // Если нет серверов без ключа, обновляем первый
      const result2 = await client.query(
        `UPDATE servers SET api_key = $1 WHERE id = (SELECT id FROM servers LIMIT 1) RETURNING id, name, api_key`,
        [apiKey]
      );
      console.log('Updated server:', result2.rows[0]);
    } else {
      console.log('Updated servers:', result.rows);
    }
    
    console.log('\n=== API Key generated ===');
    console.log('VPN_WEBHOOK_SECRET=' + apiKey);
    console.log('\nAdd this to your .env file on Timeweb');
    
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
