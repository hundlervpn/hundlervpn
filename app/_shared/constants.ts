// Auto-extracted from app/page.tsx: module-level constants, tab list, motion variants.
export const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

export const tabs = ['home', 'support', 'profile', 'account', 'payment', 'payments', 'admin', 'servers', 'tgstore', 'services', 'boxes', 'boxes-history'] as const;
export type Tab = typeof tabs[number];

export const pageVariants = {
  initial: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 20 : -20
  }),
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.25, ease: [0, 0, 0.2, 1] as const }
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction < 0 ? 20 : -20,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as const }
  })
};

export const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 }
  }
};

export const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } }
};
