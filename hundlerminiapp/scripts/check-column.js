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
  
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'broadcasts'
    ORDER BY ordinal_position
  `);
  console.log('Broadcasts columns:');
  cols.rows.forEach(c => {
    console.log(`  ${c.column_name}: ${c.data_type} (nullable: ${c.is_nullable})`);
  });
  
  await client.end();
}

main().catch(console.error);
