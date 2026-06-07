const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Adding servers columns...');
    
    await client.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS api_key TEXT;`);
    console.log('✓ api_key column added');
    
    await client.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS xray_api_port INTEGER DEFAULT 10085;`);
    console.log('✓ xray_api_port column added');
    
    await client.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;`);
    console.log('✓ last_sync_at column added');
    
    console.log('Migration completed!');
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
