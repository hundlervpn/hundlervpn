const fs = require('fs');
const check = fs.readFileSync('hundlerminiapp/MINIAPP-AGENTS.md', 'utf-8');
const sections = check.split(/^## /m);

let append = [];
for (const section of sections) {
  if (!section.trim()) continue;
  const name = section.split('\n')[0].trim();
  if (name.includes('v62') || name.includes('Known issue') || name.includes('v63')) {
    append.push('## ' + section);
  }
}
fs.appendFileSync('hundlerminiapp/docs/vpn.md', '\n' + append.join('\n'));
