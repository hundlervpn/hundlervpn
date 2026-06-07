#!/usr/bin/env node
// Tiny local Telegram bot for verifying that a bot token works.
//
// Usage:
//   node scripts/test-bot-token.js <BOT_TOKEN>
//   # or set BOT_TOKEN env var:
//   $env:BOT_TOKEN="123:abc"; node scripts/test-bot-token.js
//
// Behaviour:
//   1. Calls getMe to confirm the token is valid; prints @username + id.
//   2. Starts long-polling getUpdates (offset-based) so it never misses a message.
//   3. On /start replies with "Бот живой ✅" + tg id of the sender.
//   4. Logs every update with timestamp so you can see traffic in real time.
//
// No npm deps — uses Node 22's built-in fetch.

const TOKEN = process.argv[2] || process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('Usage: node scripts/test-bot-token.js <BOT_TOKEN>');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

function ts() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

async function tg(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`tg ${method} failed: ${JSON.stringify(data)}`);
  }
  return data.result;
}

async function main() {
  // 1. Validate token.
  let me;
  try {
    me = await tg('getMe');
  } catch (err) {
    console.error(`[${ts()}] ❌ Token invalid:`, err.message);
    process.exit(1);
  }
  console.log(`[${ts()}] ✅ Token valid`);
  console.log(`           Bot: @${me.username} (id=${me.id}, name="${me.first_name}")`);
  console.log(`           Open: https://t.me/${me.username}`);
  console.log(`[${ts()}] Listening for updates… (press Ctrl+C to stop)`);
  console.log('');

  // 2. Long-poll loop.
  let offset = 0;
  while (true) {
    let updates;
    try {
      updates = await tg('getUpdates', { offset, timeout: 25 });
    } catch (err) {
      console.error(`[${ts()}] getUpdates error: ${err.message} — retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg) {
        console.log(`[${ts()}] (non-message update_id=${u.update_id})`);
        continue;
      }
      const from = msg.from
        ? `${msg.from.first_name || ''}${msg.from.last_name ? ' ' + msg.from.last_name : ''}` +
          ` (@${msg.from.username || 'no_username'}, id=${msg.from.id})`
        : 'unknown';
      const text = msg.text || '<no text>';
      console.log(`[${ts()}] from ${from}: ${text}`);

      if (text === '/start' || text.startsWith('/start ')) {
        try {
          await tg('sendMessage', {
            chat_id: msg.chat.id,
            text:
              `🤖 Бот живой ✅\n\n` +
              `Токен: рабочий\n` +
              `Bot: @${me.username}\n` +
              `Ваш Telegram ID: ${msg.from.id}\n` +
              `Время: ${new Date().toISOString()}`,
          });
          console.log(`[${ts()}]   → replied to ${msg.from.id}`);
        } catch (err) {
          console.error(`[${ts()}]   ❌ reply failed: ${err.message}`);
        }
      } else {
        // Echo any other text so you see two-way traffic.
        try {
          await tg('sendMessage', {
            chat_id: msg.chat.id,
            text: `Получил: "${text}"\n\n(отправьте /start чтобы получить тестовое сообщение)`,
          });
        } catch (err) {
          console.error(`[${ts()}]   ❌ echo failed: ${err.message}`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(`[${ts()}] FATAL:`, err);
  process.exit(1);
});
