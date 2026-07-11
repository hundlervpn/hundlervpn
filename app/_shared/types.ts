// Auto-extracted from app/page.tsx: Telegram WebApp global types + auth types.
// Telegram WebApp types
interface TelegramWebApp {
  initDataUnsafe: {
    start_param?: string;
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
  };
  close: () => void;
  openInvoice: (url: string) => Promise<{ status: 'paid' | 'cancelled' | 'failed' | 'pending' }>;
  openLink: (url: string) => void;
  // Open a Telegram t.me/... link inside the Telegram app (preferred for
  // share / deep links). Optional because older clients may not expose it.
  openTelegramLink?: (url: string) => void;
  expand: () => void;
  requestFullscreen?: () => void;
  ready: () => void;
  version: string;
  platform: string;
  isFullscreen?: boolean;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
      Login?: {
        auth: (options: { client_id: string; request_access: string[]; lang?: string }, callback: (data: { id_token?: string; user?: any; error?: string }) => void) => void;
        open: (callback?: (data: { id_token?: string; user?: any; error?: string }) => void) => void;
        init: (options: { client_id: string; request_access?: string[]; lang?: string }, callback: (data: { id_token?: string; user?: any; error?: string }) => void) => void;
      };
    };
  }
}

export type AuthMode = 'telegram' | 'email' | 'none';
export type UserIdentifier = { type: 'telegram'; telegramId: number } | { type: 'email'; userId: number };
