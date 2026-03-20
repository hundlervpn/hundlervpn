'use client';

import { useState, memo, useEffect } from 'react';
import Image from 'next/image';
import { Shield, CreditCard, User, Zap, Check, ChevronRight, HelpCircle, Star, Bitcoin, Wallet, Calendar, Smartphone, Settings, Gift, MonitorSmartphone, Globe, X, Copy, CheckCheck, Monitor, Tablet, Smartphone as SmartphoneIcon } from 'lucide-react';
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
    planName: 'Premium',
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
    app: 'Приложение', lang: 'Язык', support: 'Поддержка (Telegram)',
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
    setupUnknown: 'Устройство'
  },
  en: {
    navVpn: 'Home', navPremium: 'Payment', navProfile: 'Profile',
    mainBadge: 'Main',
    planName: 'Premium',
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
    app: 'App', lang: 'Language', support: 'Support (Telegram)',
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
    setupUnknown: 'Device'
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
  const [tgUser, setTgUser] = useState<{name: string; photo: string} | null>(null);

  // Get Telegram user data on mount
  useEffect(() => {
    const initTg = () => {
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        
        // Log for debugging
        console.log('Telegram WebApp initialized:', tg.initDataUnsafe);
        
        const user = tg.initDataUnsafe?.user;
        if (user) {
          console.log('User data:', user);
          setTgUser({
            name: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'User',
            photo: user.photo_url || ''
          });
        }
      }
    };
    
    // Small delay to ensure Telegram script is loaded
    const timer = setTimeout(initTg, 100);
    return () => clearTimeout(timer);
  }, []);

  const t = translations[lang];

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
      </div>

      {/* Main Content - scrollable */}
      <main 
        className="relative z-10 w-full min-h-screen pb-24 px-4 flex flex-col"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Header - part of scrollable content */}
        <header className="flex items-center justify-center py-6 shrink-0">
          <h1 className="font-syncopate font-bold text-base tracking-[0.12em] text-white flex items-center">
            HUNDLER
            <span className="relative inline-block ml-1.5">
              <span className="absolute inset-0 bg-gradient-to-r from-[#3B82F6] to-[#00D1FF] blur-sm opacity-40"></span>
              <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-[#3B82F6] via-white to-[#00D1FF]">
                VPN
              </span>
            </span>
          </h1>
        </header>

        {/* Views */}
        <AnimatePresence mode="wait" custom={direction}>
          {activeTab === 'home' && <HomeView key="home" t={t} direction={direction} />}
          {activeTab === 'payment' && <PaymentView key="payment" t={t} direction={direction} />}
          {activeTab === 'profile' && <ProfileView key="profile" t={t} lang={lang} setLang={setLang} direction={direction} tgUser={tgUser} />}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-zinc-950/95 backdrop-blur-xl border-t border-white/5 pt-2 pb-3 px-4 flex justify-around items-center z-20">
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

function HomeView({ t, direction }: { t: any, direction: number }) {
  const [isRoaring, setIsRoaring] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [deviceOS, setDeviceOS] = useState<'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown' | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

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
    setShowSetupModal(true);
  };

  const handleCopyLink = async () => {
    const key = `hvpn_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
    const link = `${window.location.origin}/setup?key=${key}`;
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
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
      case 'windows': return <Monitor size={20} className="text-[#00D1FF]" />;
      case 'macos': return <Monitor size={20} className="text-[#00D1FF]" />;
      case 'linux': return <Monitor size={20} className="text-[#00D1FF]" />;
      case 'android': return <SmartphoneIcon size={20} className="text-[#00D1FF]" />;
      case 'ios': return <SmartphoneIcon size={20} className="text-[#00D1FF]" />;
      default: return <MonitorSmartphone size={20} className="text-[#00D1FF]" />;
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
            onClick={() => setShowSetupModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-900 border border-white/10 rounded-2xl p-4 w-full max-w-xs shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">{t.setupTitle}</h3>
                <button onClick={() => setShowSetupModal(false)} className="text-zinc-400 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="flex items-center gap-2 p-3 bg-zinc-800/50 rounded-lg mb-4">
                {getDeviceIcon()}
                <div>
                  <span className="text-zinc-400 text-xs">{t.setupDetected}</span>
                  <p className="text-white font-medium text-sm">{getDeviceLabel()}</p>
                </div>
              </div>

              <div className="space-y-2">
                <button 
                  onClick={() => {
                    setShowSetupModal(false);
                    // TODO: Start setup for current device
                  }}
                  className="w-full bg-gradient-to-r from-[#3B82F6] to-[#00D1FF] text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 active:scale-95"
                >
                  <Zap size={16} /> {t.setupCurrent}
                </button>

                <button 
                  onClick={handleCopyLink}
                  className="w-full bg-zinc-800 border border-white/10 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 active:scale-95"
                >
                  {linkCopied ? (
                    <>
                      <CheckCheck size={16} className="text-green-400" /> {t.setupLinkCopied}
                    </>
                  ) : (
                    <>
                      <Copy size={16} className="text-zinc-400" /> {t.setupCopyLink}
                    </>
                  )}
                </button>
              </div>
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
      className="flex flex-col items-center gap-3 flex-1"
    >
      {/* Logo */}
      <motion.div
        animate={isRoaring ? { x: [-6, 6, -6, 6, 0], y: [-3, 3, -3, 3, 0] } : {}}
        transition={{ duration: 0.25 }}
        className="relative w-32 h-32 cursor-pointer"
        onClick={handleTigerClick}
      >
        <div className={`absolute inset-0 rounded-full ${isRoaring ? 'bg-[#8B5CF6]/15' : 'bg-[#3B82F6]/10'} blur-md`} />
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
      <div className="w-full max-w-xs bg-gradient-to-b from-[#0f172a]/90 to-[#020617]/90 border border-[rgba(0,209,255,0.1)] rounded-xl p-3.5 shadow-lg relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#3B82F6]/5 to-transparent pointer-events-none rounded-xl" />
        
        <div className="flex justify-between items-start mb-3 relative z-10">
          <h3 className="text-lg font-bold text-white">{t.planName}</h3>
          <div className="text-right flex flex-col items-end">
            <span className="text-zinc-500 text-[8px] uppercase tracking-widest mb-0.5">{t.until}</span>
            <div className="text-white/60 text-[11px] font-medium flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
              {t.date} <Calendar size={10} className="text-zinc-500"/>
            </div>
          </div>
        </div>

        <div className="inline-flex items-center gap-1 bg-[#00D1FF]/10 border border-[#00D1FF]/15 px-2 py-0.5 rounded-md mb-4 relative z-10">
          <Smartphone size={10} className="text-[#00D1FF]" />
          <span className="text-[#00D1FF] text-[10px] font-medium">{t.devices}</span>
        </div>

        <div className="space-y-2 relative z-10">
          <button className="w-full bg-gradient-to-r from-[#3B82F6]/20 to-[#8B5CF6]/20 border border-[#00D1FF]/25 text-[#00D1FF] font-medium py-2.5 rounded-lg flex items-center justify-center gap-1.5 active:scale-95 text-sm">
            <Zap size={14} /> <span>{t.extend}</span>
          </button>
          
          <button onClick={handleInstallClick} className="w-full bg-zinc-800/50 border border-white/10 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-1.5 active:scale-95 text-sm">
            <Settings size={14} className="text-zinc-400" /> {t.install}
          </button>

          <div className="grid grid-cols-2 gap-1.5">
            <button className="bg-zinc-900/80 border border-white/5 text-zinc-300 text-xs font-medium py-2.5 rounded-lg flex items-center justify-center gap-1 active:scale-95">
              <Gift size={12} className="text-zinc-500" /> {t.promo}
            </button>
            <button className="bg-zinc-900/80 border border-white/5 text-zinc-300 text-xs font-medium py-2.5 rounded-lg flex items-center justify-center gap-1 active:scale-95">
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

function ProfileView({ t, lang, setLang, direction, tgUser }: { t: any; lang: string; setLang: (l: 'ru' | 'en') => void; direction: number; tgUser: { name: string; photo: string } | null }) {
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
              <span className="text-zinc-300 text-[9px] font-medium uppercase tracking-wider">{t.daysLeft}</span>
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
