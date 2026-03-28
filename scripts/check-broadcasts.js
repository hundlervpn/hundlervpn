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
  
  const broadcasts = await client.query(
    'SELECT id, title, status, total_users, sent_count, created_at FROM broadcasts ORDER BY created_at DESC LIMIT 5'
  );
  console.log('Broadcasts:', broadcasts.rows);
  
  const users = await client.query(
    'SELECT COUNT(*) as count FROM users WHERE telegram_id IS NOT NULL'
  );
  console.log('Users with telegram_id:', users.rows[0].count);
  
  await client.end();
}

main().catch(console.error);
