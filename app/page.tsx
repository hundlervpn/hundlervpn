'use client';

import { useState, memo, useEffect } from 'react';
import Image from 'next/image';
import { Shield, CreditCard, User, Zap, Check, ChevronRight, HelpCircle, Star, Bitcoin, Wallet, Calendar, Smartphone, Settings, Gift, MonitorSmartphone, Globe, X, Monitor, FileText, Lock, Download, ArrowRight, CheckCircle2, Laptop, Smartphone as SmartphoneIcon, ShieldAlert, Users, Ban, Tag, Search, Plus, Trash2, Copy, ClipboardCheck, Key, Mail, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
  expand: () => void;
  ready: () => void;
  version: string;
  platform: string;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

const translations = {
  ru: {
    navVpn: 'Главная', navPremium: 'Оплата', navProfile: 'Профиль',
    mainBadge: 'Основная',
    planName: 'Подписка',
    until: 'до',
    date: '12.04.2026',
    devices: 'До 3 устройств',
    extend: 'Продлить',
    install: 'Установить и настроить',
    promo: 'Промокоды',
    myDevices: 'Мои устройства',
    months: 'мес.', perMonth: 'в мес.', total: 'Итого:',
    payTg: 'Tg Stars', payCrypto: 'Крипто', paySbp: 'СБП',
    subscribe: 'Оплатить',
    featTitle: 'Преимущества', f1: 'До 3 устройств', f2: 'Безлимитный трафик', f3: 'Минимальные задержки',
    user: 'Пользователь', daysLeft: 'Осталось 23 дня',
    app: 'Приложение', lang: 'Язык', support: 'Поддержка (Telegram)', referral: 'Реферальная система', payments: 'Платежи', userAgreement: 'Пользовательское соглашение', privacyPolicy: 'Политика конфиденциальности',
    connected: 'ПОДКЛЮЧЕНО', disconnected: 'ОТКЛЮЧЕНО', location: 'Германия', ping: '120 мс',
    setupTitle: 'Настройка VPN',
    setupCurrent: 'Настроить это устройство',
    setupOther: 'Другое устройство',
    setupLinkCopied: 'Ссылка скопирована!',
    setupCopyLink: 'Скопировать ссылку с ключом',
    setupDetecting: 'Определение устройства...',
    setupDetected: 'Обнаружено устройство:',
    setupWindows: 'Windows',
    setupMacos: 'macOS',
    setupLinux: 'Linux',
    setupAndroid: 'Android',
    setupIos: 'iPhone/iPad',
    setupUnknown: 'Устройство',
    setupFor: 'Настройка на',
    setupStepsHint: '3 шага для завершения настройки',
    setupStart: 'Начать настройку',
    setupOtherDevice: 'Другое устройство',
    setupChooseDevice: 'Выберите устройство',
    setupInstallTitle: 'Установка клиента',
    setupInstallDesc: 'Сначала установите приложение клиента на устройство.',
    setupInstallButton: 'Установить клиент',
    setupAddTitle: 'Добавление подписки',
    setupAddDesc: 'Скопируйте ключ и вставьте его в приложение Happ.',
    setupAddButton: 'Скопировать ключ',
    setupKeyCopied: 'Ключ скопирован!',
    setupNoKey: 'У вас нет активного ключа. Оформите подписку.',
    setupKeyLoading: 'Загрузка ключа...',
    setupCopyForOther: 'Скопировать ключ для устройства',
    setupNext: 'Далее',
    setupFinish: 'Завершить',
    setupStepOf: 'из',
    setupRegion: 'Регион',
    setupGlobal: 'Global',
    setupRussia: 'Russia',
    setupNoStore: 'Для этого устройства ссылка на магазин пока не задана.'
    ,paymentsHistoryTitle: 'История платежей',
    backToProfile: 'Назад в профиль',
    noPaymentsYet: 'Платежей пока нет',
    referralCopied: 'Реферальная ссылка скопирована',
    adminPanel: 'Админ панель',
    adminStats: 'Статистика',
    adminUsers: 'Пользователи',
    adminPromos: 'Промокоды',
    adminTotalUsers: 'Всего',
    adminTodayUsers: 'Сегодня',
    adminBannedUsers: 'Забанено',
    adminRevenue: 'Доход',
    adminActiveSubs: 'Активных подписок',
    adminPaidPayments: 'Оплаченных',
    adminSearchUsers: 'Поиск по имени или ID...',
    adminBan: 'Бан',
    adminUnban: 'Разбан',
    adminCreatePromo: 'Создать промокод',
    adminPromoCode: 'Код',
    adminPromoDays: 'Дней подписки',
    adminPromoMaxUses: 'Макс. использований',
    adminPromoCreate: 'Создать',
    adminBackToProfile: 'Назад в профиль',
    adminNoUsers: 'Пользователей не найдено',
    adminNoPromos: 'Промокодов пока нет',
    promoPlaceholder: 'Введите промокод',
    promoApply: 'Активировать',
    promoApplySuccess: 'Промокод применён',
    deleteDevice: 'Удалить',
    deleteDeviceConfirm: 'Удалить это устройство? VPN на нём перестанет работать.',
    deviceDeleted: 'Устройство удалено',
    serversTitle: 'Серверы',
    serverActive: 'Активен',
    serverInactive: 'Неактивен',
    noServers: 'Серверов пока нет'
  },
  en: {
    navVpn: 'Home', navPremium: 'Payment', navProfile: 'Profile',
    mainBadge: 'Main',
    planName: 'Subscription',
    until: 'until',
    date: '12.04.2026',
    devices: 'Up to 3 devices',
    extend: 'Extend',
    install: 'Install & Setup',
    promo: 'Promo codes',
    myDevices: 'My devices',
    months: 'mo.', perMonth: '/mo', total: 'Total:',
    payTg: 'Tg Stars', payCrypto: 'Crypto', paySbp: 'SBP',
    subscribe: 'Subscribe Now',
    featTitle: 'Premium Features', f1: 'Up to 3 devices', f2: 'Unlimited bandwidth', f3: 'Minimal latency',
    user: 'User', daysLeft: '23 days left',
    app: 'App', lang: 'Language', support: 'Support (Telegram)', referral: 'Referral system', payments: 'Payments', userAgreement: 'User agreement', privacyPolicy: 'Privacy policy',
    connected: 'CONNECTED', disconnected: 'DISCONNECTED', location: 'Germany', ping: '120 ms',
    setupTitle: 'VPN Setup',
    setupCurrent: 'Setup this device',
    setupOther: 'Other device',
    setupLinkCopied: 'Link copied!',
    setupCopyLink: 'Copy link with key',
    setupDetecting: 'Detecting device...',
    setupDetected: 'Detected device:',
    setupWindows: 'Windows',
    setupMacos: 'macOS',
    setupLinux: 'Linux',
    setupAndroid: 'Android',
    setupIos: 'iPhone/iPad',
    setupUnknown: 'Device',
    setupFor: 'Setup for',
    setupStepsHint: '3 steps to complete setup',
    setupStart: 'Start setup',
    setupOtherDevice: 'Other device',
    setupChooseDevice: 'Choose device',
    setupInstallTitle: 'Install client',
    setupInstallDesc: 'First, install the client application on your device.',
    setupInstallButton: 'Install client',
    setupAddTitle: 'Add subscription key',
    setupAddDesc: 'Copy the key and paste it into the Happ app.',
    setupAddButton: 'Copy key',
    setupKeyCopied: 'Key copied!',
    setupNoKey: 'No active key. Please subscribe first.',
    setupKeyLoading: 'Loading key...',
    setupCopyForOther: 'Copy key for device',
    setupNext: 'Next',
    setupFinish: 'Finish',
    setupStepOf: 'of',
    setupRegion: 'Region',
    setupGlobal: 'Global',
    setupRussia: 'Russia',
    setupNoStore: 'No store link configured for this device yet.'
    ,paymentsHistoryTitle: 'Payments history',
    backToProfile: 'Back to profile',
    noPaymentsYet: 'No payments yet',
    referralCopied: 'Referral link copied',
    adminPanel: 'Admin Panel',
    adminStats: 'Statistics',
    adminUsers: 'Users',
    adminPromos: 'Promo Codes',
    adminTotalUsers: 'Total',
    adminTodayUsers: 'Today',
    adminBannedUsers: 'Banned',
    adminRevenue: 'Revenue',
    adminActiveSubs: 'Active subs',
    adminPaidPayments: 'Paid',
    adminSearchUsers: 'Search by name or ID...',
    adminBan: 'Ban',
    adminUnban: 'Unban',
    adminCreatePromo: 'Create promo code',
    adminPromoCode: 'Code',
    adminPromoDays: 'Subscription days',
    adminPromoMaxUses: 'Max uses',
    adminPromoCreate: 'Create',
    adminBackToProfile: 'Back to profile',
    adminNoUsers: 'No users found',
    adminNoPromos: 'No promo codes yet',
    promoPlaceholder: 'Enter promo code',
    promoApply: 'Activate',
    promoApplySuccess: 'Promo code applied',
    deleteDevice: 'Delete',
    deleteDeviceConfirm: 'Delete this device? VPN will stop working on it.',
    deviceDeleted: 'Device deleted',
    serversTitle: 'Servers',
    serverActive: 'Active',
    serverInactive: 'Inactive',
    noServers: 'No servers yet'
  }
};

const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

const tabs = ['home', 'payment', 'profile', 'payments', 'admin', 'servers'] as const;
type Tab = typeof tabs[number];

const pageVariants = {
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

const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } }
};

type AuthMode = 'telegram' | 'email' | 'none';
type UserIdentifier = { type: 'telegram'; telegramId: number } | { type: 'email'; userId: number };

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [direction, setDirection] = useState(0);
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const [tgUser, setTgUser] = useState<{ id: number; name: string; photo: string; username?: string } | null>(null);
  const [subscriptionState, setSubscriptionState] = useState<{ endDate: string | null; daysLeft: number; status: string; subscriptionUrl: string | null } | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [authLoading, setAuthLoading] = useState(true);
  const [userIdentifier, setUserIdentifier] = useState<UserIdentifier | null>(null);

  const buildStateQuery = (ident: UserIdentifier | null) => {
    if (!ident) return '';
    return ident.type === 'telegram'
      ? `telegramId=${encodeURIComponent(String(ident.telegramId))}`
      : `userId=${encodeURIComponent(String(ident.userId))}`;
  };

  const refreshSubscriptionState = async (identOrTgId?: number | UserIdentifier) => {
    let query = '';
    if (typeof identOrTgId === 'number') {
      query = `telegramId=${encodeURIComponent(String(identOrTgId))}`;
    } else if (identOrTgId) {
      query = buildStateQuery(identOrTgId);
    } else {
      query = buildStateQuery(userIdentifier);
    }
    if (!query) return;
    const stateResponse = await fetch(`/api/users/state?${query}`);
    if (stateResponse.ok) {
      const statePayload = await stateResponse.json();
      setSubscriptionState(statePayload.profile ?? { endDate: null, daysLeft: 0, status: 'none', subscriptionUrl: null });
      return;
    }
    setSubscriptionState({ endDate: null, daysLeft: 0, status: 'none', subscriptionUrl: null });
  };

  const handleEmailLogin = (user: { id: number; email: string; name: string }, sessionToken: string) => {
    localStorage.setItem('hvpn_session', sessionToken);
    const ident: UserIdentifier = { type: 'email', userId: user.id };
    setTgUser({ id: user.id, name: user.name, photo: '', username: user.email });
    setUserIdentifier(ident);
    setAuthMode('email');
    refreshSubscriptionState(ident);
  };

  const handleEmailLogout = () => {
    localStorage.removeItem('hvpn_session');
    setTgUser(null);
    setUserIdentifier(null);
    setAuthMode('none');
    setSubscriptionState(null);
  };

  // Get Telegram user data on mount or restore email session
  useEffect(() => {
    const init = async () => {
      // Try Telegram WebApp first
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        
        console.log('Telegram WebApp initialized:', tg.initDataUnsafe);
        
        const user = tg.initDataUnsafe?.user;
        if (user) {
          console.log('User data:', user);
          const normalizedName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'User';
          const ident: UserIdentifier = { type: 'telegram', telegramId: user.id };

          setTgUser({
            id: user.id,
            name: normalizedName,
            photo: user.photo_url || '',
            username: user.username,
          });
          setUserIdentifier(ident);
          setAuthMode('telegram');

          const urlStartParam = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('startapp') || new URLSearchParams(window.location.search).get('start')
            : null;

          try {
            const syncResponse = await fetch('/api/users/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                telegramId: user.id,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name,
                photoUrl: user.photo_url,
                startParam: tg.initDataUnsafe?.start_param ?? urlStartParam ?? undefined,
              }),
            });

            if (!syncResponse.ok) {
              const syncPayload = await syncResponse.json().catch(() => ({ error: 'Sync failed' }));
              throw new Error(syncPayload.error || 'Sync failed');
            }

            await refreshSubscriptionState(user.id);
          } catch (error) {
            setSubscriptionState({ endDate: null, daysLeft: 0, status: 'none', subscriptionUrl: null });
            console.error('Failed to sync telegram user:', error);
          }
          setAuthLoading(false);
          return;
        }
      }

      // Try restoring email session
      if (typeof window !== 'undefined') {
        const savedToken = localStorage.getItem('hvpn_session');
        if (savedToken) {
          try {
            const res = await fetch(`/api/auth/session?token=${encodeURIComponent(savedToken)}`);
            if (res.ok) {
              const data = await res.json();
              if (data.ok && data.user) {
                const ident: UserIdentifier = { type: 'email', userId: data.user.id };
                setTgUser({ id: data.user.id, name: data.user.name, photo: '', username: data.user.email });
                setUserIdentifier(ident);
                setAuthMode('email');
                await refreshSubscriptionState(ident);
                setAuthLoading(false);
                return;
              }
            }
            localStorage.removeItem('hvpn_session');
          } catch { /* ignore */ }
        }
      }

      setAuthMode('none');
      setAuthLoading(false);
    };
    
    const timer = setTimeout(init, 100);
    return () => clearTimeout(timer);
  }, []);

  const t = translations[lang];
  const hasActiveSubscription = subscriptionState?.status === 'active';
  const subscriptionEndDateLabel = subscriptionState?.endDate
    ? new Date(subscriptionState.endDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')
    : (lang === 'ru' ? 'Нет подписки' : 'No subscription');
  const subscriptionDaysLabel = hasActiveSubscription
    ? (lang === 'ru'
        ? `Осталось ${subscriptionState?.daysLeft ?? 0} дн.`
        : `${subscriptionState?.daysLeft ?? 0} days left`)
    : (lang === 'ru' ? 'Нет активной подписки' : 'No active subscription');

  const navigate = (newTab: Tab) => {
    if (newTab === activeTab) return;
    const currentIndex = tabs.indexOf(activeTab);
    const newIndex = tabs.indexOf(newTab);
    setDirection(newIndex > currentIndex ? 1 : -1);
    setActiveTab(newTab);
  };

  const handleSwipeLeft = () => {
    const currentIndex = tabs.indexOf(activeTab);
    if (currentIndex < tabs.length - 1) navigate(tabs[currentIndex + 1]);
  };

  const handleSwipeRight = () => {
    const currentIndex = tabs.indexOf(activeTab);
    if (currentIndex > 0) navigate(tabs[currentIndex - 1]);
  };

  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.targetTouches[0].clientX);
    setTouchStartY(e.targetTouches[0].clientY);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartX || !touchStartY) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    
    const distanceX = touchStartX - touchEndX;
    const distanceY = touchStartY - touchEndY;
    
    // Check if swipe is mostly horizontal and long enough
    if (Math.abs(distanceX) > Math.abs(distanceY) && Math.abs(distanceX) > 40) {
      if (distanceX > 0) handleSwipeLeft();
      else handleSwipeRight();
    }
    
    setTouchStartX(null);
    setTouchStartY(null);
  };

  // Show loading
  if (authLoading) {
    return (
      <div className="min-h-screen w-full bg-[#020202] flex items-center justify-center">
        <div className="text-zinc-500 text-sm">...</div>
      </div>
    );
  }

  // Show email auth screen if not authenticated
  if (authMode === 'none') {
    return <EmailAuthView lang={lang} setLang={setLang} onLogin={handleEmailLogin} />;
  }

  return (
    <div className="min-h-screen w-full bg-[#020202] overflow-x-hidden relative font-sans">
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-white/10 blur-[55px]" />
        <div className="absolute top-[40%] -right-[10%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-white/5 blur-[65px]" />
      </div>

      <div className="relative z-10 min-h-screen lg:mx-auto lg:max-w-[1320px] lg:flex lg:items-stretch lg:gap-8 lg:px-6 lg:py-4">
        <DesktopSidebar t={t} activeTab={activeTab} navigate={navigate} />

        <main 
          className="w-full min-h-screen pb-24 px-4 flex flex-col lg:min-h-0 lg:flex-1 lg:pb-6 lg:px-0"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <header className="flex items-center justify-center py-6 shrink-0 lg:justify-start lg:py-4">
            <h1 className="font-syncopate font-bold text-base tracking-[0.12em] text-white flex items-center lg:text-lg">
              HUNDLER
              <span className="relative inline-block ml-1.5">
                <span className="absolute inset-0 bg-gradient-to-r from-white to-zinc-300 blur-sm opacity-35"></span>
                <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 via-white to-zinc-400">
                  VPN
                </span>
              </span>
            </h1>
          </header>

          <div className="w-full max-w-6xl mx-auto lg:flex-1 lg:flex lg:flex-col lg:items-center lg:justify-start">
            <AnimatePresence mode="wait" custom={direction}>
              {activeTab === 'home' && <HomeView key="home" t={t} direction={direction} subscriptionEndDateLabel={subscriptionEndDateLabel} subscriptionDaysLabel={subscriptionDaysLabel} subscriptionUrl={subscriptionState?.subscriptionUrl ?? null} tgUser={tgUser} onSubscriptionChange={refreshSubscriptionState} userIdentifier={userIdentifier} />}
              {activeTab === 'payment' && <PaymentView key="payment" t={t} direction={direction} tgUser={tgUser} onSubscriptionChange={refreshSubscriptionState} />}
              {activeTab === 'profile' && <ProfileView key="profile" t={t} lang={lang} setLang={setLang} direction={direction} tgUser={tgUser} subscriptionDaysLabel={subscriptionDaysLabel} navigate={navigate} authMode={authMode} onLogout={handleEmailLogout} />}
              {activeTab === 'payments' && <PaymentsHistoryView key="payments" t={t} direction={direction} tgUser={tgUser} navigate={navigate} lang={lang} />}
              {activeTab === 'admin' && <AdminView key="admin" t={t} direction={direction} tgUser={tgUser} navigate={navigate} lang={lang} />}
              {activeTab === 'servers' && <ServersView key="servers" t={t} direction={direction} navigate={navigate} />}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-zinc-950/95 backdrop-blur-xl border-t border-white/5 pt-2 pb-3 px-4 flex justify-around items-center z-20 lg:hidden">
        <NavItem 
          icon={<Shield size={20} strokeWidth={1.5} />} 
          label={t.navVpn} 
          isActive={activeTab === 'home'} 
          onClick={() => navigate('home')} 
        />
        <NavItem 
          icon={<CreditCard size={20} strokeWidth={1.5} />} 
          label={t.navPremium} 
          isActive={activeTab === 'payment'} 
          onClick={() => navigate('payment')} 
        />
        <NavItem 
          icon={<User size={20} strokeWidth={1.5} />} 
          label={t.navProfile} 
          isActive={activeTab === 'profile'} 
          onClick={() => navigate('profile')} 
        />
      </nav>
    </div>
  );
}

function DesktopSidebar({ t, activeTab, navigate }: { t: any; activeTab: Tab; navigate: (tab: Tab) => void }) {
  const menuBtnClass = (isActive: boolean) => `group w-full text-left px-3.5 py-2.5 rounded-xl text-sm transition-all ${isActive ? 'bg-gradient-to-r from-white/20 to-white/5 text-white border border-white/30 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]' : 'text-zinc-300 hover:bg-white/5 hover:border-white/10 border border-transparent'}`;

  return (
    <aside className="hidden lg:flex lg:w-72 lg:shrink-0 lg:flex-col lg:rounded-3xl lg:border lg:border-white/15 lg:bg-gradient-to-b lg:from-[#121212] lg:via-[#0b0b0b] lg:to-[#020202] lg:p-4 lg:backdrop-blur-xl lg:shadow-[0_0_45px_rgba(0,0,0,0.8)]">
      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="text-zinc-400 text-[11px] uppercase tracking-[0.16em] mb-2.5">Главная</p>
        <div className="space-y-1">
          <button onClick={() => navigate('home')} className={menuBtnClass(activeTab === 'home')}>{t.navVpn}</button>
          <button onClick={() => navigate('payment')} className={menuBtnClass(activeTab === 'payment')}>{t.navPremium}</button>
          <button onClick={() => navigate('profile')} className={menuBtnClass(activeTab === 'profile')}>{t.navProfile}</button>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.16em] mb-2.5">Ссылки</p>
        <div className="space-y-1 text-sm text-zinc-300">
          <a href="https://telegra.ph/Politika-konfidencialnosti-Hundler-VPN-03-21" target="_blank" rel="noopener noreferrer" className="block px-3 py-2 rounded-lg hover:bg-white/5 hover:text-white transition-colors">Политика конфиденциальности</a>
          <a href="https://telegra.ph/Polzovatelskoe-soglashenie-Hundler-VPN-03-21" target="_blank" rel="noopener noreferrer" className="block px-3 py-2 rounded-lg hover:bg-white/5 hover:text-white transition-colors">Пользовательское соглашение</a>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.16em] mb-2.5">Программы</p>
        <div className="space-y-1 text-sm text-zinc-300">
          <div className="px-3 py-2 rounded-lg hover:bg-white/5 hover:text-white transition-colors">Реферальная система</div>
          <div className="px-3 py-2 rounded-lg hover:bg-white/5 hover:text-white transition-colors">Партнерская программа</div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.16em] mb-2.5">Аккаунт</p>
        <div className="space-y-1 text-sm text-zinc-300">
          <div className="px-3 py-2 rounded-lg hover:bg-white/5 hover:text-white transition-colors">Платежи</div>
        </div>
      </div>
    </aside>
  );
}

function HomeView({ t, direction, subscriptionEndDateLabel, subscriptionDaysLabel, subscriptionUrl, tgUser, onSubscriptionChange, userIdentifier }: { t: any, direction: number; subscriptionEndDateLabel: string; subscriptionDaysLabel: string; subscriptionUrl: string | null; tgUser: { id: number; name: string; photo: string; username?: string } | null; onSubscriptionChange: (telegramId: number) => Promise<void>; userIdentifier: UserIdentifier | null }) {
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDevicesModal, setShowDevicesModal] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [devices, setDevices] = useState<{ id: number; device_name: string | null; key_uri: string; is_active: boolean; created_at: string }[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceOS, setDeviceOS] = useState<'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'>('unknown');
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [setupRegion, setSetupRegion] = useState<'global' | 'russia'>('global');
  const [vpnKey, setVpnKey] = useState<string | null>(null);
  const [vpnKeyLoading, setVpnKeyLoading] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const userQuery = userIdentifier
    ? (userIdentifier.type === 'telegram' ? `telegramId=${encodeURIComponent(String(userIdentifier.telegramId))}` : `userId=${encodeURIComponent(String(userIdentifier.userId))}`)
    : (tgUser ? `telegramId=${encodeURIComponent(String(tgUser.id))}` : '');

  const fetchDevices = async () => {
    if (!userQuery) return;
    setDevicesLoading(true);
    try {
      const res = await fetch(`/api/users/devices?${userQuery}`);
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices ?? []);
      } else {
        setDevices([]);
      }
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  };

  const handleDevicesClick = () => {
    setShowDevicesModal(true);
    fetchDevices();
  };

  const handleDeleteDevice = async (deviceId: number) => {
    if (!userQuery) return;
    if (!confirm(t.deleteDeviceConfirm)) return;
    try {
      const res = await fetch(`/api/users/devices?${userQuery}&deviceId=${deviceId}`, { method: 'DELETE' });
      if (res.ok) {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      }
    } catch { /* ignore */ }
  };

  const detectDevice = (): 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown' => {
    if (typeof window === 'undefined') return 'unknown';
    const ua = navigator.userAgent;
    
    // Check for iOS first (iPhone, iPad, iPod)
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      return 'ios';
    }
    // Check for Android
    if (/Android/.test(ua)) {
      return 'android';
    }
    // Check for Windows
    if (/Windows NT/.test(ua)) {
      return 'windows';
    }
    // Check for macOS
    if (/Mac OS X/.test(ua) && !/like Mac OS X/.test(ua)) {
      return 'macos';
    }
    // Check for Linux (not Android)
    if (/Linux/.test(ua) && !/Android/.test(ua)) {
      return 'linux';
    }
    return 'unknown';
  };

  const handleInstallClick = () => {
    const os = detectDevice();
    setDeviceOS(os);
    setSetupStep(1);
    setShowDevicePicker(false);
    setShowSetupModal(true);
  };

  const fetchVpnKey = async () => {
    if (!tgUser?.id) return;
    setVpnKeyLoading(true);
    setKeyCopied(false);
    try {
      if (subscriptionUrl) {
        setVpnKey(subscriptionUrl);
        return;
      }

      const res = await fetch(`/api/users/devices?telegramId=${encodeURIComponent(String(tgUser.id))}`);
      if (res.ok) {
        const data = await res.json();
        const activeDevice = (data.devices ?? []).find((d: { is_active: boolean; key_uri: string }) => d.is_active && d.key_uri && !d.key_uri.startsWith('pending://'));
        setVpnKey(activeDevice?.key_uri ?? null);
      } else {
        setVpnKey(null);
      }
    } catch {
      setVpnKey(null);
    } finally {
      setVpnKeyLoading(false);
    }
  };

  const copyKey = async () => {
    if (!vpnKey) return;
    try {
      await navigator.clipboard.writeText(vpnKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 3000);
    } catch { /* ignore */ }
  };

  const closeSetupModal = () => {
    setShowSetupModal(false);
    setSetupStep(1);
    setShowDevicePicker(false);
    setVpnKey(null);
    setKeyCopied(false);
  };

  const getDeviceLabel = () => {
    switch (deviceOS) {
      case 'windows': return t.setupWindows;
      case 'macos': return t.setupMacos;
      case 'linux': return t.setupLinux;
      case 'android': return t.setupAndroid;
      case 'ios': return t.setupIos;
      default: return t.setupUnknown;
    }
  };

  const getDeviceIcon = () => {
    switch (deviceOS) {
      case 'windows': return <Monitor size={20} className="text-white sm:w-[34px] sm:h-[34px]" />;
      case 'macos': return <Laptop size={20} className="text-white sm:w-[34px] sm:h-[34px]" />;
      case 'linux': return <Monitor size={20} className="text-white sm:w-[34px] sm:h-[34px]" />;
      case 'android': return <SmartphoneIcon size={20} className="text-white sm:w-[34px] sm:h-[34px]" />;
      case 'ios': return <SmartphoneIcon size={20} className="text-white sm:w-[34px] sm:h-[34px]" />;
      default: return <MonitorSmartphone size={20} className="text-white sm:w-[34px] sm:h-[34px]" />;
    }
  };

  const getStoreLink = () => {
    if (deviceOS === 'android') {
      return 'https://play.google.com/store/apps/details?id=com.happproxy';
    }

    if (deviceOS === 'ios' || deviceOS === 'macos') {
      return setupRegion === 'russia'
        ? 'https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973'
        : 'https://apps.apple.com/us/app/happ-proxy-utility/id6504287215?l=ru';
    }

    return '';
  };

  const openStoreLink = () => {
    const link = getStoreLink();
    if (!link) return;

    if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(link);
      return;
    }

    if (typeof window !== 'undefined') {
      window.open(link, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePromoClick = () => {
    setPromoCode('');
    setPromoError(null);
    setShowPromoModal(true);
  };

  const closePromoModal = () => {
    setShowPromoModal(false);
    setPromoError(null);
    setPromoLoading(false);
  };

  const handleApplyPromo = async () => {
    if (!tgUser?.id || !promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const response = await fetch('/api/promos/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: tgUser.id,
          username: tgUser.username,
          photoUrl: tgUser.photo,
          code: promoCode.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPromoError(data.error || 'Ошибка применения промокода');
        return;
      }
      setPromoCode('');
      await onSubscriptionChange(tgUser.id);
      setShowPromoModal(false);
      alert(t.promoApplySuccess);
    } catch (error) {
      console.error('Promo apply error:', error);
      setPromoError('Ошибка применения промокода');
    } finally {
      setPromoLoading(false);
    }
  };

  return (
    <>
      {/* Setup Modal */}
      <AnimatePresence>
        {showSetupModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={closeSetupModal}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[55vh] sm:max-h-[88vh] overflow-y-auto rounded-3xl border border-white/15 bg-gradient-to-b from-[#151515] via-[#0b0b0b] to-[#020202] p-3 sm:p-6 shadow-2xl"
            >
              <div className="mb-3 sm:mb-6 flex items-center justify-between">
                {setupStep > 1 ? (
                  <button onClick={() => setSetupStep((setupStep - 1) as 1 | 2 | 3)} className="text-zinc-400 hover:text-white transition-colors text-sm">
                    ←
                  </button>
                ) : (
                  <div />
                )}
                <span className="text-zinc-500 text-xs uppercase tracking-widest">{setupStep} {t.setupStepOf} 3</span>
                <button onClick={closeSetupModal} className="text-zinc-400 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="mx-auto mb-2 sm:mb-6 flex h-14 w-14 sm:h-36 sm:w-36 items-center justify-center rounded-full border border-white/30 bg-white/5 relative">
                <div className="absolute inset-1 sm:inset-3 rounded-full border border-white/20" />
                <div className="absolute inset-2 sm:inset-6 rounded-full border border-white/15" />
                <div className="absolute inset-3.5 sm:inset-9 rounded-full border border-white/10" />
                <div className="relative z-10">{setupStep === 1 ? getDeviceIcon() : setupStep === 2 ? <Download size={18} className="text-white sm:w-[34px] sm:h-[34px]" /> : <Key size={18} className="text-white sm:w-[34px] sm:h-[34px]" />}</div>
              </div>

              {setupStep === 1 && (
                <>
                  <h3 className="text-lg sm:text-2xl font-bold text-center text-white mb-1.5 sm:mb-2">{t.setupFor} {getDeviceLabel()}</h3>
                  <p className="text-zinc-400 text-center text-xs sm:text-sm mb-3 sm:mb-6">{t.setupStepsHint}</p>

                  <div className="space-y-2">
                    <button
                      onClick={() => setSetupStep(2)}
                      className="w-full bg-gradient-to-r from-white/25 to-white/10 border border-white/25 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm sm:text-base"
                    >
                      <ArrowRight size={14} className="sm:w-4 sm:h-4" /> {t.setupStart}
                    </button>

                    <button
                      onClick={() => setShowDevicePicker((prev) => !prev)}
                      className="w-full border border-white/20 text-white font-medium py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 transition-colors hover:text-white hover:border-white/25"
                    >
                      <MonitorSmartphone size={14} className="sm:w-4 sm:h-4" /> {t.setupOtherDevice}
                    </button>
                  </div>

                  {showDevicePicker && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-900/50 p-3">
                      <p className="text-zinc-400 text-xs uppercase tracking-wider mb-2">{t.setupChooseDevice}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setDeviceOS('windows')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'windows' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Windows</button>
                        <button onClick={() => setDeviceOS('macos')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'macos' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>macOS</button>
                        <button onClick={() => setDeviceOS('android')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'android' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Android</button>
                        <button onClick={() => setDeviceOS('ios')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'ios' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>iPhone/iPad</button>
                        <button onClick={() => setDeviceOS('linux')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'linux' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Linux</button>
                        <button onClick={() => setDeviceOS('unknown')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'unknown' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Other</button>
                      </div>

                      <div className="mt-3 pt-3 border-t border-white/10">
                        {vpnKeyLoading ? (
                          <div className="text-center py-2 text-zinc-400 text-xs">{t.setupKeyLoading}</div>
                        ) : vpnKey ? (
                          <>
                            <div className="rounded-lg border border-white/10 bg-zinc-800/60 p-2.5 mb-2">
                              <p className="text-zinc-300 text-[10px] font-mono break-all leading-relaxed select-all">{vpnKey}</p>
                            </div>
                            <button
                              onClick={copyKey}
                              className={`w-full font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm active:scale-95 transition-all ${keyCopied ? 'bg-green-500/20 border border-green-500/30 text-green-300' : 'border border-white/15 text-white hover:bg-white/5'}`}
                            >
                              {keyCopied ? <><ClipboardCheck size={14} /> {subscriptionUrl ? t.setupLinkCopied : t.setupKeyCopied}</> : <><Copy size={14} /> {subscriptionUrl ? t.setupCopyLink : t.setupCopyForOther}</>}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={fetchVpnKey}
                            className="w-full border border-white/15 text-zinc-300 font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm hover:bg-white/5 active:scale-95"
                          >
                            <Key size={14} /> {t.setupCopyForOther}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {setupStep === 2 && (
                <>
                  <h3 className="text-lg sm:text-2xl font-bold text-center text-white mb-1.5 sm:mb-2">{t.setupInstallTitle}</h3>
                  <p className="text-zinc-400 text-center text-xs sm:text-sm mb-3 sm:mb-5">{t.setupInstallDesc}</p>

                  {(deviceOS === 'ios' || deviceOS === 'macos') && (
                    <div className="mb-4">
                      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2">{t.setupRegion}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setSetupRegion('global')} className={`rounded-lg border px-3 py-2 text-sm ${setupRegion === 'global' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>{t.setupGlobal}</button>
                        <button onClick={() => setSetupRegion('russia')} className={`rounded-lg border px-3 py-2 text-sm ${setupRegion === 'russia' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>{t.setupRussia}</button>
                      </div>
                    </div>
                  )}

                  {!getStoreLink() && <p className="text-amber-300 text-xs mb-4">{t.setupNoStore}</p>}

                  <div className="space-y-2">
                    <button
                      onClick={openStoreLink}
                      disabled={!getStoreLink()}
                      className="w-full border border-white/20 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40 text-sm sm:text-base"
                    >
                      <Download size={14} className="sm:w-4 sm:h-4" /> {t.setupInstallButton}
                    </button>

                    <button
                      onClick={() => { setSetupStep(3); fetchVpnKey(); }}
                      className="w-full bg-gradient-to-r from-white/25 to-white/10 border border-white/25 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm sm:text-base"
                    >
                      <ArrowRight size={14} className="sm:w-4 sm:h-4" /> {t.setupNext}
                    </button>
                  </div>
                </>
              )}

              {setupStep === 3 && (
                <>
                  <h3 className="text-lg sm:text-2xl font-bold text-center text-white mb-1.5 sm:mb-2">{t.setupAddTitle}</h3>
                  <p className="text-zinc-400 text-center text-xs sm:text-sm mb-3 sm:mb-4">{subscriptionUrl ? 'Скопируйте ссылку подписки и вставьте её в приложение Happ.' : t.setupAddDesc}</p>

                  {vpnKeyLoading ? (
                    <div className="text-center py-4 text-zinc-400 text-sm">{t.setupKeyLoading}</div>
                  ) : vpnKey ? (
                    <div className="mb-4">
                      <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3 mb-3">
                        <p className="text-zinc-500 text-[9px] uppercase tracking-wider mb-1.5">{subscriptionUrl ? 'Subscription URL' : 'VLESS Key'}</p>
                        <p className="text-zinc-300 text-[11px] font-mono break-all leading-relaxed select-all">{vpnKey}</p>
                      </div>
                      <button
                        onClick={copyKey}
                        className={`w-full font-semibold py-3 rounded-full flex items-center justify-center gap-2 active:scale-95 transition-all ${keyCopied ? 'bg-green-500/20 border border-green-500/30 text-green-300' : 'border border-white/20 text-white hover:bg-white/5'}`}
                      >
                        {keyCopied ? <><ClipboardCheck size={16} /> {subscriptionUrl ? t.setupLinkCopied : t.setupKeyCopied}</> : <><Copy size={16} /> {subscriptionUrl ? t.setupCopyLink : t.setupAddButton}</>}
                      </button>
                    </div>
                  ) : (
                    <p className="text-amber-300 text-xs text-center mb-4">{t.setupNoKey}</p>
                  )}

                  <button
                    onClick={closeSetupModal}
                    className="w-full bg-gradient-to-r from-white/25 to-white/10 border border-white/25 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm sm:text-base"
                  >
                    <ArrowRight size={14} className="sm:w-4 sm:h-4" /> {t.setupFinish}
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div 
        custom={direction}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex flex-col items-center gap-6 flex-1 lg:pt-6 w-full"
      >
        {/* Logo */}
        <motion.div
          className="relative w-40 h-40 lg:w-[260px] lg:h-[260px]"
        >
          <div className="absolute inset-0 rounded-full bg-white/10 blur-xl" />
          <div className="w-full h-full relative z-10">
            <Image 
              src="/logo.png" 
              alt="Hundler VPN Logo" 
              fill 
              className="object-contain"
              referrerPolicy="no-referrer"
              priority
            />
          </div>
        </motion.div>

        {/* Info Card */}
        <div className="w-full max-w-[320px] lg:max-w-[540px] bg-gradient-to-b from-[#161616]/95 via-[#0b0b0b]/95 to-[#020202]/95 border border-white/15 rounded-2xl p-3 lg:p-5 shadow-lg relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-white/5 pointer-events-none rounded-2xl" />
          
          <div className="flex justify-between items-start mb-3 relative z-10">
            <h3 className="text-lg font-bold text-white">{t.planName}</h3>
            <div className="text-right flex flex-col items-end">
              <span className="text-zinc-500 text-[8px] uppercase tracking-widest mb-0.5">{t.until}</span>
              <div className="text-white/60 text-[11px] font-medium flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                {subscriptionEndDateLabel} <Calendar size={10} className="text-zinc-500"/>
              </div>
              <div className="mt-1 text-white/60 text-[10px] font-medium bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                {subscriptionDaysLabel}
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-1 bg-white/10 border border-white/20 px-2 py-0.5 rounded-md mb-4 relative z-10">
            <Smartphone size={10} className="text-white" />
            <span className="text-white text-[10px] font-medium">{t.devices}</span>
          </div>

          <div className="space-y-2 relative z-10">
            <button className="w-full bg-gradient-to-r from-white/20 via-white/15 to-white/10 border border-white/25 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-1.5 active:scale-95 text-sm transition-transform hover:-translate-y-0.5">
              <Zap size={14} /> <span>{t.extend}</span>
            </button>
            
            <button onClick={handleInstallClick} className="w-full bg-zinc-800/50 border border-white/10 text-white font-medium py-2 rounded-xl flex items-center justify-center gap-1.5 active:scale-95 text-[13px] transition-colors hover:border-white/30 hover:bg-zinc-800/70 lg:py-2.5 lg:text-sm">
              <Settings size={14} className="text-zinc-400" /> {t.install}
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={handlePromoClick} className="bg-zinc-900/80 border border-white/5 text-zinc-300 text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-colors hover:text-white hover:border-white/25">
                <Gift size={12} className="text-zinc-500" /> {t.promo}
              </button>
              <button onClick={handleDevicesClick} className="bg-zinc-900/80 border border-white/5 text-zinc-300 text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-colors hover:text-white hover:border-white/25">
                <MonitorSmartphone size={12} className="text-zinc-500" /> {t.myDevices}
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Promo Modal */}
      <AnimatePresence>
        {showPromoModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={closePromoModal}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl border border-white/15 bg-gradient-to-b from-[#151515] via-[#0b0b0b] to-[#020202] p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-white">{t.promo}</h3>
                <button onClick={closePromoModal} className="text-zinc-400 hover:text-white transition-colors"><X size={20} /></button>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  placeholder={t.promoPlaceholder}
                  className="w-full bg-zinc-800/60 border border-white/10 rounded-xl px-3 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                />

                {promoError && <p className="text-red-300 text-xs">{promoError}</p>}

                <button
                  onClick={handleApplyPromo}
                  disabled={promoLoading || !promoCode.trim() || !tgUser?.id}
                  className="w-full px-3 py-3 rounded-xl bg-white/10 border border-white/15 text-white text-sm hover:bg-white/15 disabled:opacity-50"
                >
                  {promoLoading ? '...' : t.promoApply}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Devices Modal */}
      <AnimatePresence>
        {showDevicesModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDevicesModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-3xl border border-white/15 bg-gradient-to-b from-[#151515] via-[#0b0b0b] to-[#020202] p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-white">{t.myDevices}</h3>
                <button onClick={() => setShowDevicesModal(false)} className="text-zinc-400 hover:text-white transition-colors"><X size={20} /></button>
              </div>

              {devicesLoading ? (
                <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
              ) : devices.length === 0 ? (
                <div className="text-center py-8">
                  <MonitorSmartphone size={40} className="text-zinc-600 mx-auto mb-3" />
                  <p className="text-zinc-400 text-sm">Нет подключённых устройств</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {devices.map((device) => (
                    <div key={device.id} className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-zinc-900/50">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${device.is_active ? 'bg-white/10 border border-white/25' : 'bg-zinc-800 border border-white/10'}`}>
                        <MonitorSmartphone size={18} className={device.is_active ? 'text-white' : 'text-zinc-500'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{device.device_name || 'Устройство'}</p>
                        <p className="text-[10px] text-zinc-500">{new Date(device.created_at).toLocaleDateString('ru-RU')}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className={`text-[9px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ${device.is_active ? 'text-white bg-white/15' : 'text-zinc-500 bg-zinc-800'}`}>
                          {device.is_active ? 'Активно' : 'Неактивно'}
                        </div>
                        <button
                          onClick={() => handleDeleteDevice(device.id)}
                          className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                          title={t.deleteDevice}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function PaymentView({ t, direction, tgUser, onSubscriptionChange }: { t: any, direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; onSubscriptionChange: (telegramId: number) => Promise<void> }) {
  const [months, setMonths] = useState(1);
  const [payMethod, setPayMethod] = useState<'tg' | 'crypto' | 'sbp'>('tg');
  const [isLoading, setIsLoading] = useState(false);

  const basePrice = 1; 
  const discountPerMonth = 0; 
  const pricePerMonth = Math.max(1, basePrice - (months - 1) * discountPerMonth);
  const totalPrice = pricePerMonth * months;

  const handleSubscribe = async () => {
    setIsLoading(true);
    try {
      if (payMethod === 'tg') {
        const response = await fetch('/api/invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            months,
            amount: 1,
          }),
        });
        const data = await response.json();
        if (data.invoiceLink) {
          if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
            try {
              const result = await window.Telegram.WebApp.openInvoice(data.invoiceLink);
              if (result.status === 'paid') {
                if (tgUser?.id) {
                  setTimeout(() => {
                    void onSubscriptionChange(tgUser.id);
                  }, 1500);
                }
                alert('Оплата прошла успешно!');
              } else if (result.status === 'cancelled') {
                alert('Оплата отменена');
              } else if (result.status === 'failed') {
                alert('Ошибка оплаты');
              }
            } catch (e) {
              console.error('Invoice error:', e);
              alert('Не удалось открыть окно оплаты');
            }
          } else {
            window.location.href = data.invoiceLink;
          }
        } else {
          alert(data.error || 'Ошибка создания счета');
        }
      } else if (payMethod === 'crypto') {
        const response = await fetch('/api/crypto-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            months,
            amount: 0.5,
          }),
        });
        const data = await response.json();
        if (data.paymentUrl) {
          // Use Telegram WebApp openLink if available, otherwise redirect
          if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
            window.Telegram.WebApp.openLink(data.paymentUrl);
          } else {
            window.location.href = data.paymentUrl;
          }
        } else {
          alert(data.error || 'Ошибка создания крипто-счета');
        }
      } else {
        alert('Этот метод оплаты пока не реализован');
      }
    } catch (error) {
      console.error('Payment error:', error);
      alert('Произошла ошибка');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div 
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col gap-3 flex-1 lg:items-center"
    >
      <div className="w-full max-w-xs mx-auto flex flex-col lg:max-w-[720px]">
        <motion.div 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.25 }}
          className="bg-zinc-900/40 border border-white/10 rounded-xl p-3 mb-3 lg:p-6"
        >
          <div className="flex justify-between items-end mb-3">
            <div>
              <span className="text-2xl font-bold text-white lg:text-4xl">{months}</span>
              <span className="text-zinc-400 ml-1 text-xs">{t.months}</span>
            </div>
            <div className="text-right">
              <div className="text-lg font-medium text-white lg:text-3xl">{pricePerMonth}₽ <span className="text-[10px] text-zinc-500 lg:text-xs">{t.perMonth}</span></div>
            </div>
          </div>
          
          <input 
            type="range" min="1" max="12" value={months} 
            onChange={(e) => setMonths(parseInt(e.target.value))}
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
            style={{ background: `linear-gradient(to right, #fff ${(months - 1) / 11 * 100}%, #27272a ${(months - 1) / 11 * 100}%)` }}
          />
          <div className="flex justify-between text-zinc-600 text-[10px] mt-1.5 font-medium">
            <span>1 {t.months}</span>
            <span>12 {t.months}</span>
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
            <span className="text-zinc-400 text-xs">{t.total}</span>
            <span className="text-base font-bold text-white">{totalPrice}₽</span>
          </div>
        </motion.div>

        <motion.div 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.25 }}
          className="grid grid-cols-3 gap-1.5 mb-3 lg:gap-3"
        >
          <PaymentMethodBtn icon={<Star size={16} className={payMethod === 'tg' ? "text-yellow-400" : "text-zinc-500"} />} label={t.payTg} isActive={payMethod === 'tg'} onClick={() => setPayMethod('tg')} />
          <PaymentMethodBtn icon={<Bitcoin size={16} className={payMethod === 'crypto' ? "text-orange-400" : "text-zinc-500"} />} label={t.payCrypto} isActive={payMethod === 'crypto'} onClick={() => setPayMethod('crypto')} />
          <PaymentMethodBtn icon={<Wallet size={16} className={payMethod === 'sbp' ? "text-blue-400" : "text-zinc-500"} />} label={t.paySbp} isActive={payMethod === 'sbp'} onClick={() => setPayMethod('sbp')} />
        </motion.div>
      </div>

      <div className="w-full max-w-xs mx-auto flex flex-col lg:max-w-[720px]">
        <h3 className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2">{t.featTitle}</h3>
        <motion.ul variants={listVariants} initial="hidden" animate="visible" className="space-y-1.5">
          <motion.li variants={itemVariants}><FeatureItem text={t.f1} /></motion.li>
          <motion.li variants={itemVariants}><FeatureItem text={t.f2} /></motion.li>
          <motion.li variants={itemVariants}><FeatureItem text={t.f3} /></motion.li>
        </motion.ul>

        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2, duration: 0.25 }} className="mt-3">
          <button onClick={handleSubscribe} disabled={isLoading} className="w-full bg-white text-black font-medium py-3 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 text-sm">
            {isLoading ? 'Загрузка...' : t.subscribe}
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}

const PaymentMethodBtn = memo(function PaymentMethodBtn({ icon, label, isActive, onClick }: { icon: React.ReactNode; label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all gap-1 active:scale-95 ${isActive ? 'bg-zinc-900 border-white/20' : 'bg-zinc-950/50 border-white/5 hover:bg-zinc-900/50'}`}>
      {icon}
      <span className={`text-[8px] font-medium uppercase tracking-wider text-center ${isActive ? 'text-white' : 'text-zinc-500'}`}>{label}</span>
    </button>
  );
});

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-3.5 h-3.5 rounded-full bg-[#3B82F6]/10 flex items-center justify-center shrink-0 border border-[#3B82F6]/20">
        <Check size={8} strokeWidth={2.5} className="text-[#00D1FF]" />
      </div>
      <span className="text-zinc-300 text-xs">{text}</span>
    </div>
  );
}

function ProfileView({ t, lang, setLang, direction, tgUser, subscriptionDaysLabel, navigate, authMode, onLogout }: { t: any; lang: string; setLang: (l: 'ru' | 'en') => void; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; subscriptionDaysLabel: string; navigate: (tab: Tab) => void; authMode?: AuthMode; onLogout?: () => void }) {
  const handleReferralClick = async () => {
    if (!tgUser?.id) return;

    const code = `u${tgUser.id.toString(36)}`;
    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'hundlervpn_bot';
    const referralUrl = `https://t.me/${botUsername}?startapp=ref_${code}`;

    try {
      await navigator.clipboard.writeText(referralUrl);
      alert(t.referralCopied);
    } catch {
      if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
        window.Telegram.WebApp.openLink(referralUrl);
      } else if (typeof window !== 'undefined') {
        window.open(referralUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  return (
    <>
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center">
      <div className="w-full max-w-xs lg:max-w-[560px]">
        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1, duration: 0.25 }} className="flex items-center gap-3 mb-4 bg-zinc-900/40 p-3 rounded-xl border border-white/5">
          <div className="w-12 h-12 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
            {tgUser?.photo ? (
              <img src={tgUser.photo} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <User size={24} strokeWidth={1.5} className="text-zinc-400" />
            )}
          </div>
          <div>
            <h2 className="text-base font-medium text-white">{tgUser?.name || 'User'}</h2>
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
              <div className="w-1 h-1 rounded-full bg-[#00D1FF]" />
              <span className="text-zinc-300 text-[9px] font-medium uppercase tracking-wider">{subscriptionDaysLabel}</span>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.25 }} className="space-y-3">
          <div>
            <h3 className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2 px-2">{t.app}</h3>
            <div className="bg-zinc-900/40 border border-white/5 rounded-xl overflow-hidden">
              <button onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors active:scale-[0.98]">
                <div className="flex items-center gap-2">
                  <Globe size={18} strokeWidth={1.5} className="text-zinc-400" />
                  <span className="text-zinc-200 font-medium text-sm">{t.lang}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500 text-xs">{lang === 'ru' ? 'Русский' : 'English'}</span>
                  <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
                </div>
              </button>
              <div className="h-px bg-white/5 mx-3" />
              <a href="https://t.me/hundlervpn" target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-2">
                  <HelpCircle size={18} strokeWidth={1.5} className="text-zinc-400" />
                  <span className="text-zinc-200 font-medium text-sm">{t.support}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </a>
              <div className="h-px bg-white/5 mx-3" />
              <button onClick={handleReferralClick} className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors active:scale-[0.98]">
                <div className="flex items-center gap-2">
                  <Gift size={18} strokeWidth={1.5} className="text-zinc-400" />
                  <span className="text-zinc-200 font-medium text-sm">{t.referral}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
              <div className="h-px bg-white/5 mx-3" />
              <button onClick={() => navigate('payments')} className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors active:scale-[0.98]">
                <div className="flex items-center gap-2">
                  <CreditCard size={18} strokeWidth={1.5} className="text-zinc-400" />
                  <span className="text-zinc-200 font-medium text-sm">{t.payments}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
              <div className="h-px bg-white/5 mx-3" />
              <a href="https://telegra.ph/Polzovatelskoe-soglashenie-Hundler-VPN-03-21" target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors active:scale-[0.98]">
                <div className="flex items-center gap-2">
                  <FileText size={18} strokeWidth={1.5} className="text-zinc-400" />
                  <span className="text-zinc-200 font-medium text-sm">{t.userAgreement}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </a>
              <div className="h-px bg-white/5 mx-3" />
              <a href="https://telegra.ph/Politika-konfidencialnosti-Hundler-VPN-03-21" target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors active:scale-[0.98]">
                <div className="flex items-center gap-2">
                  <Lock size={18} strokeWidth={1.5} className="text-zinc-400" />
                  <span className="text-zinc-200 font-medium text-sm">{t.privacyPolicy}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2 px-2">{t.serversTitle}</h3>
            <div className="bg-zinc-900/40 border border-white/5 rounded-xl overflow-hidden">
              <button onClick={() => navigate('servers')} className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors active:scale-[0.98]">
                <div className="flex items-center gap-2">
                  <Globe size={18} strokeWidth={1.5} className="text-zinc-400" />
                  <span className="text-zinc-200 font-medium text-sm">{t.serversTitle}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
            </div>
          </div>

          {tgUser && ADMIN_TELEGRAM_IDS.includes(tgUser.id) && (
            <div className="mt-3">
              <h3 className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest mb-2 px-2">Admin</h3>
              <div className="bg-zinc-900/40 border border-white/5 rounded-xl overflow-hidden">
                <button onClick={() => navigate('admin')} className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors active:scale-[0.98]">
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={18} strokeWidth={1.5} className="text-red-400" />
                    <span className="text-zinc-200 font-medium text-sm">{t.adminPanel}</span>
                  </div>
                  <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
                </button>
              </div>
            </div>
          )}

          {authMode === 'email' && onLogout && (
            <div className="mt-3">
              <button onClick={onLogout} className="w-full bg-zinc-900/40 border border-white/5 rounded-xl p-3 flex items-center justify-center gap-2 hover:bg-red-500/10 hover:border-red-500/20 transition-colors active:scale-[0.98]">
                <LogOut size={16} strokeWidth={1.5} className="text-red-400" />
                <span className="text-red-400 font-medium text-sm">{lang === 'ru' ? 'Выйти' : 'Log out'}</span>
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
    </>
  );
}

function PaymentsHistoryView({ t, direction, tgUser, navigate, lang }: { t: any; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; navigate: (tab: Tab) => void; lang: 'ru' | 'en' }) {
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [payments, setPayments] = useState<{ id: number; amount: string; currency: string; status: string; provider: string; paid_at: string | null; created_at: string }[]>([]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (!tgUser?.id) {
        if (isMounted) setPayments([]);
        return;
      }

      setPaymentsLoading(true);
      try {
        const res = await fetch(`/api/users/payments?telegramId=${encodeURIComponent(String(tgUser.id))}`);
        if (!res.ok) {
          if (isMounted) setPayments([]);
          return;
        }
        const data = await res.json();
        if (isMounted) setPayments(data.payments ?? []);
      } catch {
        if (isMounted) setPayments([]);
      } finally {
        if (isMounted) setPaymentsLoading(false);
      }
    };

    void load();
    return () => {
      isMounted = false;
    };
  }, [tgUser?.id]);

  return (
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center w-full">
      <div className="w-full max-w-xs lg:max-w-[560px]">
        <button onClick={() => navigate('profile')} className="mb-3 text-zinc-300 hover:text-white text-sm inline-flex items-center gap-2">
          <ChevronRight size={14} className="rotate-180" /> {t.backToProfile}
        </button>

        <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
          <h3 className="text-lg font-bold text-white mb-4">{t.paymentsHistoryTitle}</h3>

          {paymentsLoading ? (
            <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
          ) : payments.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 text-sm">{t.noPaymentsYet}</div>
          ) : (
            <div className="space-y-2">
              {payments.map((payment) => (
                <div key={payment.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-medium text-sm">{Number(payment.amount)} {payment.currency}</span>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${payment.status === 'paid' ? 'bg-white/15 text-white' : 'bg-zinc-800 text-zinc-400'}`}>{payment.status}</span>
                  </div>
                  <div className="text-[11px] text-zinc-400">{payment.provider}</div>
                  <div className="text-[10px] text-zinc-500 mt-1 flex items-center gap-1">
                    <Calendar size={11} />
                    {new Date(payment.paid_at || payment.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

type AdminStats = {
  totalUsers: number;
  todayUsers: number;
  bannedUsers: number;
  totalRevenue: number;
  totalPayments: number;
  paidPayments: number;
  activeSubscriptions: number;
};

type AdminUser = {
  id: string;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  is_banned: boolean;
  ban_reason: string | null;
  created_at: string;
  last_seen_at: string;
  total_paid: string;
  payments_count: string;
  subscription_status: string | null;
  subscription_end: string | null;
};

type AdminPromo = {
  id: number;
  code: string;
  days: number;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
};

function AdminView({ t, direction, tgUser, navigate, lang }: { t: any; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; navigate: (tab: Tab) => void; lang: 'ru' | 'en' }) {
  const [adminTab, setAdminTab] = useState<'stats' | 'users' | 'promos'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotalPages, setUsersTotalPages] = useState(1);
  const [promos, setPromos] = useState<AdminPromo[]>([]);
  const [promosLoading, setPromosLoading] = useState(false);
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoDays, setPromoDays] = useState('7');
  const [promoMaxUses, setPromoMaxUses] = useState('100');
  const [promoCreating, setPromoCreating] = useState(false);
  const [banningId, setBanningId] = useState<number | null>(null);

  const tgId = tgUser?.id;

  const loadStats = async () => {
    if (!tgId) return;
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/admin/stats?telegramId=${tgId}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      }
    } catch { /* ignore */ } finally { setStatsLoading(false); }
  };

  const loadUsers = async (page = 1, search = '') => {
    if (!tgId) return;
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ telegramId: String(tgId), page: String(page) });
      if (search) params.set('search', search);
      const res = await fetch(`/api/admin/users?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
        setUsersTotalPages(data.totalPages ?? 1);
        setUsersPage(data.page ?? 1);
      }
    } catch { /* ignore */ } finally { setUsersLoading(false); }
  };

  const loadPromos = async () => {
    if (!tgId) return;
    setPromosLoading(true);
    try {
      const res = await fetch(`/api/admin/promos?telegramId=${tgId}`);
      if (res.ok) {
        const data = await res.json();
        setPromos(data.promos ?? []);
      }
    } catch { /* ignore */ } finally { setPromosLoading(false); }
  };

  const handleBan = async (userId: number | string, ban: boolean) => {
    if (!tgId) return;
    const normalizedUserId = typeof userId === 'string' ? Number(userId) : userId;
    if (!Number.isFinite(normalizedUserId)) {
      alert('Invalid user id');
      return;
    }

    setBanningId(normalizedUserId);
    try {
      const res = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, targetUserId: normalizedUserId, ban }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Error' }));
        alert(data.error || 'Error');
        return;
      }

      await loadUsers(usersPage, usersSearch);
    } catch { /* ignore */ } finally { setBanningId(null); }
  };

  const handleCreatePromo = async () => {
    if (!tgId || !promoCode.trim() || !promoDays) return;
    setPromoCreating(true);
    try {
      const res = await fetch('/api/admin/promos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: tgId,
          code: promoCode.trim(),
          days: Number(promoDays),
          maxUses: Number(promoMaxUses) || 100,
        }),
      });
      if (res.ok) {
        setPromoCode('');
        setPromoDays('7');
        setPromoMaxUses('100');
        setShowPromoForm(false);
        await loadPromos();
      } else {
        const data = await res.json();
        alert(data.error || 'Error');
      }
    } catch { /* ignore */ } finally { setPromoCreating(false); }
  };

  const handleDeletePromo = async (promoId: number) => {
    if (!tgId) return;
    try {
      await fetch(`/api/admin/promos?telegramId=${tgId}&promoId=${promoId}`, { method: 'DELETE' });
      await loadPromos();
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (adminTab === 'stats') loadStats();
    else if (adminTab === 'users') loadUsers(1, usersSearch);
    else if (adminTab === 'promos') loadPromos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, tgId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadUsers(1, usersSearch);
  };

  return (
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center w-full">
      <div className="w-full max-w-xs lg:max-w-[640px]">
        <button onClick={() => navigate('profile')} className="mb-3 text-zinc-300 hover:text-white text-sm inline-flex items-center gap-2">
          <ChevronRight size={14} className="rotate-180" /> {t.adminBackToProfile}
        </button>

        <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4 mb-4">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <ShieldAlert size={20} className="text-red-400" />
            {t.adminPanel}
          </h3>

          {/* Admin Sub-tabs */}
          <div className="grid grid-cols-3 gap-1.5 mb-4">
            <button onClick={() => setAdminTab('stats')} className={`text-xs font-medium py-2 rounded-lg border transition-all ${adminTab === 'stats' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              {t.adminStats}
            </button>
            <button onClick={() => setAdminTab('users')} className={`text-xs font-medium py-2 rounded-lg border transition-all ${adminTab === 'users' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              {t.adminUsers}
            </button>
            <button onClick={() => setAdminTab('promos')} className={`text-xs font-medium py-2 rounded-lg border transition-all ${adminTab === 'promos' ? 'bg-white/10 border-white/25 text-white' : 'border-white/5 text-zinc-400 hover:text-white'}`}>
              {t.adminPromos}
            </button>
          </div>

          {/* Stats Tab */}
          {adminTab === 'stats' && (
            statsLoading ? (
              <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
            ) : stats ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={14} className="text-blue-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminTotalUsers}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.totalUsers}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={14} className="text-green-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminTodayUsers}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.todayUsers}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Ban size={14} className="text-red-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminBannedUsers}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.bannedUsers}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CreditCard size={14} className="text-yellow-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminRevenue}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.totalRevenue}₽</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap size={14} className="text-cyan-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminActiveSubs}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.activeSubscriptions}</span>
                </div>
                <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Check size={14} className="text-emerald-400" />
                    <span className="text-zinc-400 text-[10px] uppercase tracking-wider">{t.adminPaidPayments}</span>
                  </div>
                  <span className="text-white text-xl font-bold">{stats.paidPayments}</span>
                </div>
              </div>
            ) : null
          )}

          {/* Users Tab */}
          {adminTab === 'users' && (
            <div>
              <form onSubmit={handleSearchSubmit} className="mb-3 flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={usersSearch}
                    onChange={(e) => setUsersSearch(e.target.value)}
                    placeholder={t.adminSearchUsers}
                    className="w-full bg-zinc-800/60 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                  />
                </div>
                <button type="submit" className="bg-white/10 border border-white/15 text-white px-3 rounded-lg text-sm hover:bg-white/15">
                  <Search size={14} />
                </button>
              </form>

              {usersLoading ? (
                <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
              ) : users.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-sm">{t.adminNoUsers}</div>
              ) : (
                <div className="space-y-2">
                  {users.map((u) => (
                    <div key={u.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-white text-sm font-medium truncate">
                            {[u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || `ID ${u.telegram_id}`}
                          </p>
                          <p className="text-zinc-500 text-[10px]">
                            {u.username ? `@${u.username}` : ''} · TG: {u.telegram_id}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {u.is_banned ? (
                            <button
                              onClick={() => handleBan(u.id, false)}
                              disabled={banningId === Number(u.id)}
                              className="text-[10px] px-2 py-1 rounded-md bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50"
                            >
                              {t.adminUnban}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleBan(u.id, true)}
                              disabled={banningId === Number(u.id)}
                              className="text-[10px] px-2 py-1 rounded-md bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50"
                            >
                              {t.adminBan}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-400">
                        <span>💰 {Number(u.total_paid)}₽ ({u.payments_count} {lang === 'ru' ? 'пл.' : 'pay.'})</span>
                        <span>{u.subscription_status === 'active' && u.subscription_end && new Date(u.subscription_end) > new Date() ? `✅ ${lang === 'ru' ? 'до' : 'until'} ${new Date(u.subscription_end).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}` : `❌ ${lang === 'ru' ? 'Нет подписки' : 'No sub'}`}</span>
                        {u.is_banned && <span className="text-red-400">🚫 {lang === 'ru' ? 'Забанен' : 'Banned'}</span>}
                        <span>📅 {new Date(u.created_at).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                      </div>
                    </div>
                  ))}

                  {usersTotalPages > 1 && (
                    <div className="flex justify-center gap-2 pt-2">
                      <button
                        onClick={() => loadUsers(usersPage - 1, usersSearch)}
                        disabled={usersPage <= 1}
                        className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:bg-white/5 disabled:opacity-30"
                      >
                        ←
                      </button>
                      <span className="text-xs text-zinc-400 py-1.5">{usersPage} / {usersTotalPages}</span>
                      <button
                        onClick={() => loadUsers(usersPage + 1, usersSearch)}
                        disabled={usersPage >= usersTotalPages}
                        className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:bg-white/5 disabled:opacity-30"
                      >
                        →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Promos Tab */}
          {adminTab === 'promos' && (
            <div>
              <button
                onClick={() => setShowPromoForm(!showPromoForm)}
                className="w-full mb-3 bg-white/10 border border-white/15 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm hover:bg-white/15 active:scale-95"
              >
                <Plus size={14} /> {t.adminCreatePromo}
              </button>

              {showPromoForm && (
                <div className="mb-4 rounded-xl border border-white/10 bg-zinc-900/60 p-3 space-y-2.5">
                  <div>
                    <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1">{t.adminPromoCode}</label>
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="PROMO2024"
                      className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1">{t.adminPromoDays}</label>
                      <input
                        type="number"
                        value={promoDays}
                        onChange={(e) => setPromoDays(e.target.value)}
                        min="1"
                        className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1">{t.adminPromoMaxUses}</label>
                      <input
                        type="number"
                        value={promoMaxUses}
                        onChange={(e) => setPromoMaxUses(e.target.value)}
                        min="1"
                        className="w-full bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleCreatePromo}
                    disabled={promoCreating || !promoCode.trim() || !promoDays}
                    className="w-full bg-white text-black font-medium py-2.5 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 text-sm"
                  >
                    {promoCreating ? '...' : t.adminPromoCreate}
                  </button>
                </div>
              )}

              {promosLoading ? (
                <div className="text-center py-8 text-zinc-400 text-sm">Загрузка...</div>
              ) : promos.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-sm">{t.adminNoPromos}</div>
              ) : (
                <div className="space-y-2">
                  {promos.map((p) => (
                    <div key={p.id} className={`rounded-xl border p-3 ${p.is_active ? 'border-white/10 bg-zinc-900/60' : 'border-white/5 bg-zinc-900/30 opacity-60'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Tag size={12} className="text-cyan-400" />
                          <span className="text-white font-mono text-sm font-bold">{p.code}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${p.is_active ? 'bg-green-500/20 text-green-300' : 'bg-zinc-700 text-zinc-400'}`}>
                            {p.is_active ? 'Active' : 'Off'}
                          </span>
                          {p.is_active && (
                            <button onClick={() => handleDeletePromo(p.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-[10px] text-zinc-400">
                        <span>📅 {p.days} {lang === 'ru' ? 'дн.' : 'days'}</span>
                        <span>👥 {p.used_count}/{p.max_uses}</span>
                        <span>{new Date(p.created_at).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ServersView({ t, direction, navigate }: { t: any; direction: number; navigate: (tab: Tab) => void }) {
  const [servers, setServers] = useState<{ id: number; name: string; host: string; port: number; country: string; is_active: boolean; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const countryFlags: Record<string, string> = { NL: '\u{1F1F3}\u{1F1F1}', DE: '\u{1F1E9}\u{1F1EA}', US: '\u{1F1FA}\u{1F1F8}', FI: '\u{1F1EB}\u{1F1EE}', RU: '\u{1F1F7}\u{1F1FA}', GB: '\u{1F1EC}\u{1F1E7}', FR: '\u{1F1EB}\u{1F1F7}', SE: '\u{1F1F8}\u{1F1EA}', CA: '\u{1F1E8}\u{1F1E6}', JP: '\u{1F1EF}\u{1F1F5}', AU: '\u{1F1E6}\u{1F1FA}', SG: '\u{1F1F8}\u{1F1EC}' };
  const getFlag = (country: string) => countryFlags[country.toUpperCase()] || '\u{1F310}';

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/servers');
        if (res.ok) {
          const data = await res.json();
          setServers(data.servers ?? []);
        }
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  const activeCount = servers.filter(s => s.is_active).length;

  return (
    <motion.div
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.25 }}
      className="w-full max-w-md mx-auto"
    >
      <div className="px-4 pb-28 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => navigate('profile')} className="text-zinc-500 hover:text-white transition-colors p-1 -ml-1">
            <ChevronRight size={20} strokeWidth={1.5} className="rotate-180" />
          </button>
          <h2 className="text-white font-semibold text-lg">{t.serversTitle}</h2>
        </div>

        {!loading && servers.length > 0 && (
          <div className="flex items-center gap-3 px-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" />
              <span className="text-green-400 text-xs font-medium">{activeCount} {t.serverActive.toLowerCase()}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-red-400 text-xs font-medium">{servers.length - activeCount} {t.serverInactive.toLowerCase()}</span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-zinc-500 text-sm">...</div>
        ) : servers.length === 0 ? (
          <div className="text-center py-16">
            <Globe size={40} strokeWidth={1} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">{t.noServers}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {servers.map((srv) => (
              <div key={srv.id} className="bg-gradient-to-b from-zinc-900/60 to-zinc-900/30 border border-white/8 rounded-xl p-4 hover:border-white/15 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-zinc-800/80 border border-white/10 flex items-center justify-center text-xl">
                    {getFlag(srv.country)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white text-sm font-semibold truncate">{srv.name}</p>
                      <div className={`w-2 h-2 rounded-full shrink-0 ${srv.is_active ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.3)]'}`} />
                    </div>
                    <p className="text-zinc-500 text-xs mt-0.5">{srv.country} · {srv.host}</p>
                  </div>
                  <div className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-lg ${srv.is_active ? 'text-green-400 bg-green-400/10 border border-green-400/20' : 'text-red-400 bg-red-400/10 border border-red-400/20'}`}>
                    {srv.is_active ? t.serverActive : t.serverInactive}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function EmailAuthView({ lang, setLang, onLogin }: { lang: 'ru' | 'en'; setLang: (l: 'ru' | 'en') => void; onLogin: (user: { id: number; email: string; name: string }, sessionToken: string) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSendCode = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'ru' ? 'Ошибка' : 'Error'));
        return;
      }
      setStep('code');
      setCooldown(60);
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'ru' ? 'Неверный код' : 'Invalid code'));
        return;
      }
      onLogin(data.user, data.sessionToken);
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'ru' ? 'Ошибка' : 'Error'));
        return;
      }
      setCooldown(60);
      setCode('');
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#020202] flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-white/10 blur-[55px]" />
        <div className="absolute top-[40%] -right-[10%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-white/5 blur-[65px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-syncopate font-bold text-xl tracking-[0.12em] text-white mb-1">
            HUNDLER
            <span className="relative inline-block ml-1.5">
              <span className="absolute inset-0 bg-gradient-to-r from-white to-zinc-300 blur-sm opacity-35"></span>
              <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 via-white to-zinc-400">VPN</span>
            </span>
          </h1>
          <p className="text-zinc-500 text-xs mt-2">
            {lang === 'ru' ? 'Войдите или зарегистрируйтесь по email' : 'Sign in or register with email'}
          </p>
        </div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-gradient-to-b from-[#151515] via-[#0b0b0b] to-[#020202] border border-white/15 rounded-2xl p-5 shadow-2xl"
        >
          {step === 'email' ? (
            <>
              <div className="mb-4">
                <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                    placeholder="user@example.com"
                    autoFocus
                    className="w-full bg-zinc-800/60 border border-white/10 rounded-xl pl-10 pr-3 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25 transition-colors"
                  />
                </div>
              </div>

              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

              <button
                onClick={handleSendCode}
                disabled={loading || !email.trim()}
                className="w-full bg-gradient-to-r from-white/20 to-white/10 border border-white/25 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 text-sm transition-all"
              >
                {loading ? '...' : (lang === 'ru' ? 'Получить код' : 'Get code')}
              </button>
            </>
          ) : (
            <>
              <div className="mb-2">
                <p className="text-zinc-400 text-xs mb-3">
                  {lang === 'ru' ? 'Код отправлен на' : 'Code sent to'} <span className="text-white">{email}</span>
                </p>
                <button onClick={() => { setStep('email'); setError(null); setCode(''); }} className="text-zinc-500 text-[10px] hover:text-white transition-colors mb-3 inline-block">
                  {lang === 'ru' ? '← Изменить email' : '← Change email'}
                </button>
              </div>

              <div className="mb-4">
                <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1.5">
                  {lang === 'ru' ? 'Код подтверждения' : 'Verification code'}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                  placeholder="000000"
                  autoFocus
                  maxLength={6}
                  className="w-full bg-zinc-800/60 border border-white/10 rounded-xl px-3 py-3 text-center text-lg font-mono text-white tracking-[0.5em] placeholder:text-zinc-600 placeholder:tracking-[0.5em] outline-none focus:border-white/25 transition-colors"
                />
              </div>

              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

              <button
                onClick={handleVerifyCode}
                disabled={loading || code.length < 6}
                className="w-full bg-gradient-to-r from-white/20 to-white/10 border border-white/25 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 text-sm transition-all mb-3"
              >
                {loading ? '...' : (lang === 'ru' ? 'Войти' : 'Sign in')}
              </button>

              <button
                onClick={handleResend}
                disabled={cooldown > 0 || loading}
                className="w-full text-zinc-500 text-xs py-2 hover:text-white transition-colors disabled:opacity-40"
              >
                {cooldown > 0
                  ? (lang === 'ru' ? `Отправить повторно (${cooldown}с)` : `Resend (${cooldown}s)`)
                  : (lang === 'ru' ? 'Отправить повторно' : 'Resend code')
                }
              </button>
            </>
          )}
        </motion.div>

        <div className="mt-4 text-center">
          <button onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} className="text-zinc-600 text-xs hover:text-zinc-400 transition-colors">
            {lang === 'ru' ? 'English' : 'Русский'}
          </button>
        </div>
      </div>
    </div>
  );
}

const NavItem = memo(function NavItem({ icon, label, isActive, onClick }: { icon: React.ReactNode; label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-14 h-12 gap-0.5 transition-colors relative active:scale-90 ${isActive ? 'text-[#00D1FF]' : 'text-zinc-600 hover:text-zinc-400'}`}>
      <div className={`relative ${isActive ? 'drop-shadow-[0_0_4px_rgba(0,209,255,0.4)]' : ''}`}>{icon}</div>
      <span className="text-[8px] font-medium tracking-wider uppercase">{label}</span>
      {isActive && <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-[#00D1FF] rounded-full shadow-[0_0_4px_rgba(0,209,255,0.5)]" />}
    </button>
  );
});
