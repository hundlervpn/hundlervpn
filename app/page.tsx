'use client';

import { useState, memo, useCallback } from 'react';
import Image from 'next/image';
import { Shield, CreditCard, User, Zap, Check, ChevronRight, HelpCircle, Star, Bitcoin, Wallet, Calendar, Smartphone, Settings, Gift, MonitorSmartphone, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
    connected: 'ПОДКЛЮЧЕНО', disconnected: 'ОТКЛЮЧЕНО', location: 'Германия', ping: '120 мс'
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
    connected: 'CONNECTED', disconnected: 'DISCONNECTED', location: 'Germany', ping: '120 ms'
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
    <div className="flex flex-col h-[100dvh] w-full bg-[#020617] overflow-hidden relative font-sans items-center justify-center">
      {/* Static Background with CSS animation */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Gradient Orbs - simplified with CSS */}
        <div className="absolute -top-[20%] -left-[10%] w-[60vw] h-[60vw] max-w-[500px] max-h-[500px] rounded-full bg-[#3B82F6]/10 blur-[60px] animate-pulse" />
        <div className="absolute top-[40%] -right-[10%] w-[70vw] h-[70vw] max-w-[600px] max-h-[600px] rounded-full bg-[#8B5CF6]/10 blur-[80px] animate-pulse" />
      </div>

      <div className="w-full h-full md:max-w-5xl md:h-[90vh] md:rounded-[40px] md:border md:border-white/10 flex flex-col relative md:shadow-[0_0_100px_rgba(59,130,246,0.05)] bg-[#020617]/80 backdrop-blur-3xl overflow-hidden z-10">
        {/* Header / Logo */}
        <header className="flex items-center justify-center p-6 shrink-0 z-10 pt-12 md:pt-8">
        <h1 className="font-syncopate font-bold text-xl tracking-[0.2em] text-white flex items-center">
          HUNDLER
          <span className="relative inline-block ml-3">
            <span className="absolute inset-0 bg-gradient-to-r from-[#3B82F6] to-[#00D1FF] blur-md opacity-60 animate-pulse"></span>
            <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-[#3B82F6] via-white to-[#00D1FF] animate-pulse">
              VPN
            </span>
          </span>
        </h1>
      </header>

      {/* Content Area */}
      <main 
        className="flex-1 overflow-x-hidden overflow-y-auto relative pb-28 md:pb-6 px-6 md:px-12 flex flex-col"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <AnimatePresence mode="wait" custom={direction}>
          {activeTab === 'home' && <HomeView key="home" t={t} direction={direction} />}
          {activeTab === 'payment' && <PaymentView key="payment" t={t} direction={direction} />}
          {activeTab === 'profile' && <ProfileView key="profile" t={t} lang={lang} setLang={setLang} direction={direction} />}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="absolute bottom-0 w-full bg-zinc-950/90 backdrop-blur-xl border-t border-white/5 pb-safe pt-3 px-8 flex justify-center gap-12 items-center z-20 h-24 md:h-20 md:pb-3 md:border-t-0 md:bg-transparent md:backdrop-blur-none md:relative md:mt-auto">
        <NavItem 
          icon={<Shield size={24} strokeWidth={1.5} />} 
          label={t.navVpn} 
          isActive={activeTab === 'home'} 
          onClick={() => navigate('home')} 
        />
        <NavItem 
          icon={<CreditCard size={24} strokeWidth={1.5} />} 
          label={t.navPremium} 
          isActive={activeTab === 'payment'} 
          onClick={() => navigate('payment')} 
        />
        <NavItem 
          icon={<User size={24} strokeWidth={1.5} />} 
          label={t.navProfile} 
          isActive={activeTab === 'profile'} 
          onClick={() => navigate('profile')} 
        />
      </nav>
      </div>
    </div>
  );
}

function HomeView({ t, direction }: { t: any, direction: number }) {
  const [isRoaring, setIsRoaring] = useState(false);

  const handleTigerClick = () => {
    if (isRoaring) return;
    setIsRoaring(true);
    setTimeout(() => setIsRoaring(false), 800);
  };

  return (
    <motion.div 
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 h-full pt-2 md:pt-0"
    >
      {/* Logo Area */}
      <motion.div 
        animate={isRoaring ? { x: [-10, 10, -10, 10, 0], y: [-5, 5, -5, 5, 0] } : {}}
        transition={{ duration: 0.4 }}
        className="flex flex-col items-center justify-center mt-2 mb-auto md:mb-0 w-full md:w-1/2"
      >
        <div
          className="relative w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 cursor-pointer"
          onClick={handleTigerClick}
        >
          {/* Permanent Premium Glow */}
          <div className={`absolute inset-0 rounded-full ${isRoaring ? 'bg-[#8B5CF6]/20 blur-xl' : 'bg-[#3B82F6]/15 blur-xl'} animate-pulse`} />
          
          <div className="w-full h-full relative z-10">
            <Image 
              src="/logo.png" 
              alt="Hundler VPN Logo" 
              fill 
              className="object-contain drop-shadow-[0_0_15px_rgba(0,209,255,0.2)]"
              referrerPolicy="no-referrer"
              priority
            />
          </div>
        </div>
      </motion.div>

      {/* Info Card */}
      <div 
        className="w-full md:w-1/2 max-w-md bg-gradient-to-b from-[#0f172a]/90 to-[#020617]/90 backdrop-blur-xl border border-[rgba(0,209,255,0.15)] rounded-[32px] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] mt-auto md:mt-0 mb-2 md:mb-0 relative shrink-0 overflow-hidden"
      >
        {/* Subtle inner glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#3B82F6]/10 to-transparent pointer-events-none rounded-[32px]" />
        
        {/* Header of card */}
        <div className="flex justify-between items-start mb-6 relative z-10">
          <h3 className="text-2xl font-bold text-white tracking-wide">{t.planName}</h3>
          <div className="text-right flex flex-col items-end">
            <span className="text-zinc-500 text-[10px] uppercase tracking-widest mb-1.5">{t.until}</span>
            <div className="text-white/60 text-sm font-medium flex items-center gap-2 bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/5">
              {t.date} <Calendar size={14} className="text-zinc-500"/>
            </div>
          </div>
        </div>

        {/* Devices Badge */}
        <div className="inline-flex items-center gap-2 bg-[#00D1FF]/10 border border-[#00D1FF]/20 px-3 py-1.5 rounded-xl mb-8 relative z-10">
          <Smartphone size={14} className="text-[#00D1FF]" />
          <span className="text-[#00D1FF] text-xs font-medium">{t.devices}</span>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 relative z-10">
          <button 
            className="w-full bg-gradient-to-r from-[#3B82F6]/20 to-[#8B5CF6]/20 border border-[#00D1FF]/40 text-[#00D1FF] font-medium py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-[#3B82F6]/30 hover:shadow-[0_0_20px_rgba(0,209,255,0.3)] transition-all shadow-[0_0_15px_rgba(0,209,255,0.1)] relative overflow-hidden group active:scale-95"
          >
            <Zap size={18} className="relative z-10" /> 
            <span className="relative z-10">{t.extend}</span>
          </button>
          
          <button className="w-full bg-zinc-800/50 border border-white/10 text-white font-medium py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors active:scale-95">
            <Settings size={18} className="text-zinc-400" /> {t.install}
          </button>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button className="bg-zinc-900/80 border border-white/5 text-zinc-300 text-sm font-medium py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors group active:scale-95">
              <Gift size={16} className="text-zinc-500" /> {t.promo}
            </button>
            <button className="bg-zinc-900/80 border border-white/5 text-zinc-300 text-sm font-medium py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors group active:scale-95">
              <MonitorSmartphone size={16} className="text-zinc-500" /> {t.myDevices}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
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
    if (payMethod === 'tg') {
      setIsLoading(true);
      try {
        const response = await fetch('/api/invoice', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            months,
            amount: totalPrice, // Assuming 1 Star = 1 RUB for simplicity, adjust as needed
          }),
        });

        const data = await response.json();

        if (data.invoiceLink) {
          // Open the invoice link using Telegram Web App API if available
          if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
            (window as any).Telegram.WebApp.openInvoice(data.invoiceLink, (status: string) => {
              if (status === 'paid') {
                alert('Оплата прошла успешно!');
              } else if (status === 'cancelled') {
                console.log('Оплата отменена');
              } else if (status === 'failed') {
                alert('Ошибка оплаты');
              } else if (status === 'pending') {
                console.log('Оплата в обработке');
              }
            });
          } else {
            // Fallback for regular browser
            window.open(data.invoiceLink, '_blank');
          }
        } else {
          alert(data.error || 'Ошибка создания счета');
        }
      } catch (error) {
        console.error('Payment error:', error);
        alert('Произошла ошибка при попытке оплаты');
      } finally {
        setIsLoading(false);
      }
    } else {
      alert('Этот метод оплаты пока не реализован');
    }
  };

  return (
    <motion.div 
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col md:flex-row gap-8 pb-8 h-full pt-6 md:pt-0 items-center justify-center"
    >
      <div className="w-full md:w-1/2 max-w-md flex flex-col">
        {/* Slider Section */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 mb-6"
        >
        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="text-4xl font-bold text-white">{months}</span>
            <span className="text-zinc-400 ml-2">{t.months}</span>
          </div>
          <div className="text-right">
            <div className="text-2xl font-medium text-white">{pricePerMonth}₽ <span className="text-sm text-zinc-500 font-normal">{t.perMonth}</span></div>
          </div>
        </div>
        
        <input 
          type="range" 
          min="1" 
          max="12" 
          value={months} 
          onChange={(e) => setMonths(parseInt(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(255,255,255,0.5)]"
          style={{
            background: `linear-gradient(to right, #fff ${(months - 1) / 11 * 100}%, #27272a ${(months - 1) / 11 * 100}%)`
          }}
        />
        <div className="flex justify-between text-zinc-600 text-xs mt-3 font-medium">
          <span>1 {t.months}</span>
          <span>12 {t.months}</span>
        </div>

        <div className="mt-6 pt-6 border-t border-white/5 flex justify-between items-center">
          <span className="text-zinc-400">{t.total}</span>
          <span className="text-xl font-bold text-white">{totalPrice}₽</span>
        </div>
      </motion.div>

      {/* Payment Methods */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="grid grid-cols-3 gap-3 mb-8"
      >
        <PaymentMethodBtn 
          icon={<Star size={20} className={payMethod === 'tg' ? "text-yellow-400" : "text-zinc-500"} />} 
          label={t.payTg} 
          isActive={payMethod === 'tg'} 
          onClick={() => setPayMethod('tg')} 
        />
        <PaymentMethodBtn 
          icon={<Bitcoin size={20} className={payMethod === 'crypto' ? "text-orange-400" : "text-zinc-500"} />} 
          label={t.payCrypto} 
          isActive={payMethod === 'crypto'} 
          onClick={() => setPayMethod('crypto')} 
        />
        <PaymentMethodBtn 
          icon={<Wallet size={20} className={payMethod === 'sbp' ? "text-blue-400" : "text-zinc-500"} />} 
          label={t.paySbp} 
          isActive={payMethod === 'sbp'} 
          onClick={() => setPayMethod('sbp')} 
        />
      </motion.div>
      </div>

      <div className="w-full md:w-1/2 max-w-md flex flex-col h-full justify-center">
        {/* Features */}
        <div className="mb-8">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-4 px-2">{t.featTitle}</h3>
          <motion.ul variants={listVariants} initial="hidden" animate="visible" className="space-y-3">
            <motion.li variants={itemVariants}><FeatureItem text={t.f1} /></motion.li>
            <motion.li variants={itemVariants}><FeatureItem text={t.f2} /></motion.li>
            <motion.li variants={itemVariants}><FeatureItem text={t.f3} /></motion.li>
          </motion.ul>
        </div>

        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="mt-auto md:mt-8"
        >
          <motion.button 
            whileTap={{ scale: 0.97 }}
            onClick={handleSubscribe}
            disabled={isLoading}
            className="w-full bg-white text-black font-medium text-lg py-4 rounded-2xl hover:bg-zinc-200 transition-colors shadow-[0_0_30px_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Загрузка...' : t.subscribe}
          </motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
}

const PaymentMethodBtn = memo(function PaymentMethodBtn({ icon, label, isActive, onClick }: { icon: React.ReactNode, label: string, isActive: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all gap-2 active:scale-95
        ${isActive 
          ? 'bg-zinc-900 border-white/20' 
          : 'bg-zinc-950/50 border-white/5 hover:bg-zinc-900/50'
        }
      `}
    >
      {icon}
      <span className={`text-[10px] font-medium uppercase tracking-wider text-center ${isActive ? 'text-white' : 'text-zinc-500'}`}>
        {label}
      </span>
    </button>
  );
});

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-5 h-5 rounded-full bg-[#3B82F6]/10 flex items-center justify-center shrink-0 border border-[#3B82F6]/20">
        <Check size={12} strokeWidth={2.5} className="text-[#00D1FF]" />
      </div>
      <span className="text-zinc-300 text-sm">{text}</span>
    </div>
  );
}

function ProfileView({ t, lang, setLang, direction }: { t: any, lang: string, setLang: (l: 'ru' | 'en') => void, direction: number }) {
  return (
    <motion.div 
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col pt-4 pb-8 h-full items-center justify-center"
    >
      <div className="w-full max-w-md">
        {/* User Info */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="flex items-center gap-5 mb-10 bg-zinc-900/40 p-6 rounded-3xl border border-white/5"
        >
        <div className="w-16 h-16 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0">
          <User size={32} strokeWidth={1.5} className="text-zinc-400" />
        </div>
        <div>
          <h2 className="text-xl font-medium text-white mb-1">User_78921</h2>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
            <div className="w-2 h-2 rounded-full bg-[#00D1FF]" />
            <span className="text-zinc-300 text-xs font-medium uppercase tracking-wider">{t.daysLeft}</span>
          </div>
        </div>
      </motion.div>

      {/* Settings List */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="space-y-8"
      >
        <div>
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-4 px-4">{t.app}</h3>
          <div className="bg-zinc-900/40 border border-white/5 rounded-3xl overflow-hidden">
            <motion.button 
              whileTap={{ scale: 0.98, backgroundColor: 'rgba(255,255,255,0.05)' }}
              onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
              className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="text-zinc-400 group-hover:text-zinc-300 transition-colors">
                  <Globe size={22} strokeWidth={1.5} />
                </div>
                <span className="text-zinc-200 font-medium">{t.lang}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 text-sm">{lang === 'ru' ? 'Русский' : 'English'}</span>
                <ChevronRight size={18} strokeWidth={1.5} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
              </div>
            </motion.button>
            <div className="h-px bg-white/5 mx-6" />
            <motion.a 
              whileTap={{ scale: 0.98, backgroundColor: 'rgba(255,255,255,0.05)' }}
              href="https://t.me/hundler_support" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="text-zinc-400 group-hover:text-zinc-300 transition-colors">
                  <HelpCircle size={22} strokeWidth={1.5} />
                </div>
                <span className="text-zinc-200 font-medium">{t.support}</span>
              </div>
              <div className="flex items-center gap-3">
                <ChevronRight size={18} strokeWidth={1.5} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
              </div>
            </motion.a>
          </div>
        </div>
      </motion.div>
      </div>
    </motion.div>
  );
}

const NavItem = memo(function NavItem({ icon, label, isActive, onClick }: { icon: React.ReactNode, label: string, isActive: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-20 h-16 gap-1.5 transition-colors relative group active:scale-90
        ${isActive ? 'text-[#00D1FF]' : 'text-zinc-600 hover:text-zinc-400'}
      `}
    >
      <div className={`relative ${isActive ? 'drop-shadow-[0_0_6px_rgba(0,209,255,0.6)]' : ''}`}>
        {icon}
      </div>
      <span className="text-[10px] font-medium tracking-wider uppercase">{label}</span>
      {isActive && (
        <div className="absolute -bottom-1 md:-bottom-3 left-1/2 -translate-x-1/2 w-8 h-1 bg-[#00D1FF] rounded-full shadow-[0_0_8px_rgba(0,209,255,0.8)]" />
      )}
    </button>
  );
});
