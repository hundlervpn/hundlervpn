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
    'SELECT id, title, target_telegram_id, status, total_users, sent_count FROM broadcasts ORDER BY created_at DESC LIMIT 5'
  );
  console.log('Recent broadcasts:');
  broadcasts.rows.forEach(b => {
    console.log(`  ID: ${b.id}, target: ${b.target_telegram_id}, total: ${b.total_users}, sent: ${b.sent_count}, status: ${b.status}`);
  });
  
  await client.end();
}

main().catch(console.error);
