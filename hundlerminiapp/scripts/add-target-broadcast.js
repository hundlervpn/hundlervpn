const { Client } = require('pg');

const client = new Client({
  host: '132.243.242.196',
  port: 5432,
  user: 'gen_user',
  password: 'HundlerVPN2026Strong',
  database: 'default_db'
});

async function main() {
  await client.connect();
  
  await client.query('ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS target_telegram_id BIGINT');
  console.log('Migration done: target_telegram_id column added');
  
  await client.end();
}

main().catch(console.error);
