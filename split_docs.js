const fs = require('fs');
const content = fs.readFileSync('hundlerminiapp/MINIAPP-AGENTS.md', 'utf-8');
const sections = content.split(/^## /m);

const docs = {
  architecture: [],
  vpn: [],
  database: [],
  deployment: [],
  billing: [],
  bot: [],
  frontend: [],
  planned: []
};

let remainingMain = [];

for (const section of sections) {
  if (!section.trim()) continue;
  const name = section.split('\n')[0].trim();
  const text = '## ' + section;
  
  if (name.includes('Tech Stack')) docs.architecture.push(text);
  else if (name.includes('VPN Architecture') || name.includes('Security') || name.includes('Adding a New VPN Server')) docs.vpn.push(text);
  else if (name.includes('Database')) docs.database.push(text);
  else if (name.includes('Environment Variables')) docs.deployment.push(text);
  else if (name.includes('Subscriptions') || name.includes('Device Tracking')) docs.billing.push(text);
  else if (name.includes('Telegram Bot')) docs.bot.push(text);
  else if (name.includes('Frontend Structure') || name.includes('UI Architecture') || name.includes('Account Linking') || name.includes('Telegram:')) docs.frontend.push(text);
  else if (name.includes('Planned') || name.includes('TODO')) docs.planned.push(text);
  else remainingMain.push(text);
}

fs.mkdirSync('hundlerminiapp/docs', { recursive: true });

for (const [key, val] of Object.entries(docs)) {
  if (val.length > 0) {
    fs.writeFileSync('hundlerminiapp/docs/' + key + '.md', val.join('\n'));
    console.log('Created docs/' + key + '.md (' + val.length + ' sections)');
  }
}
