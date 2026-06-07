const https = require('https');

const data = JSON.stringify({
  connections: [{ keyHash: 'tg-2029065770' }]
});

const options = {
  hostname: 'hundlervpn-hundlervpn-f985.twc1.net',
  port: 443,
  path: '/api/vpn/sync',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk_d4c07f6a52e7040731dd4ff42bdb399fc17f978443f90f9a',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('Response:', body));
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(data);
req.end();
