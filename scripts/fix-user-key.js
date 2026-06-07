const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false
});

async function main() {
  const client = await pool.connect();
  try {
    // Получаем данные сервера
    const serverResult = await client.query(`
      SELECT host, port, public_key, sni, short_id, fingerprint, flow, name
      FROM servers WHERE is_active = true LIMIT 1
    `);
    
    if (serverResult.rows.length === 0) {
      console.log('No active server found!');
      return;
    }
    
    const srv = serverResult.rows[0];
    const keyHash = 'a61fd922-0c84-45e4-8f9d-e4f2469de561';
    
    // Генерируем VLESS URI
    const vlessUri = `vless://${keyHash}@${srv.host}:${srv.port}?encryption=none&flow=${srv.flow || 'xtls-rprx-vision'}&security=reality&sni=${srv.sni}&fp=${srv.fingerprint || 'chrome'}&pbk=${srv.public_key}&sid=${srv.short_id}&type=tcp#${encodeURIComponent(srv.name || 'HundlerVPN')}`;
    
    console.log('Generated VLESS URI:', vlessUri.substring(0, 80) + '...');
    
    // Обновляем key_uri
    const updateResult = await client.query(`
      UPDATE vpn_keys SET key_uri = $1 WHERE key_hash = $2 RETURNING id
    `, [vlessUri, keyHash]);
    
    console.log('Updated key ID:', updateResult.rows[0]?.id);
    
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
