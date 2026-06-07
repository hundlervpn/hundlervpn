// Реальный трафик через DE за 30 дней (а не только товарища)
import pg from 'pg';

const c = new pg.Client({
  host: '132.243.242.196', port: 5432, user: 'gen_user',
  password: 'HundlerVPN2026Strong', database: 'default_db', ssl: false,
});
await c.connect();

// Топ юзеров по DE-трафику last 30 days
const top = await c.query(
  `SELECT u.telegram_id, u.username,
          (SUM(ust.bytes_used) / 1024.0 / 1024.0 / 1024.0)::numeric(10,2) AS gb
   FROM user_server_traffic ust
   JOIN users u ON u.id = ust.user_id
   JOIN servers s ON s.id = ust.server_id
   WHERE s.country = 'DE'
     AND ust.quota_period_start > NOW() - INTERVAL '30 days'
   GROUP BY u.telegram_id, u.username
   ORDER BY SUM(ust.bytes_used) DESC NULLS LAST
   LIMIT 10`,
);
console.log('--- Top-10 DE users (last 30 days) ---');
console.log(top.rows);

// Общая статистика по серверам
const summary = await c.query(
  `SELECT s.country, s.name,
          COUNT(DISTINCT ust.user_id) AS uniq_users,
          (SUM(ust.bytes_used) / 1024.0 / 1024.0 / 1024.0)::numeric(10,2) AS total_gb
   FROM user_server_traffic ust
   JOIN servers s ON s.id = ust.server_id
   WHERE ust.quota_period_start > NOW() - INTERVAL '30 days'
   GROUP BY s.country, s.name
   ORDER BY SUM(ust.bytes_used) DESC NULLS LAST`,
);
console.log('\n--- Traffic summary per server (30 days) ---');
console.log(summary.rows);

await c.end();
