import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const appUrl = process.env.APP_URL;

    if (!botToken) {
      return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not set' }, { status: 500 });
    }

    if (!appUrl) {
      return NextResponse.json({ error: 'APP_URL is not set' }, { status: 500 });
    }

    const webhookUrl = `${appUrl}/api/telegram/webhook`;
    const url = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

    const response = await fetch(url);
    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error setting webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
