import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { months } = body;

    const apiKey = process.env.OXAPAY_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'OxaPay API ключ не настроен (OXAPAY_API_KEY)' },
        { status: 500 }
      );
    }

    // OxaPay API endpoint
    const url = 'https://api.oxapay.com/v1/payment/invoice';

    // Simplified payload with only required fields
    const payload = {
      amount: 0.5,
      currency: 'USD',
      lifetime: 30,
      order_id: `vpn_${months}m_${Date.now()}`,
      description: `Hundler VPN Premium ${months} months`
    };

    console.log('OxaPay request payload:', JSON.stringify(payload, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'merchant_api_key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('OxaPay response:', JSON.stringify(data, null, 2));

    if (data.status === 200 && data.data?.payment_url) {
      return NextResponse.json({ 
        paymentUrl: data.data.payment_url,
        trackId: data.data.track_id,
        expiredAt: data.data.expired_at
      });
    } else {
      console.error('OxaPay API Error:', data);
      return NextResponse.json(
        { error: data.message || data.error?.message || 'Ошибка создания крипто-счета', details: data },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Crypto invoice creation error:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера', details: String(error) },
      { status: 500 }
    );
  }
}
