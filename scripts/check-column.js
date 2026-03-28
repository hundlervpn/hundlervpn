const { Client } = require('pg');

const client = new Client({
  host: '5.42.118.215',
  port: 5432,
  user: 'gen_user',
  password: 'sE*Hn5,Ar=9bc6',
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
