const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Adding device_type and last_connected_at columns...');
    
    await client.query(`
      ALTER TABLE vpn_keys ADD COLUMN IF NOT EXISTS device_type TEXT;
    `);
    console.log('✓ device_type column added');
    
    await client.query(`
      ALTER TABLE vpn_keys ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ;
    `);
    console.log('✓ last_connected_at column added');
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
