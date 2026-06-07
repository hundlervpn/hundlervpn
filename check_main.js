const fs = require('fs');
const content = fs.readFileSync('hundlerminiapp/MINIAPP-AGENTS.md', 'utf-8');
const sections = content.split(/^## /m);

let remainingMain = [];
for (const section of sections) {
  if (!section.trim()) continue;
  const name = section.split('\n')[0].trim();
  
  if (name.includes('Tech Stack')) continue;
  else if (name.includes('VPN Architecture') || name.includes('Security') || name.includes('Adding a New VPN Server')) continue;
  else if (name.includes('Database')) continue;
  else if (name.includes('Environment Variables')) continue;
  else if (name.includes('Subscriptions') || name.includes('Device Tracking')) continue;
  else if (name.includes('Telegram Bot')) continue;
  else if (name.includes('Frontend Structure') || name.includes('UI Architecture') || name.includes('Account Linking') || name.includes('Telegram:')) continue;
  else if (name.includes('Planned') || name.includes('TODO')) continue;
  else remainingMain.push(name);
}
console.log(remainingMain);
