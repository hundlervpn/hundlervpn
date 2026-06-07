import 'dotenv/config';

const apiKey = process.env.OPENROUTER_API_KEY || "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";

async function main() {
  console.log("Отправляем запрос к OpenRouter (Claude Opus 4.8) через Fetch...\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://hundlervpn.xyz",
      "X-Title": "HundlerVPN"
    },
    body: JSON.stringify({
      model: "anthropic/claude-opus-4.8",
      messages: [
        { role: "user", content: "How many r's are in the word 'strawberry'?" }
      ]
    })
  });

  if (!response.ok) {
    console.error("Ошибка HTTP:", response.status, await response.text());
    return;
  }

  const data = await response.json();
  console.log("Ответ от модели:");
  console.log(data.choices[0]?.message?.content);
}

main().catch(console.error);
