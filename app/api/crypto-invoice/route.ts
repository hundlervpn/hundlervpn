import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { months, amount } = body;

    const apiKey = process.env.OXAPAY_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'OxaPay API ключ не настроен (OXAPAY_API_KEY)' },
        { status: 500 }
      );
    }

    // OxaPay API endpoint
    const url = 'https://api.oxapay.com/v1/payment/invoice';

    const payload = {
      amount: amount, // Amount in USD
      currency: 'USD',
      lifetime: 30, // 30 minutes expiration
      fee_paid_by_payer: 1,
      under_paid_coverage: 2.5,
      to_currency: 'USDT',
      auto_withdrawal: false,
      mixed_payment: true,
      callback_url: `${process.env.APP_URL}/api/crypto-callback`,
      return_url: process.env.APP_URL,
      order_id: `vpn_premium_${months}_months_${Date.now()}`,
      description: `Hundler VPN Premium (${months} мес.)`,
      sandbox: false
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'merchant_api_key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.status === 200 && data.data?.payment_url) {
      return NextResponse.json({ 
        paymentUrl: data.data.payment_url,
        trackId: data.data.track_id,
        expiredAt: data.data.expired_at
      });
    } else {
      console.error('OxaPay API Error:', data);
      return NextResponse.json(
        { error: data.message || 'Ошибка создания крипто-счета' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Crypto invoice creation error:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}
