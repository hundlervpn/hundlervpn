const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

export function isAdmin(telegramId: number | string | null | undefined): boolean {
  if (!telegramId) return false;
  const id = typeof telegramId === 'string' ? Number(telegramId) : telegramId;
  if (!Number.isFinite(id)) return false;
  return ADMIN_TELEGRAM_IDS.includes(id);
}

export function assertAdmin(telegramId: number | string | null | undefined): void {
  if (!isAdmin(telegramId)) {
    throw new Error('Forbidden');
  }
}
