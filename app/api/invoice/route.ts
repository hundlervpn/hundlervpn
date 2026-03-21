import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { months } = body;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      return NextResponse.json(
        { error: 'Токен бота не настроен (TELEGRAM_BOT_TOKEN)' },
        { status: 500 }
      );
    }

    // Telegram API URL for creating an invoice link
    const url = `https://api.telegram.org/bot${botToken}/createInvoiceLink`;

    const payload = {
      title: `Hundler VPN Premium (${months} мес.)`,
      description: `Оплата премиум-подписки на ${months} месяцев. Безлимитный трафик, высокая скорость.`,
      payload: `vpn_premium_${months}_months_${Date.now()}`,
      provider_token: "", // Must be empty for Telegram Stars (XTR)
      currency: "XTR",
      prices: [
        {
          label: "Premium Subscription",
          amount: 1 // Test mode: fixed 1 Star
        }
      ]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.ok) {
      return NextResponse.json({ invoiceLink: data.result });
    } else {
      console.error('Telegram API Error:', data);
      return NextResponse.json(
        { error: data.description || 'Ошибка создания счета в Telegram' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Invoice creation error:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}
