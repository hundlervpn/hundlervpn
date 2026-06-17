const ADMIN_OWNER_ID = 2029065770;

type NewTicketNotification = {
  ticketId: string;
  subject?: string | null;
  message: string;
  senderTelegramId?: number | null;
  senderUserId?: number | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export async function notifyAdminNewTicket(notification: NewTicketNotification): Promise<void> {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('notifyAdminNewTicket: TELEGRAM_BOT_TOKEN is not set');
      return;
    }

    const subjectLine = notification.subject
      ? `\n<b>Тема:</b> ${escapeHtml(notification.subject)}`
      : '';

    const senderLine = notification.senderTelegramId
      ? `\n<b>От:</b> <a href="tg://user?id=${notification.senderTelegramId}">${notification.senderTelegramId}</a>`
      : notification.senderUserId
        ? `\n<b>От:</b> user #${notification.senderUserId}`
        : '';

    const body = notification.message
      ? escapeHtml(truncate(notification.message, 600))
      : '📷 Вложение';

    const text = `🆕 <b>Новое обращение</b>${subjectLine}${senderLine}\n<b>Тикет:</b> #${notification.ticketId}\n\n${body}`;

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_OWNER_ID,
        parse_mode: 'HTML',
        text,
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      console.error('notifyAdminNewTicket: telegram sendMessage failed', res.status, await res.text());
    }
  } catch (error) {
    console.error('notifyAdminNewTicket error:', error);
  }
}
