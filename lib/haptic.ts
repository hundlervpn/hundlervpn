type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotificationType = 'success' | 'warning' | 'error';

export function haptic(style: HapticStyle = 'medium') {
  try {
    if (typeof window !== 'undefined') {
      const wa = (window as any).Telegram?.WebApp;
      if (wa?.HapticFeedback?.impactOccurred) {
        wa.HapticFeedback.impactOccurred(style);
        return;
      }
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      const duration = style === 'heavy' || style === 'rigid' ? 50 : style === 'medium' ? 30 : 15;
      navigator.vibrate(duration);
    }
  } catch { /* ignore */ }
}

export function hapticNotification(type: NotificationType = 'success') {
  try {
    if (typeof window !== 'undefined') {
      const wa = (window as any).Telegram?.WebApp;
      if (wa?.HapticFeedback?.notificationOccurred) {
        wa.HapticFeedback.notificationOccurred(type);
        return;
      }
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      const pattern = type === 'error' ? [50, 50, 50] : type === 'warning' ? [30, 30] : [40];
      navigator.vibrate(pattern);
    }
  } catch { /* ignore */ }
}

export function hapticSelection() {
  try {
    if (typeof window !== 'undefined') {
      const wa = (window as any).Telegram?.WebApp;
      if (wa?.HapticFeedback?.selectionChanged) {
        wa.HapticFeedback.selectionChanged();
        return;
      }
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(10);
    }
  } catch { /* ignore */ }
}
