import { randomInt } from 'crypto';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY || process.env.EMAIL_API || '';
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const smtpUser = process.env.SMTP_USER || '';
const smtpPass = process.env.SMTP_PASS || '';
const smtpEnabled = Boolean(smtpUser && smtpPass);

const transporter = smtpEnabled
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })
  : null;

function buildVerificationEmailHtml(code: string) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 420px; margin: 0 auto; padding: 32px 24px; background: #0a0a0a; color: #fff; border-radius: 16px;">
      <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 700;">Hundler VPN</h2>
      <p style="margin: 0 0 24px; color: #a1a1aa; font-size: 14px;">Ваш код подтверждения:</p>
      <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #fff;">${code}</span>
      </div>
      <p style="margin: 0; color: #71717a; font-size: 12px;">Код действителен 10 минут. Если вы не запрашивали код, проигнорируйте это письмо.</p>
    </div>
  `;
}

export function generateCode(): string {
  return String(randomInt(100000, 1000000));
}

async function sendWithResend(email: string, subject: string, html: string): Promise<boolean> {
  if (!resend) return false;

  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const { error } = await resend.emails.send({
    from: `Hundler VPN <${from}>`,
    to: [email],
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message || 'Unknown error'}`);
  }

  return true;
}

async function sendWithSmtp(email: string, subject: string, html: string): Promise<void> {
  if (!transporter) {
    throw new Error('Email provider is not configured. Set RESEND_API_KEY (or EMAIL_API) or SMTP settings.');
  }

  const from = process.env.SMTP_FROM || smtpUser || 'noreply@hundlervpn.com';
  await transporter.sendMail({
    from: `"Hundler VPN" <${from}>`,
    to: email,
    subject,
    html,
  });
}

export async function sendVerificationCode(email: string, code: string): Promise<void> {
  const subject = 'Hundler VPN — Код подтверждения';
  const html = buildVerificationEmailHtml(code);

  const sentWithResend = await sendWithResend(email, subject, html);
  if (sentWithResend) return;

  await sendWithSmtp(email, subject, html);
}
