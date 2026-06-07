#!/usr/bin/env node
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});
(async () => {
  const r = await pool.query(
    `SELECT id, name, country, host, display_host, is_active, port, hysteria2_port
       FROM servers ORDER BY id ASC`
  );
  for (const s of r.rows) {
    const clientAddr = s.display_host && s.display_host.trim() ? s.display_host : s.host;
    const looksLikeIp = /^\d+\.\d+\.\d+\.\d+$/.test(clientAddr);
    const status = s.is_active ? 'ACTIVE' : 'inactive';
    const hidden = looksLikeIp ? 'IP LEAKS' : 'hidden';
    console.log(
      `id=${s.id}  ${s.country}  '${s.name}'  ${status}  host=${s.host}  display_host=${s.display_host || '(NULL)'}  client_sees=${clientAddr}  → ${hidden}`
    );
  }
  await pool.end();
})();
