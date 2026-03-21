'use client';

import { useState, memo, useEffect } from 'react';
import Image from 'next/image';
import { Shield, CreditCard, User, Zap, Check, ChevronRight, HelpCircle, Star, Bitcoin, Wallet, Calendar, Smartphone, Settings, Gift, MonitorSmartphone, Globe, X, Monitor, FileText, Lock, Download, ArrowRight, CheckCircle2, Laptop, Smartphone as SmartphoneIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Telegram WebApp types
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
          };
        };
        close: () => void;
        openInvoice: (url: string, callback: (status: string) => void) => void;
        openLink: (url: string) => void;
        expand: () => void;
        ready: () => void;
      };
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
    setupAddDesc: 'Добавление ключа подписки будет доступно в следующем обновлении.',
    setupAddButton: 'Добавить ключ',
    setupAddPending: 'Пока это не реализовано',
    setupNext: 'Далее',
    setupFinish: 'Завершить',
    setupStepOf: 'из',
    setupRegion: 'Регион',
    setupGlobal: 'Global',
    setupRussia: 'Russia',
    setupNoStore: 'Для этого устройства ссылка на магазин пока не задана.'
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
    setupAddDesc: 'Adding the subscription key will be available in the next update.',
    setupAddButton: 'Add key',
    setupAddPending: 'Not implemented yet',
    setupNext: 'Next',
    setupFinish: 'Finish',
    setupStepOf: 'of',
    setupRegion: 'Region',
    setupGlobal: 'Global',
    setupRussia: 'Russia',
    setupNoStore: 'No store link configured for this device yet.'
  }
};

const tabs = ['home', 'payment', 'profile'] as const;
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

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [direction, setDirection] = useState(0);
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const [tgUser, setTgUser] = useState<{ id: number; name: string; photo: string; username?: string } | null>(null);
  const [subscriptionState, setSubscriptionState] = useState<{ endDate: string | null; daysLeft: number; status: string } | null>(null);

  // Get Telegram user data on mount
  useEffect(() => {
    const initTg = async () => {
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        
        // Log for debugging
        console.log('Telegram WebApp initialized:', tg.initDataUnsafe);
        
        const user = tg.initDataUnsafe?.user;
        if (user) {
          console.log('User data:', user);
          const normalizedName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'User';

          setTgUser({
            id: user.id,
            name: normalizedName,
            photo: user.photo_url || '',
            username: user.username,
          });

          try {
            await fetch('/api/users/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                telegramId: user.id,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name,
                photoUrl: user.photo_url,
              }),
            });

            const stateResponse = await fetch(`/api/users/state?telegramId=${encodeURIComponent(String(user.id))}`);
            if (stateResponse.ok) {
              const statePayload = await stateResponse.json();
              setSubscriptionState(statePayload.profile ?? { endDate: null, daysLeft: 0, status: 'none' });
            } else {
              setSubscriptionState({ endDate: null, daysLeft: 0, status: 'none' });
            }
          } catch (error) {
            setSubscriptionState({ endDate: null, daysLeft: 0, status: 'none' });
            console.error('Failed to sync telegram user:', error);
          }
        }
      }
    };
    
    // Small delay to ensure Telegram script is loaded
    const timer = setTimeout(initTg, 100);
    return () => clearTimeout(timer);
  }, []);

  const t = translations[lang];
  const subscriptionEndDateLabel = subscriptionState?.endDate
    ? new Date(subscriptionState.endDate).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB')
    : (lang === 'ru' ? 'Нет подписки' : 'No subscription');
  const subscriptionDaysLabel = lang === 'ru'
    ? `Осталось ${subscriptionState?.daysLeft ?? 0} дн.`
    : `${subscriptionState?.daysLeft ?? 0} days left`;

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

  return (
    <div className="min-h-screen w-full bg-[#020617] overflow-x-hidden relative font-sans">
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-[#3B82F6]/10 blur-[40px]" />
        <div className="absolute top-[40%] -right-[10%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-[#8B5CF6]/10 blur-[50px]" />
        <motion.div
          className="hidden lg:block absolute left-[22%] top-[16%] h-[2px] w-[220px] bg-gradient-to-r from-transparent via-[#00D1FF]/80 to-transparent"
          animate={{ opacity: [0.1, 0.9, 0.15], scaleX: [0.8, 1.15, 0.9], x: [-8, 14, -6] }}
          transition={{ duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="hidden lg:block absolute right-[20%] top-[48%] h-[2px] w-[180px] bg-gradient-to-r from-transparent via-[#60A5FA]/75 to-transparent"
          animate={{ opacity: [0.2, 0.85, 0.2], scaleX: [0.7, 1.2, 0.85], x: [10, -12, 8] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: 0.35 }}
        />
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
                <span className="absolute inset-0 bg-gradient-to-r from-[#3B82F6] to-[#00D1FF] blur-sm opacity-40"></span>
                <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-[#3B82F6] via-white to-[#00D1FF]">
                  VPN
                </span>
              </span>
            </h1>
          </header>

          <div className="w-full max-w-6xl mx-auto lg:mx-0 lg:flex-1">
            <AnimatePresence mode="wait" custom={direction}>
              {activeTab === 'home' && <HomeView key="home" t={t} direction={direction} subscriptionEndDateLabel={subscriptionEndDateLabel} />}
              {activeTab === 'payment' && <PaymentView key="payment" t={t} direction={direction} />}
              {activeTab === 'profile' && <ProfileView key="profile" t={t} lang={lang} setLang={setLang} direction={direction} tgUser={tgUser} subscriptionDaysLabel={subscriptionDaysLabel} />}
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
  const menuBtnClass = (isActive: boolean) => `group w-full text-left px-3.5 py-2.5 rounded-xl text-sm transition-all ${isActive ? 'bg-gradient-to-r from-[#1d4ed8]/35 to-[#0ea5e9]/20 text-white border border-[#3b82f6]/45 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]' : 'text-zinc-300 hover:bg-white/5 hover:border-white/10 border border-transparent'}`;

  return (
    <aside className="hidden lg:flex lg:w-72 lg:shrink-0 lg:flex-col lg:rounded-3xl lg:border lg:border-[#1d4ed8]/20 lg:bg-gradient-to-b lg:from-[#0b1228]/95 lg:to-[#060b1d]/90 lg:p-4 lg:backdrop-blur-xl lg:shadow-[0_0_45px_rgba(2,6,23,0.8)]">
      <div className="mb-6 rounded-2xl border border-[#1d4ed8]/20 bg-[#081126]/70 p-3">
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

function HomeView({ t, direction, subscriptionEndDateLabel }: { t: any, direction: number; subscriptionEndDateLabel: string }) {
  const [isRoaring, setIsRoaring] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [deviceOS, setDeviceOS] = useState<'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'>('unknown');
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [setupRegion, setSetupRegion] = useState<'global' | 'russia'>('global');
  const electricArcs = [
    { top: '16%', left: '-8%', rotate: -18, delay: 0 },
    { top: '35%', left: '82%', rotate: 12, delay: 0.35 },
    { top: '72%', left: '4%', rotate: 21, delay: 0.7 },
    { top: '58%', left: '74%', rotate: -24, delay: 1.05 },
  ] as const;

  const handleTigerClick = () => {
    if (isRoaring) return;
    setIsRoaring(true);
    setTimeout(() => setIsRoaring(false), 500);
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

  const closeSetupModal = () => {
    setShowSetupModal(false);
    setSetupStep(1);
    setShowDevicePicker(false);
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
      case 'windows': return <Monitor size={34} className="text-white" />;
      case 'macos': return <Laptop size={34} className="text-white" />;
      case 'linux': return <Monitor size={34} className="text-white" />;
      case 'android': return <SmartphoneIcon size={34} className="text-white" />;
      case 'ios': return <SmartphoneIcon size={34} className="text-white" />;
      default: return <MonitorSmartphone size={34} className="text-white" />;
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
              className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-3xl border border-white/10 bg-gradient-to-b from-[#0f172a] to-[#020617] p-6 shadow-2xl"
            >
              <div className="mb-6 flex items-center justify-between">
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

              <div className="mx-auto mb-6 flex h-36 w-36 items-center justify-center rounded-full border border-[#1d4ed8]/35 bg-[#0b1228]/70 relative">
                <div className="absolute inset-3 rounded-full border border-[#1d4ed8]/25" />
                <div className="absolute inset-6 rounded-full border border-[#1d4ed8]/20" />
                <div className="absolute inset-9 rounded-full border border-[#1d4ed8]/15" />
                <div className="relative z-10">{setupStep === 1 ? getDeviceIcon() : setupStep === 2 ? <Download size={34} className="text-white" /> : <Lock size={34} className="text-white" />}</div>
              </div>

              {setupStep === 1 && (
                <>
                  <h3 className="text-4xl sm:text-3xl font-bold text-center text-white mb-2">{t.setupFor} {getDeviceLabel()}</h3>
                  <p className="text-zinc-400 text-center mb-6">{t.setupStepsHint}</p>

                  <div className="space-y-2.5">
                    <button
                      onClick={() => setSetupStep(2)}
                      className="w-full bg-[#1d4ed8] text-white font-semibold py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95"
                    >
                      <ArrowRight size={16} /> {t.setupStart}
                    </button>

                    <button
                      onClick={() => setShowDevicePicker((prev) => !prev)}
                      className="w-full border border-white/20 text-white font-medium py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95"
                    >
                      <MonitorSmartphone size={16} /> {t.setupOtherDevice}
                    </button>
                  </div>

                  {showDevicePicker && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-900/50 p-3">
                      <p className="text-zinc-400 text-xs uppercase tracking-wider mb-2">{t.setupChooseDevice}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setDeviceOS('windows')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'windows' ? 'border-[#3b82f6] text-white bg-[#1d4ed8]/20' : 'border-white/10 text-zinc-300'}`}>Windows</button>
                        <button onClick={() => setDeviceOS('macos')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'macos' ? 'border-[#3b82f6] text-white bg-[#1d4ed8]/20' : 'border-white/10 text-zinc-300'}`}>macOS</button>
                        <button onClick={() => setDeviceOS('android')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'android' ? 'border-[#3b82f6] text-white bg-[#1d4ed8]/20' : 'border-white/10 text-zinc-300'}`}>Android</button>
                        <button onClick={() => setDeviceOS('ios')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'ios' ? 'border-[#3b82f6] text-white bg-[#1d4ed8]/20' : 'border-white/10 text-zinc-300'}`}>iPhone/iPad</button>
                        <button onClick={() => setDeviceOS('linux')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'linux' ? 'border-[#3b82f6] text-white bg-[#1d4ed8]/20' : 'border-white/10 text-zinc-300'}`}>Linux</button>
                        <button onClick={() => setDeviceOS('unknown')} className={`rounded-lg border px-3 py-2 text-sm ${deviceOS === 'unknown' ? 'border-[#3b82f6] text-white bg-[#1d4ed8]/20' : 'border-white/10 text-zinc-300'}`}>Other</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {setupStep === 2 && (
                <>
                  <h3 className="text-4xl sm:text-3xl font-bold text-center text-white mb-2">{t.setupInstallTitle}</h3>
                  <p className="text-zinc-400 text-center mb-5">{t.setupInstallDesc}</p>

                  {(deviceOS === 'ios' || deviceOS === 'macos') && (
                    <div className="mb-4">
                      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2">{t.setupRegion}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setSetupRegion('global')} className={`rounded-lg border px-3 py-2 text-sm ${setupRegion === 'global' ? 'border-[#3b82f6] text-white bg-[#1d4ed8]/20' : 'border-white/10 text-zinc-300'}`}>{t.setupGlobal}</button>
                        <button onClick={() => setSetupRegion('russia')} className={`rounded-lg border px-3 py-2 text-sm ${setupRegion === 'russia' ? 'border-[#3b82f6] text-white bg-[#1d4ed8]/20' : 'border-white/10 text-zinc-300'}`}>{t.setupRussia}</button>
                      </div>
                    </div>
                  )}

                  {!getStoreLink() && <p className="text-amber-300 text-xs mb-4">{t.setupNoStore}</p>}

                  <div className="space-y-2.5">
                    <button
                      onClick={openStoreLink}
                      disabled={!getStoreLink()}
                      className="w-full border border-white/20 text-white font-semibold py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40"
                    >
                      <Download size={16} /> {t.setupInstallButton}
                    </button>

                    <button
                      onClick={() => setSetupStep(3)}
                      className="w-full bg-[#1d4ed8] text-white font-semibold py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95"
                    >
                      <ArrowRight size={16} /> {t.setupNext}
                    </button>
                  </div>
                </>
              )}

              {setupStep === 3 && (
                <>
                  <h3 className="text-4xl sm:text-3xl font-bold text-center text-white mb-2">{t.setupAddTitle}</h3>
                  <p className="text-zinc-400 text-center mb-4">{t.setupAddDesc}</p>

                  <button
                    disabled
                    className="w-full mb-3 border border-white/20 text-white/60 font-semibold py-3.5 rounded-full flex items-center justify-center gap-2 cursor-not-allowed"
                  >
                    <Lock size={16} /> {t.setupAddButton}
                  </button>

                  <p className="text-amber-300 text-xs text-center mb-6">{t.setupAddPending}</p>

                  <button
                    onClick={closeSetupModal}
                    className="w-full bg-[#1d4ed8] text-white font-semibold py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95"
                  >
                    <ArrowRight size={16} /> {t.setupFinish}
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
      className="flex flex-col items-center gap-4 flex-1 lg:items-start lg:pt-4"
    >
      {/* Logo */}
      <motion.div
        animate={isRoaring ? { x: [-6, 6, -6, 6, 0], y: [-3, 3, -3, 3, 0] } : {}}
        transition={{ duration: 0.25 }}
        className="relative w-36 h-36 lg:w-[320px] lg:h-[320px] cursor-pointer"
        onClick={handleTigerClick}
      >
        <motion.div
          className={`absolute inset-0 rounded-full ${isRoaring ? 'bg-[#8B5CF6]/20' : 'bg-[#3B82F6]/12'} blur-md`}
          animate={{ scale: [1, 1.05, 1], opacity: [0.45, 0.85, 0.5] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        {electricArcs.map((arc, index) => (
          <motion.span
            key={`${arc.top}-${arc.left}-${index}`}
            className="hidden lg:block absolute h-[2px] w-[96px] rounded-full bg-gradient-to-r from-transparent via-[#67E8F9] to-transparent"
            style={{ top: arc.top, left: arc.left, rotate: `${arc.rotate}deg` }}
            animate={{ opacity: [0.15, 0.95, 0.2], scaleX: [0.75, 1.2, 0.8] }}
            transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut', delay: arc.delay }}
          />
        ))}
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
      <div className="w-full max-w-xs lg:max-w-[880px] bg-gradient-to-b from-[#0f172a]/95 via-[#0a1227]/95 to-[#030712]/95 border border-[#1d4ed8]/25 rounded-2xl p-3.5 lg:p-5 shadow-[0_0_38px_rgba(15,23,42,0.65)] relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.15),transparent_58%)] pointer-events-none rounded-2xl" />
        <motion.div
          className="hidden lg:block absolute top-5 right-5 h-[2px] w-28 bg-gradient-to-r from-transparent via-[#22D3EE] to-transparent"
          animate={{ opacity: [0.2, 1, 0.25], x: [-8, 6, -4] }}
          transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="hidden lg:block absolute bottom-8 left-10 h-[2px] w-24 bg-gradient-to-r from-transparent via-[#60A5FA] to-transparent"
          animate={{ opacity: [0.25, 0.95, 0.2], x: [6, -10, 4] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.45 }}
        />
        
        <div className="flex justify-between items-start mb-3 relative z-10">
          <h3 className="text-lg font-bold text-white">{t.planName}</h3>
          <div className="text-right flex flex-col items-end">
            <span className="text-zinc-500 text-[8px] uppercase tracking-widest mb-0.5">{t.until}</span>
            <div className="text-white/60 text-[11px] font-medium flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
              {subscriptionEndDateLabel} <Calendar size={10} className="text-zinc-500"/>
            </div>
          </div>
        </div>

        <div className="inline-flex items-center gap-1 bg-[#00D1FF]/10 border border-[#00D1FF]/15 px-2 py-0.5 rounded-md mb-4 relative z-10">
          <Smartphone size={10} className="text-[#00D1FF]" />
          <span className="text-[#00D1FF] text-[10px] font-medium">{t.devices}</span>
        </div>

        <div className="space-y-2 relative z-10">
          <button className="w-full bg-gradient-to-r from-[#1d4ed8]/35 via-[#2563eb]/30 to-[#0ea5e9]/30 border border-[#22d3ee]/30 text-[#67e8f9] font-medium py-2.5 rounded-xl flex items-center justify-center gap-1.5 active:scale-95 text-sm transition-transform hover:-translate-y-0.5">
            <Zap size={14} /> <span>{t.extend}</span>
          </button>
          
          <button onClick={handleInstallClick} className="w-full bg-zinc-800/50 border border-white/10 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-1.5 active:scale-95 text-sm transition-colors hover:border-[#60a5fa]/40 hover:bg-zinc-800/70">
            <Settings size={14} className="text-zinc-400" /> {t.install}
          </button>

          <div className="grid grid-cols-2 gap-1.5">
            <button className="bg-zinc-900/80 border border-white/5 text-zinc-300 text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-colors hover:text-white hover:border-[#1d4ed8]/40">
              <Gift size={12} className="text-zinc-500" /> {t.promo}
            </button>
            <button className="bg-zinc-900/80 border border-white/5 text-zinc-300 text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-colors hover:text-white hover:border-[#1d4ed8]/40">
              <MonitorSmartphone size={12} className="text-zinc-500" /> {t.myDevices}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
    </>
  );
}

function PaymentView({ t, direction }: { t: any, direction: number }) {
  const [months, setMonths] = useState(1);
  const [payMethod, setPayMethod] = useState<'tg' | 'crypto' | 'sbp'>('tg');
  const [isLoading, setIsLoading] = useState(false);

  const basePrice = 150; 
  const discountPerMonth = 5; 
  const pricePerMonth = Math.max(50, basePrice - (months - 1) * discountPerMonth);
  const totalPrice = pricePerMonth * months;

  const handleSubscribe = async () => {
    setIsLoading(true);
    try {
      if (payMethod === 'tg') {
        const response = await fetch('/api/invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ months, amount: totalPrice }),
        });
        const data = await response.json();
        if (data.invoiceLink) {
          if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
            window.Telegram.WebApp.openInvoice(data.invoiceLink, (status: string) => {
              if (status === 'paid') alert('Оплата прошла успешно!');
              else if (status === 'failed') alert('Ошибка оплаты');
            });
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
          body: JSON.stringify({ months, amount: totalPrice }),
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
      className="flex flex-col gap-3 flex-1"
    >
      <div className="w-full max-w-xs mx-auto flex flex-col">
        <motion.div 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.25 }}
          className="bg-zinc-900/40 border border-white/5 rounded-xl p-3 mb-3"
        >
          <div className="flex justify-between items-end mb-3">
            <div>
              <span className="text-2xl font-bold text-white">{months}</span>
              <span className="text-zinc-400 ml-1 text-xs">{t.months}</span>
            </div>
            <div className="text-right">
              <div className="text-lg font-medium text-white">{pricePerMonth}₽ <span className="text-[10px] text-zinc-500">{t.perMonth}</span></div>
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
          className="grid grid-cols-3 gap-1.5 mb-3"
        >
          <PaymentMethodBtn icon={<Star size={16} className={payMethod === 'tg' ? "text-yellow-400" : "text-zinc-500"} />} label={t.payTg} isActive={payMethod === 'tg'} onClick={() => setPayMethod('tg')} />
          <PaymentMethodBtn icon={<Bitcoin size={16} className={payMethod === 'crypto' ? "text-orange-400" : "text-zinc-500"} />} label={t.payCrypto} isActive={payMethod === 'crypto'} onClick={() => setPayMethod('crypto')} />
          <PaymentMethodBtn icon={<Wallet size={16} className={payMethod === 'sbp' ? "text-blue-400" : "text-zinc-500"} />} label={t.paySbp} isActive={payMethod === 'sbp'} onClick={() => setPayMethod('sbp')} />
        </motion.div>
      </div>

      <div className="w-full max-w-xs mx-auto flex flex-col">
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

function ProfileView({ t, lang, setLang, direction, tgUser, subscriptionDaysLabel }: { t: any; lang: string; setLang: (l: 'ru' | 'en') => void; direction: number; tgUser: { name: string; photo: string } | null; subscriptionDaysLabel: string }) {
  return (
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center">
      <div className="w-full max-w-xs">
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
              <a href="https://t.me/hundler_support" target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-2">
                  <HelpCircle size={18} strokeWidth={1.5} className="text-zinc-400" />
                  <span className="text-zinc-200 font-medium text-sm">{t.support}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </a>
              <div className="h-px bg-white/5 mx-3" />
              <button className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors active:scale-[0.98]">
                <div className="flex items-center gap-2">
                  <Gift size={18} strokeWidth={1.5} className="text-zinc-400" />
                  <span className="text-zinc-200 font-medium text-sm">{t.referral}</span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-zinc-600" />
              </button>
              <div className="h-px bg-white/5 mx-3" />
              <button className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors active:scale-[0.98]">
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
        </motion.div>
      </div>
    </motion.div>
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
