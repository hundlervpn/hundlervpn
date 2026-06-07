const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false
});

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node add-server.js <name> <host> [public_key] [short_id] [sni]');
    console.log('Example: node add-server.js "NL Server 1" "vpn1.example.com" "PUBLIC_KEY" "abc123" "www.microsoft.com"');
    process.exit(1);
  }

  const [name, host, publicKey, shortId, sni] = args;
  const syncToken = 'sync_' + crypto.randomBytes(24).toString('hex');

  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO servers (name, host, public_key, short_id, sni, sync_token, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, name, host, sync_token`,
      [name, host, publicKey || null, shortId || null, sni || 'www.microsoft.com']
    );

    const server = result.rows[0];
    
    console.log('\n=== Server Added ===');
    console.log('ID:', server.id);
    console.log('Name:', server.name);
    console.log('Host:', server.host);
    console.log('Sync Token:', syncToken);
    
    // Update with sync_token
    await client.query(`UPDATE servers SET sync_token = $1 WHERE id = $2`, [syncToken, server.id]);

    console.log('\n=== Install Command ===');
    console.log(`Run this on the VPN server:\n`);
    console.log(`curl -sL https://YOUR_APP_URL/install-xray-sync.sh | bash -s -- \\
  --url "https://YOUR_APP_URL" \\
  --token "${syncToken}" \\
  --key "YOUR_PRIVATE_KEY" \\
  --short-id "${shortId || 'YOUR_SHORT_ID'}"`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
