import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

export function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function sendVerificationCode(email: string, code: string): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@hundlervpn.com';

  await transporter.sendMail({
    from: `"Hundler VPN" <${from}>`,
    to: email,
    subject: 'Hundler VPN — Код подтверждения',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 420px; margin: 0 auto; padding: 32px 24px; background: #0a0a0a; color: #fff; border-radius: 16px;">
        <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 700;">Hundler VPN</h2>
        <p style="margin: 0 0 24px; color: #a1a1aa; font-size: 14px;">Ваш код подтверждения:</p>
        <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #fff;">${code}</span>
        </div>
        <p style="margin: 0; color: #71717a; font-size: 12px;">Код действителен 10 минут. Если вы не запрашивали код, проигнорируйте это письмо.</p>
      </div>
    `,
  });
}
