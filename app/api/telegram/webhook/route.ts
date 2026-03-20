import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const update = await req.json();
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN is not set');
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 });
    }

    // Handle pre_checkout_query
    if (update.pre_checkout_query) {
      const preCheckoutQueryId = update.pre_checkout_query.id;
      
      // Here you can validate the payload, check stock, etc.
      // For digital goods with Stars, we usually just approve it.
      
      const url = `https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`;
      
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pre_checkout_query_id: preCheckoutQueryId,
          ok: true,
        }),
      });
      
      return NextResponse.json({ ok: true });
    }

    // Handle successful_payment
    if (update.message && update.message.successful_payment) {
      const paymentInfo = update.message.successful_payment;
      const payload = paymentInfo.invoice_payload;
      const userId = update.message.from.id;
      
      console.log(`Payment successful! User ID: ${userId}, Payload: ${payload}, Total Amount: ${paymentInfo.total_amount} ${paymentInfo.currency}`);
      
      // Here you would typically update your database to grant the user premium access
      // based on the payload (e.g., vpn_premium_1_months_...)
      
      // Send a thank you message to the user
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: update.message.chat.id,
          text: 'Спасибо за оплату! Ваша премиум-подписка активирована. 🎉',
        }),
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
