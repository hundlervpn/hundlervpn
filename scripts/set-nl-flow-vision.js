// One-shot: set flow='xtls-rprx-vision' for all NL servers in the `servers`
// table. Run AFTER the NL VPS Xray config has been patched to require Vision
// (otherwise NL clients will be rejected with "client flow is empty").
//
// Usage:  node scripts/set-nl-flow-vision.js
//
// Rollback:
//   node -e "require('pg').Pool && new (require('pg').Pool)({connectionString:'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db'}).query(\"UPDATE servers SET flow='' WHERE country='NL' RETURNING id,host,flow\").then(r=>{console.log(r.rows);process.exit()})"

const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('=== BEFORE ===');
    const before = await client.query(
      `SELECT id, name, host, country, flow FROM servers WHERE country='NL' ORDER BY id`,
    );
    before.rows.forEach((s) =>
      console.log(
        `  id=${s.id} host=${s.host} country=${s.country} flow="${s.flow ?? ''}"`,
      ),
    );

    if (before.rows.length === 0) {
      console.log('No NL servers found. Aborting.');
      return;
    }

    console.log('\n=== UPDATING flow=xtls-rprx-vision for NL ===');
    const upd = await client.query(
      `UPDATE servers
          SET flow = 'xtls-rprx-vision'
        WHERE country = 'NL'
      RETURNING id, host, country, flow`,
    );
    upd.rows.forEach((s) =>
      console.log(
        `  id=${s.id} host=${s.host} country=${s.country} flow="${s.flow}"`,
      ),
    );

    console.log('\n=== AFTER (verify) ===');
    const after = await client.query(
      `SELECT id, name, host, country, flow FROM servers WHERE country='NL' ORDER BY id`,
    );
    after.rows.forEach((s) =>
      console.log(
        `  id=${s.id} host=${s.host} country=${s.country} flow="${s.flow ?? ''}"`,
      ),
    );

    console.log(
      '\nDone. Now the user must reload the subscription in Happ — the next /api/sub/{token} response will carry flow=xtls-rprx-vision in the VLESS user block.',
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
