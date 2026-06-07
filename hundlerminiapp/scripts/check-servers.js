const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false
});

async function main() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, name, host, port, country, public_key, sni, short_id, fingerprint, flow, api_key
      FROM servers
      ORDER BY id
    `);
    
    console.log('Servers in DB:');
    result.rows.forEach(s => {
      console.log(`  ID: ${s.id}, name: ${s.name}, host: ${s.host}`);
      console.log(`    public_key: ${s.public_key ? s.public_key.substring(0,20) + '...' : 'NULL'}`);
      console.log(`    sni: ${s.sni}, short_id: ${s.short_id}`);
      console.log(`    api_key: ${s.api_key ? s.api_key.substring(0,15) + '...' : 'NULL'}`);
      console.log('');
    });
    
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
