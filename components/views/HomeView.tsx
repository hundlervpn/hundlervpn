'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, User, Zap, Check, ChevronRight, ChevronLeft, Calendar, Smartphone, Settings, Gift, MonitorSmartphone, X, Monitor, Download, ArrowRight, Laptop, Smartphone as SmartphoneIcon, Users, Trash2, Copy, ClipboardCheck, Key } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { haptic } from '@/lib/haptic';
import HappIcon from '@/components/HappIcon';
import V2RayTunIcon from '@/components/V2RayTunIcon';
import IncyIcon from '@/components/IncyIcon';
import TigerNetworkLogo from '@/components/TigerNetworkLogo';
import ReferralModal from '@/components/ReferralModal';
import MatrixRain from '@/components/MatrixRain';
import { useTelegramBackButton, isInTelegramMiniApp } from '@/lib/use-telegram-back-button';
import { pageVariants } from '@/app/_shared/constants';
import type { Tab } from '@/app/_shared/constants';
import type { UserIdentifier } from '@/app/_shared/types';

export default function HomeView({ t, direction, subscriptionEndDateLabel, subscriptionDaysLabel, daysLeft, hasActiveSubscription, subscriptionUrl, tgUser, onSubscriptionChange, userIdentifier, navigate, onSetPendingPromo, referralCode, lang, onOpenReferral, onHideNav }: { t: any, direction: number; subscriptionEndDateLabel: string; subscriptionDaysLabel: string; daysLeft: number; hasActiveSubscription: boolean; subscriptionUrl: string | null; tgUser: { id: number; name: string; photo: string; username?: string } | null; onSubscriptionChange: (identOrTgId: number | UserIdentifier) => Promise<void>; userIdentifier: UserIdentifier | null; navigate: (tab: Tab) => void; onSetPendingPromo: (promo: { code: string; discountPercent: number; promoId: number } | null) => void; referralCode?: string | null; lang: 'ru' | 'en'; onOpenReferral: () => void; onHideNav?: (hide: boolean) => void }) {
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDevicesModal, setShowDevicesModal] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  // (removed) matrixRainRef — the tap-burst effect was dropped per UX
  // feedback 2026-05-13 («строки кода перегружают видимость»). The
  // background rain now runs purely ambient.
  const [devices, setDevices] = useState<{ id: number; device_name: string | null; ip_address: string | null; last_seen_at: string | null; created_at: string }[]>([]);
  const [maxDevices, setMaxDevices] = useState(3);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceOS, setDeviceOS] = useState<'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown'>('unknown');
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [setupRegion, setSetupRegion] = useState<'global' | 'russia'>('russia');
  const [setupClient, setSetupClient] = useState<'hundler' | 'happ' | 'v2raytun' | 'incy'>('happ');
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
        setMaxDevices(data.maxDevices ?? 3);
      } else {
        setDevices([]);
      }
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => { fetchDevices(); }, [userQuery]);

  const handleDevicesClick = () => {
    haptic('medium');
    setShowDevicesModal(true);
    fetchDevices();
  };

  const handleReferralClick = () => {
    haptic('medium');
    if (!referralCode) return;
    onOpenReferral();
  };

  const handleDeleteDevice = async (deviceId: number) => {
    haptic('heavy');
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
    haptic('medium');
    const os = detectDevice();
    setDeviceOS(os);
    setSetupStep(1);
    setShowDevicePicker(false);
    setSetupClient(clientsForOS(os)[0]);
    setShowSetupModal(true);
  };

  const fetchVpnKey = async () => {
    if (!userQuery) return;
    setVpnKeyLoading(true);
    setKeyCopied(false);
    try {
      if (subscriptionUrl) {
        setVpnKey(subscriptionUrl);
        return;
      }

      const res = await fetch(`/api/users/devices?${userQuery}`);
      if (res.ok) {
        const data = await res.json();
        // Ищем любое устройство с ключом (не только активное)
        const deviceWithKey = (data.devices ?? []).find((d: { key_uri: string }) => d.key_uri && !d.key_uri.startsWith('pending://'));
        setVpnKey(deviceWithKey?.key_uri ?? null);
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

  const closeSetupModal = useCallback(() => {
    setShowSetupModal(false);
    setSetupStep(1);
    setShowDevicePicker(false);
    setSetupClient('happ');
    setVpnKey(null);
    setKeyCopied(false);
  }, []);

  // Wire the Telegram native BackButton while the setup modal is open.
  // Pressing it goes one step back; if we're already on step 1 the modal
  // closes. Outside Telegram (regular browser) the hook is a no-op and
  // the user falls back to the in-page close affordance.
  const handleSetupBack = useCallback(() => {
    haptic('light');
    setSetupStep((prev) => {
      if (prev > 1) return (prev - 1) as 1 | 2 | 3;
      // We're on step 1 — close the wizard entirely.
      // Use a microtask so React commits the state change first.
      Promise.resolve().then(closeSetupModal);
      return prev;
    });
  }, [closeSetupModal]);
  // Only show the native BackButton while the modal is open. The hook
  // itself short-circuits when not in TMA, so this is safe in plain
  // browsers as well (just becomes a no-op).
  useTelegramBackButton(handleSetupBack, showSetupModal);

  // Hide the global bottom navigation (Главная / Поддержка / Профиль)
  // while the setup wizard is open — it's a focused full-screen flow
  // and the nav bar at the bottom both wastes vertical space and lets
  // the user accidentally fall out of the funnel mid-setup.
  useEffect(() => {
    onHideNav?.(showSetupModal);
    return () => onHideNav?.(false);
  }, [showSetupModal, onHideNav]);
  // Track TMA-ness once after mount; used to decide whether to render
  // an in-page close button as a fallback (browsers / Telegram desktop
  // before BackButton SDK loads).
  const [inTma, setInTma] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const start = Date.now();
    const tick = () => {
      if (cancelled) return;
      if (isInTelegramMiniApp()) { setInTma(true); return; }
      if (Date.now() - start >= 3000) return;
      setTimeout(tick, 200);
    };
    tick();
    return () => { cancelled = true; };
  }, []);

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
      case 'windows': return <Monitor size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      case 'macos': return <Laptop size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      case 'linux': return <Monitor size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      case 'android': return <SmartphoneIcon size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      case 'ios': return <SmartphoneIcon size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
      default: return <MonitorSmartphone size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />;
    }
  };

  // Which clients we offer per platform, in display order. The FIRST entry is
  // the recommended one (gets the badge) and the default selection.
  //   • Windows        → only Happ (native HundlerVPN PC client was removed).
  //   • Android / iOS   → INCY (recommended) + Happ. v2rayTun dropped here.
  //   • macOS / Linux / unknown → Happ + v2rayTun.
  const clientsForOS = (os: typeof deviceOS): Array<'hundler' | 'happ' | 'v2raytun' | 'incy'> => {
    if (os === 'windows') return ['happ'];
    if (os === 'android' || os === 'ios') return ['incy', 'happ'];
    return ['happ', 'v2raytun'];
  };
  const availableClients = clientsForOS(deviceOS);
  // Switching device in the picker also resets to that platform's recommended
  // client so we never end up with an option that doesn't apply (e.g. 'hundler'
  // selected after switching to Android).
  const pickDeviceOS = (os: typeof deviceOS) => {
    setDeviceOS(os);
    setSetupClient(clientsForOS(os)[0]);
  };

  const getStoreLink = () => {
    if (setupClient === 'incy') {
      // INCY — offered on Android / iOS only.
      if (deviceOS === 'android') {
        return 'https://play.google.com/store/apps/details?id=llc.itdev.incy';
      }
      if (deviceOS === 'ios') {
        return 'https://apps.apple.com/us/app/incy/id6756943388';
      }
      return '';
    }
    if (setupClient === 'v2raytun') {
      // v2rayTun — https://v2raytun.com
      if (deviceOS === 'windows') {
        return 'https://storage.v2raytun.com/v2RayTun_Setup.exe';
      }
      if (deviceOS === 'android') {
        return 'https://play.google.com/store/apps/details?id=com.v2raytun.android';
      }
      if (deviceOS === 'ios' || deviceOS === 'macos') {
        return 'https://apps.apple.com/us/app/v2raytun/id6476628951';
      }
      // v2rayTun doesn't have a native Linux build
      return '';
    }
    // Happ Proxy Utility — https://github.com/Happ-proxy
    if (deviceOS === 'windows') {
      return 'https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe';
    }
    if (deviceOS === 'android') {
      return 'https://play.google.com/store/apps/details?id=com.happproxy&pli=1';
    }
    if (deviceOS === 'ios' || deviceOS === 'macos') {
      return setupRegion === 'russia'
        ? 'https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973'
        : 'https://apps.apple.com/us/app/happ-proxy-utility/id6504287215';
    }
    if (deviceOS === 'linux') {
      return 'https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.deb';
    }
    return '';
  };

  const openStoreLink = (customLink?: string) => {
    const link = customLink || getStoreLink();
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
    haptic('medium');
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
    haptic('medium');
    if ((!tgUser?.id && !userIdentifier) || !promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const promoBody: Record<string, unknown> = { code: promoCode.trim() };
      if (userIdentifier?.type === 'email') {
        promoBody.userId = userIdentifier.userId;
      } else if (userIdentifier?.type === 'telegram') {
        promoBody.telegramId = userIdentifier.telegramId;
        promoBody.username = tgUser?.username;
        promoBody.photoUrl = tgUser?.photo;
      } else if (tgUser?.id) {
        promoBody.telegramId = tgUser.id;
        promoBody.username = tgUser.username;
        promoBody.photoUrl = tgUser.photo;
      }
      const response = await fetch('/api/promos/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promoBody),
      });
      const data = await response.json();
      if (!response.ok) {
        setPromoError(data.error || 'Ошибка применения промокода');
        return;
      }
      
      // Скидочный промокод - переносим на страницу оплаты
      if (data.type === 'discount' && data.discountPercent > 0) {
        setShowPromoModal(false);
        setPromoCode('');
        // Сохраняем промокод и переходим на страницу оплаты
        onSetPendingPromo({ code: data.promoCode, discountPercent: data.discountPercent, promoId: data.promoId });
        navigate('payment');
        return;
      }
      
      // Промокод на дни - обновляем подписку
      setPromoCode('');
      if (userIdentifier) {
        await onSubscriptionChange(userIdentifier);
      } else if (tgUser?.id) {
        await onSubscriptionChange(tgUser.id);
      }
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
      {/* Setup Full-Page View */}
      <AnimatePresence>
        {showSetupModal && (
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-0 z-40 bg-gradient-to-b from-[#0a0a0a] via-[#050505] to-black flex flex-col overflow-hidden"
          >
            {/* Atmospheric red «0/1» digital rain. Sits behind everything
                else (sticky header has its own opaque backdrop, content
                area is transparent so the rain shows through). The
                canvas is `pointer-events-none` so it never eats taps.
                Density is intentionally LOW (0.05) — earlier passes at
                0.14 were swamping the call-to-action buttons; the rain
                should *frame* the content, not compete with it. The
                tap-burst effect was removed for the same reason — it
                was firing whenever a user simply pressed a control. */}
            <MatrixRain density={0.05} />

            {/* Header.
                Per UX policy (2026-05-14 update):
                  • In TMA (Mini App) — NO in-page buttons. The system
                    BackButton (wired via `useTelegramBackButton`
                    above) is the only nav affordance. Telegram's UX
                    guidelines explicitly say not to duplicate it in
                    HTML.
                  • Outside TMA (plain browser) — BOTH a back and a
                    close button, mirrored in the corners. The
                    asymmetric single-X pass got flagged as broken
                    UX: users couldn't return to the previous step
                    without using the page-level "Back to step" CTAs.
                  • The "1 OF 3" text was dropped — the three progress
                    bars communicate position by themselves. */}
            <div className="relative shrink-0 px-4 pb-3" style={{ paddingTop: 'calc(var(--sat) + 1rem)' }}>
              {!inTma && (
                <>
                  <button
                    onClick={handleSetupBack}
                    className="absolute top-[calc(var(--sat)+0.75rem)] left-3 w-8 h-8 flex items-center justify-center rounded-full border border-white/10 bg-black/40 backdrop-blur text-zinc-400 hover:text-white hover:border-white/30 transition-all active:scale-90 z-10"
                    aria-label="back"
                  >
                    <ChevronLeft size={14} strokeWidth={2.2} />
                  </button>
                  <button
                    onClick={closeSetupModal}
                    className="absolute top-[calc(var(--sat)+0.75rem)] right-3 w-8 h-8 flex items-center justify-center rounded-full border border-white/10 bg-black/40 backdrop-blur text-zinc-400 hover:text-white hover:border-white/30 transition-all active:scale-90 z-10"
                    aria-label="close"
                  >
                    <X size={14} strokeWidth={2.2} />
                  </button>
                </>
              )}
              {/* Progress bars sit in the centre regardless of which
                  side-buttons are showing. Width capped so the bar
                  cluster doesn't drift off-axis when the buttons
                  appear/disappear. */}
              <div className="flex items-center gap-1.5 max-w-md mx-auto px-10">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="relative h-1 flex-1 rounded-full bg-white/10 overflow-hidden">
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 via-red-400 to-red-500 shadow-[0_0_8px_rgba(239,68,68,0.45)]"
                      initial={false}
                      animate={{ width: s <= setupStep ? '100%' : '0%' }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Scrollable content.
                2026-05-14 v3:
                  • DESKTOP — bumped max-width from `max-w-md` (448px)
                    to `lg:max-w-2xl` (672px). At 1920px viewport the
                    448-wide column was sitting in the middle of an
                    ocean of black, which the user called «треш». 672
                    is roughly the legal-page column and reads as a
                    deliberate centred layout instead of a stranded
                    mobile card.
                  • MOBILE — vertically centre the wizard content.
                    Pattern: outer scroller + inner `min-h-full flex
                    flex-col justify-center`. When the wizard content
                    is shorter than the viewport (step 1 always is)
                    the flex layout centres it; when it overflows
                    (long device pickers, big QR pages on step 3)
                    `min-h-full` ensures the column still grows
                    naturally and scrolls. This is the standard
                    «centre-when-short, top-when-long» pattern. */}
            <div
              className="relative flex-1 overflow-y-auto"
              style={{
                paddingBottom: 'calc(var(--sab) + 2rem)',
                scrollbarGutter: 'stable both-edges',
              }}
            >
              <div className="min-h-full flex flex-col items-center justify-center px-4 sm:px-6 py-6 sm:py-10">
              <div className="w-full max-w-md lg:max-w-2xl mx-auto">
                <div className="relative mx-auto mb-5 sm:mb-8 flex h-24 w-24 sm:h-36 sm:w-36 items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-red-500/20 blur-2xl" />
                  <motion.div
                    className="absolute inset-0 rounded-full border border-red-500/25"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
                  />
                  <div className="absolute inset-2 sm:inset-3 rounded-full border border-white/15" />
                  <div className="absolute inset-4 sm:inset-6 rounded-full border border-white/10" />
                  <motion.div
                    key={setupStep}
                    initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                    className="relative z-10 flex h-14 w-14 sm:h-20 sm:w-20 items-center justify-center rounded-full bg-gradient-to-br from-red-500/30 via-zinc-900/80 to-zinc-950 border border-red-500/40 shadow-[0_0_28px_rgba(239,68,68,0.35)]"
                  >
                    {setupStep === 1 ? getDeviceIcon() : setupStep === 2 ? <Download size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} /> : <Key size={26} className="text-white sm:w-[38px] sm:h-[38px]" strokeWidth={1.8} />}
                  </motion.div>
                </div>

                {setupStep === 1 && (
                  <>
                    <h3 className="text-xl sm:text-2xl font-bold text-center text-white mb-2">{t.setupFor} {getDeviceLabel()}</h3>
                    <p className="text-zinc-400 text-center text-sm mb-5 sm:mb-6">{t.setupStepsHint}</p>

                    {/* Client chooser */}
                    <p className="text-zinc-500 text-[11px] uppercase tracking-[0.18em] text-center mb-2">{t.setupChooseClient}</p>
                    <div className="grid grid-cols-2 gap-2 mb-5 sm:mb-6">
                      {availableClients.map((client, idx) => {
                        const selected = setupClient === client;
                        const meta = {
                          hundler: { title: t.setupClientHundlerTitle, subtitle: t.setupClientHundlerSubtitle, icon: <Shield size={20} strokeWidth={1.8} className={selected ? 'text-white' : 'text-zinc-400'} /> },
                          happ: { title: t.setupClientHappTitle, subtitle: t.setupClientHappSubtitle, icon: <HappIcon size={20} className={selected ? 'text-white' : 'text-zinc-400'} /> },
                          v2raytun: { title: t.setupClientV2RayTunTitle, subtitle: t.setupClientV2RayTunSubtitle, icon: <V2RayTunIcon size={20} className={selected ? 'text-white' : 'text-zinc-400'} /> },
                          incy: { title: t.setupClientIncyTitle, subtitle: t.setupClientIncySubtitle, icon: <IncyIcon size={20} className={selected ? '' : 'opacity-70'} /> },
                        }[client];
                        // The FIRST client for the platform is the recommended one.
                        const recommended = idx === 0;
                        return (
                          <button
                            key={client}
                            onClick={() => { haptic('light'); setSetupClient(client); }}
                            className={`relative rounded-xl border px-3 py-3 backdrop-blur-sm transition-all text-left ${selected ? 'border-white/60 bg-white/[0.1] shadow-[0_0_16px_rgba(255,255,255,0.18)]' : 'border-white/10 bg-zinc-900/90 hover:border-white/20'}`}
                          >
                            {recommended && (
                              <div className="absolute -top-1.5 right-2 rounded-full bg-black border border-white/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                                {t.setupClientRecommended}
                              </div>
                            )}
                            <div className="flex flex-col gap-2">
                              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-white/40 bg-white/10' : 'border-white/10 bg-zinc-800/80'}`}>
                                {meta.icon}
                              </div>
                              <div className="min-w-0">
                                <p className={`font-semibold text-[13px] leading-tight truncate ${selected ? 'text-white' : 'text-zinc-200'}`}>{meta.title}</p>
                                <p className="text-zinc-500 text-[10px] leading-tight truncate">{meta.subtitle}</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-2.5">
                      <button
                        onClick={() => setSetupStep(2)}
                        className="w-full bg-gradient-to-r from-red-500 to-red-600 border border-red-400/30 text-white font-semibold py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm sm:text-base shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-shadow"
                      >
                        <ArrowRight size={16} /> {t.setupStart}
                      </button>

                      <button
                        onClick={() => setShowDevicePicker((prev) => !prev)}
                        className="w-full border border-white/20 text-white font-medium py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 transition-colors hover:text-white hover:border-white/25"
                      >
                        <MonitorSmartphone size={16} /> {t.setupOtherDevice}
                      </button>
                    </div>

                    {showDevicePicker && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-900/50 p-3">
                        <p className="text-zinc-400 text-xs uppercase tracking-wider mb-2">{t.setupChooseDevice}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => pickDeviceOS('windows')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'windows' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Windows</button>
                          <button onClick={() => pickDeviceOS('macos')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'macos' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>macOS</button>
                          <button onClick={() => pickDeviceOS('android')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'android' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Android</button>
                          <button onClick={() => pickDeviceOS('ios')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'ios' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>iPhone/iPad</button>
                          <button onClick={() => pickDeviceOS('linux')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'linux' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Linux</button>
                          <button onClick={() => pickDeviceOS('unknown')} className={`rounded-lg border px-3 py-2 text-sm transition-colors ${deviceOS === 'unknown' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>Other</button>
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
                    <h3 className="text-xl sm:text-2xl font-bold text-center text-white mb-2">{t.setupInstallTitle}</h3>
                    <p className="text-zinc-400 text-center text-sm mb-5 sm:mb-7">{t.setupInstallDesc}</p>

                    {setupClient === 'happ' && (deviceOS === 'ios' || deviceOS === 'macos') && (
                      <div className="mb-5">
                        <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2">{t.setupRegion}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => setSetupRegion('global')} className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${setupRegion === 'global' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>{t.setupGlobal}</button>
                          <button onClick={() => setSetupRegion('russia')} className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${setupRegion === 'russia' ? 'border-white/35 text-white bg-white/10' : 'border-white/10 text-zinc-300'}`}>{t.setupRussia}</button>
                        </div>
                      </div>
                    )}

                    {!getStoreLink() && !(deviceOS === 'linux' && setupClient === 'happ') && <p className="text-amber-300 text-xs mb-4">{t.setupNoStore}</p>}

                    <div className="space-y-2.5">
                      {deviceOS === 'linux' && setupClient === 'happ' ? (
                        <>
                          <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">{t.setupChooseFormat || 'Выберите формат'}</p>
                          <button
                            onClick={() => openStoreLink('https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.deb')}
                            className="w-full border border-white/20 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm transition-colors hover:border-white/35"
                          >
                            <Download size={16} /> .deb <span className="text-zinc-500 text-xs font-normal">(Ubuntu, Debian)</span>
                          </button>
                          <button
                            onClick={() => openStoreLink('https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.rpm')}
                            className="w-full border border-white/20 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm transition-colors hover:border-white/35"
                          >
                            <Download size={16} /> .rpm <span className="text-zinc-500 text-xs font-normal">(Fedora, RHEL)</span>
                          </button>
                          <button
                            onClick={() => openStoreLink('https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.pkg.tar.zst')}
                            className="w-full border border-white/20 text-white font-semibold py-3 sm:py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm transition-colors hover:border-white/35"
                          >
                            <Download size={16} /> .pkg.tar.zst <span className="text-zinc-500 text-xs font-normal">(Arch)</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => openStoreLink()}
                          disabled={!getStoreLink()}
                          className="w-full border border-white/20 text-white font-semibold py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40 text-sm sm:text-base transition-colors hover:border-white/35"
                        >
                          <Download size={16} /> {t.setupInstallButton}
                        </button>
                      )}

                      <button
                        onClick={() => { setSetupStep(3); fetchVpnKey(); }}
                        className="w-full bg-gradient-to-r from-red-500 to-red-600 border border-red-400/30 text-white font-semibold py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm sm:text-base shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-shadow"
                      >
                        <ArrowRight size={16} /> {t.setupNext}
                      </button>
                    </div>
                  </>
                )}

                {setupStep === 3 && (
                  <>
                    <h3 className="text-xl sm:text-2xl font-bold text-center text-white mb-2">{t.setupAddTitle}</h3>
                    <p className="text-zinc-400 text-center text-sm mb-5">{subscriptionUrl ? 'Скопируйте ссылку подписки и вставьте её в VPN-приложение.' : t.setupAddDesc}</p>

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
                      className="w-full bg-gradient-to-r from-red-500 to-red-600 border border-red-400/30 text-white font-semibold py-3.5 sm:py-4 rounded-full flex items-center justify-center gap-2 active:scale-95 text-sm sm:text-base shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-shadow"
                    >
                      <ArrowRight size={16} /> {t.setupFinish}
                    </button>
                  </>
                )}
              </div>
              </div>
            </div>
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
        {/* Logo — pre-composited tiger + network mesh PNG with a soft
            radial alpha mask so the black backdrop blends into the
            page. See components/TigerNetworkLogo.tsx. */}
        {/* 2026-05-24 (v4): тигр на ноутбуках был всё ещё слишком большим
            (427×427 на 13"-14" ~ половина высоты viewport, и карточка
            «Подписка» прижималась к низу). Двухступенчатая адаптация:
              • lg (1024-1279, тип. 1366×768 ноутбук) → 280×280
              • xl (≥1280, нормальные мониторы) → 340×340
            Mobile 146×146 оставляем как есть.
            История: v1 = 640, v2 = 480, v3 = 427, v4 = 280/340.
            History:
              • 2026-05-13a desktop=320 (felt cramped)
              • 2026-05-14 desktop=640 (felt huge)
              • 2026-05-14 v3 desktop=427 (this) */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-[146px] h-[146px] lg:w-[280px] lg:h-[280px] xl:w-[340px] xl:h-[340px]"
        >
          <TigerNetworkLogo className="w-full h-full" />
        </motion.div>

        {/* 2026-05-06 v2.1 compact premium subscription card per user feedback
            ("выглядит хуёво... мне не приходилось листать вниз"):
              - shield icon removed entirely (user said: "эмодзи ебаного щита убери")
              - hero row: BIG day counter (left) + clickable devices chip (right)
                — devices chip itself opens the (redesigned) devices modal,
                  so the bottom-row "My devices" button is gone
              - bottom row reduced to 2 chips: Referral + Promo
              — total card height ~140px shorter than v1 */}
        <div className="w-full max-w-[320px] lg:max-w-[540px] relative rounded-3xl border border-white/15 bg-zinc-900/70 backdrop-blur-md overflow-hidden shadow-[0_20px_60px_-25px_rgba(0,0,0,0.6)]">
          {/* ambient red halo (one) */}
          <div className="pointer-events-none absolute -top-24 -right-24 w-60 h-60 rounded-full bg-red-500/[0.09] blur-3xl" />
          {/* faint top sheen */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

          <div className="relative p-4 lg:p-5">
            {/* Header: plan name (no shield icon) + active/inactive status pill */}
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-white font-semibold text-base lg:text-lg leading-tight truncate">{t.planName}</h3>
              <span
                className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full border ${
                  hasActiveSubscription
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                    : 'bg-zinc-500/10 text-zinc-400 border-white/10'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    hasActiveSubscription
                      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                      : 'bg-zinc-500'
                  }`}
                />
                {hasActiveSubscription
                  ? (lang === 'ru' ? 'Активна' : 'Active')
                  : (lang === 'ru' ? 'Неактивна' : 'Inactive')}
              </span>
            </div>

            {/* Hero: days counter on its own row. The devices chip used to
                live inline on the right (72×72 icon + count) but users were
                missing it / not understanding what the smartphone icon meant
                — moved to a dedicated full-width pill below with the explicit
                "Устройства" label so the affordance is obvious. */}
            <div className="mb-3">
              {hasActiveSubscription ? (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-white font-bold text-[44px] lg:text-5xl tracking-tight tabular-nums leading-none">
                      {daysLeft}
                    </span>
                    <span className="text-zinc-400 text-sm font-medium">
                      {lang === 'ru'
                        ? (daysLeft % 10 === 1 && daysLeft % 100 !== 11
                            ? 'день'
                            : daysLeft % 10 >= 2 && daysLeft % 10 <= 4 && (daysLeft % 100 < 12 || daysLeft % 100 > 14)
                              ? 'дня'
                              : 'дней')
                        : (daysLeft === 1 ? 'day left' : 'days left')}
                    </span>
                  </div>
                  <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <Calendar size={11} className="text-zinc-600" strokeWidth={1.75} />
                    <span className="truncate">{t.until} {subscriptionEndDateLabel}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-white font-bold text-xl lg:text-2xl tracking-tight leading-tight">
                    {lang === 'ru' ? 'Подписка не активна' : 'No subscription'}
                  </div>
                  <p className="mt-1 text-zinc-500 text-[11px]">
                    {lang === 'ru' ? 'Оформите подписку ниже' : 'Activate one below'}
                  </p>
                </>
              )}
            </div>

            {/* Devices pill — full-width horizontal row.
                Layout: [icon-tile] · "Устройства" · [N/MAX badge] · [›]
                Replaces the previous icon-only 72×72 chip. The label +
                badge make the count and the affordance obvious without
                requiring users to decode the smartphone icon.
                Red treatment kicks in when at limit. */}
            <button
              onClick={handleDevicesClick}
              className={`w-full mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all active:scale-[0.99] ${
                devices.length >= maxDevices
                  ? 'border-red-500/30 bg-red-500/[0.06] hover:bg-red-500/[0.10]'
                  : 'border-white/15 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.07]'
              }`}
              title={t.myDevices}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  devices.length >= maxDevices ? 'bg-red-500/15' : 'bg-white/[0.06]'
                }`}
              >
                <Smartphone
                  size={18}
                  strokeWidth={1.75}
                  className={devices.length >= maxDevices ? 'text-red-300' : 'text-zinc-200'}
                />
              </div>
              <span className="flex-1 text-left text-white text-sm font-semibold leading-none">
                {t.devices}
              </span>
              <span
                className={`tabular-nums text-sm font-bold px-2 py-1 rounded-md ${
                  devices.length >= maxDevices
                    ? 'bg-red-500/20 text-red-300'
                    : 'bg-white/[0.06] text-white'
                }`}
              >
                {devices.length}
                <span
                  className={
                    devices.length >= maxDevices
                      ? 'text-red-400/60 font-medium'
                      : 'text-zinc-500 font-medium'
                  }
                >
                  /{maxDevices}
                </span>
              </span>
              <ChevronRight
                size={14}
                strokeWidth={1.75}
                className={
                  devices.length >= maxDevices
                    ? 'text-red-400 shrink-0'
                    : 'text-zinc-400 shrink-0'
                }
              />
            </button>

            {/* Primary CTA: Extend (solid red premium) */}
            <button
              onClick={() => { haptic('medium'); navigate('payment'); }}
              className="w-full mb-2 bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.99] transition-all shadow-[0_8px_24px_-8px_rgba(239,68,68,0.5)]"
            >
              <Zap size={15} strokeWidth={2.25} />
              <span>{t.extend}</span>
              <ChevronRight size={14} strokeWidth={2.25} className="ml-0.5" />
            </button>

            {/* Secondary CTA: Install (clean glass — no shimmer/glow) */}
            <button
              onClick={handleInstallClick}
              className="w-full mb-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/15 hover:border-white/25 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
            >
              <Settings size={15} strokeWidth={1.75} className="text-zinc-300" />
              <span className="lg:hidden truncate">{t.installShort}</span>
              <span className="hidden lg:inline truncate">{t.install}</span>
              <ChevronRight size={14} strokeWidth={1.75} className="text-zinc-400 ml-0.5 shrink-0" />
            </button>

            {/* Bottom rows: Referral + Promo stacked full-width — RU label
                "Реферальная система" was being truncated in a 2-col grid.
                User explicitly asked: "если нужно кнопку друг за другом поставь". */}
            <div className="space-y-1.5">
              <button
                onClick={handleReferralClick}
                disabled={!referralCode}
                className="w-full bg-white/[0.03] border border-white/10 hover:border-white/20 hover:bg-white/[0.06] text-zinc-300 hover:text-white text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-1.5 active:scale-[0.99] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Users size={12} className="text-zinc-500 shrink-0" strokeWidth={1.75} /> {t.referral}
              </button>
              <button
                onClick={handlePromoClick}
                className="w-full bg-white/[0.03] border border-white/10 hover:border-white/20 hover:bg-white/[0.06] text-zinc-300 hover:text-white text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-1.5 active:scale-[0.99] transition-colors"
              >
                <Gift size={12} className="text-zinc-500 shrink-0" strokeWidth={1.75} /> {t.promo}
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Promo Modal — premium glass shell, matches subscription card style:
          one subtle red halo, white sheen along top, white-outlined input,
          solid red apply button. */}
      <AnimatePresence>
        {showPromoModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
            onClick={closePromoModal}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md relative rounded-3xl border border-white/15 bg-zinc-900/80 backdrop-blur-xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
            >
              {/* ambient red halo */}
              <div className="pointer-events-none absolute -top-24 -right-24 w-60 h-60 rounded-full bg-red-500/[0.10] blur-3xl" />
              {/* faint top sheen */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

              <div className="relative p-5">
                {/* Header */}
                <div className="flex items-center gap-3 pb-4 mb-5 border-b border-white/10">
                  <div className="w-11 h-11 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Gift size={18} strokeWidth={1.75} className="text-zinc-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-semibold text-base leading-tight">{t.promo}</h3>
                    <p className="text-zinc-500 text-xs mt-0.5">
                      {lang === 'ru' ? 'Введите код для активации скидки или дней' : 'Enter a code to redeem days or a discount'}
                    </p>
                  </div>
                  <button
                    onClick={closePromoModal}
                    className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Input */}
                <label className="block text-zinc-400 text-[10px] font-semibold uppercase tracking-[0.12em] mb-2">
                  {lang === 'ru' ? 'Код промокода' : 'Promo code'}
                </label>
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  placeholder={t.promoPlaceholder}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30 transition-colors font-mono tracking-wider"
                  autoFocus
                />

                {promoError && (
                  <div className="mt-3 px-3 py-2 rounded-xl border border-red-500/25 bg-red-500/[0.08] text-red-300 text-xs">
                    {promoError}
                  </div>
                )}

                <button
                  onClick={handleApplyPromo}
                  disabled={promoLoading || !promoCode.trim() || (!tgUser?.id && !userIdentifier)}
                  className="mt-4 w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.99] transition-all shadow-[0_8px_24px_-8px_rgba(239,68,68,0.5)] disabled:opacity-50 disabled:hover:bg-red-500"
                >
                  {promoLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Zap size={15} strokeWidth={2.25} />
                      <span>{t.promoApply}</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Devices Modal — premium glass shell, refined device list cards. */}
      <AnimatePresence>
        {showDevicesModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
            onClick={() => setShowDevicesModal(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[85vh] flex flex-col relative rounded-3xl border border-white/15 bg-zinc-900/80 backdrop-blur-xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
            >
              {/* ambient red halo */}
              <div className="pointer-events-none absolute -top-24 -right-24 w-60 h-60 rounded-full bg-red-500/[0.10] blur-3xl" />
              {/* faint top sheen */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

              <div className="relative p-5 pb-3 shrink-0">
                {/* Header */}
                <div className="flex items-center gap-3 pb-4 border-b border-white/10">
                  <div className="w-11 h-11 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Smartphone size={18} strokeWidth={1.75} className="text-zinc-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-semibold text-base leading-tight">{t.myDevices}</h3>
                    <p className="text-zinc-500 text-xs mt-0.5 tabular-nums">
                      <span className={devices.length >= maxDevices ? 'text-red-300 font-semibold' : 'text-zinc-300 font-semibold'}>
                        {devices.length}
                      </span>
                      <span> / {maxDevices} {lang === 'ru' ? 'устройств' : 'devices'}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDevicesModal(false)}
                    className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                {devices.length >= maxDevices && (
                  <div className="mt-4 px-3 py-2.5 rounded-xl border border-red-500/25 bg-red-500/[0.08] text-red-300 text-[11px] leading-relaxed">
                    {t.deviceLimitReached}
                  </div>
                )}
              </div>

              <div className="relative px-5 pb-5 flex-1 overflow-y-auto">
                {devicesLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-white/70 animate-spin" />
                  </div>
                ) : devices.length === 0 ? (
                  <div className="text-center py-10 rounded-2xl border border-white/10 bg-white/[0.02]">
                    <div className="w-14 h-14 mx-auto mb-3 rounded-2xl border border-white/15 bg-white/[0.03] flex items-center justify-center">
                      <MonitorSmartphone size={26} strokeWidth={1.75} className="text-zinc-300" />
                    </div>
                    <p className="text-zinc-300 text-sm font-medium">
                      {lang === 'ru' ? 'Нет подключённых устройств' : 'No connected devices'}
                    </p>
                    <p className="text-zinc-500 text-xs mt-1">
                      {lang === 'ru' ? 'Установите VPN на любом устройстве — оно появится здесь' : 'Install VPN on any device — it will appear here'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {devices.map((device) => (
                      <div
                        key={device.id}
                        className="flex items-center gap-3 p-3 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                      >
                        <div className="w-10 h-10 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                          <MonitorSmartphone size={17} strokeWidth={1.75} className="text-zinc-200" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">
                            {device.device_name || (lang === 'ru' ? 'Устройство' : 'Device')}
                          </p>
                          {device.last_seen_at && (
                            <p className="text-[10px] text-zinc-500 mt-0.5">
                              {lang === 'ru' ? 'Активно' : 'Last seen'}: {new Date(device.last_seen_at).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteDevice(device.id)}
                          className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-zinc-500 hover:text-red-300 hover:border-red-500/25 hover:bg-red-500/[0.06] transition-colors shrink-0"
                          title={t.deleteDevice}
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The shared <ReferralModal /> lives at the App root so the home
          CTA, profile menu and the desktop sidebar can all open the same
          instance. handleReferralClick just calls the onOpenReferral prop. */}
    </>
  );
}
