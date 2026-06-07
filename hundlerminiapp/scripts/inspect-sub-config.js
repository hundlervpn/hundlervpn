#!/usr/bin/env node
/**
 * Diagnostic: pull a real sub-config for a real active user and print the
 * outbounds[] array, so we can see exactly what bytes our /api/sub/[token]
 * is shipping to clients for the Germany server.
 *
 *   node scripts/inspect-sub-config.js
 *
 * Picks the most recently-active subscription that has a sub_token,
 * fetches https://hundlervpn.xyz/api/sub/{token} with a sing-box-flavoured
 * User-Agent (so the JSON branch fires), and dumps the relevant chunks.
 */
const { Pool } = require('pg');
const https = require('https');

const pool = new Pool({
  connectionString: 'postgresql://gen_user:HundlerVPN2026Strong@132.243.242.196:5432/default_db',
  ssl: false,
});

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      })
      .on('error', reject);
  });
}

async function main() {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT u.telegram_id, u.id AS user_id, u.sub_token, s.status, s.end_date
         FROM users u
         JOIN subscriptions s ON s.user_id = u.id
        WHERE s.status = 'active'
          AND s.end_date > NOW()
          AND u.sub_token IS NOT NULL
        ORDER BY s.updated_at DESC
        LIMIT 1;`,
    );
    if (r.rows.length === 0) {
      console.log('No active subs with a sub_token found.');
      return;
    }
    const u = r.rows[0];
    console.log(`Sample user: telegram_id=${u.telegram_id}  user_id=${u.user_id}`);
    console.log(`Sub end_date: ${u.end_date}`);
    console.log(`Token: ${u.sub_token.slice(0, 8)}…`);

    const url = `https://hundlervpn.xyz/api/sub/${u.sub_token}`;
    console.log(`\nFetching ${url}\n`);
    const res = await fetchJson(url, {
      'User-Agent': 'HundlerVPN/1.0 (Windows; Win10) sing-box/1.10.0',
      'X-Device-OS': 'windows',
      'X-Device-Model': 'Diagnostic',
      'X-HWID': 'diag-hwid',
    });
    console.log(`Status: ${res.status}`);
    console.log(`profile-title: ${res.headers['profile-title']}`);
    console.log(`profile-update-interval: ${res.headers['profile-update-interval']}`);
    console.log(`subscription-userinfo: ${res.headers['subscription-userinfo']}\n`);

    let parsed;
    try {
      parsed = JSON.parse(res.body);
    } catch (err) {
      console.log('Body is not JSON. First 500 chars:');
      console.log(res.body.slice(0, 500));
      return;
    }

    if (!parsed.outbounds) {
      console.log('No outbounds[] in response. Full body:');
      console.log(JSON.stringify(parsed, null, 2));
      return;
    }

    console.log(`outbounds[] count: ${parsed.outbounds.length}\n`);
    for (const ob of parsed.outbounds) {
      const isReal = ob.type && !['selector', 'urltest', 'block', 'dns', 'direct'].includes(ob.type);
      console.log(`  • tag="${ob.tag}" type=${ob.type} server=${ob.server || '-'}:${ob.server_port || '-'}`);
      if (ob.tag && ob.tag.toLowerCase().includes('герм') || (ob.tag || '').toLowerCase().includes('de') || (ob.server || '').includes('213.182.213.183') || (ob.server || '').includes('de.hundler')) {
        console.log('\n  ===== GERMANY OUTBOUND DETAIL =====');
        console.log(JSON.stringify(ob, null, 2));
        console.log('  ===================================\n');
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
