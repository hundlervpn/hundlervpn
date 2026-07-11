'use client';

import { useState, useEffect } from 'react';
import { Bitcoin, Wallet, X, Tag, Server } from 'lucide-react';
import { motion } from 'motion/react';
import { haptic } from '@/lib/haptic';
import { PRICE_PER_DAY_RUB, calculatePricing, getDurationDiscountPercent } from '@/lib/pricing';
import SparkyButton from '@/components/SparkyButton';
import { SbpIcon, CryptoBotIcon } from '@/components/PaymentIcons';
import PaymentMethodBtn from '@/components/ui/PaymentMethodBtn';
import { pageVariants } from '@/app/_shared/constants';
import type { UserIdentifier } from '@/app/_shared/types';

export default function PaymentView({ t, direction, tgUser, onSubscriptionChange, userIdentifier, pendingPromo, onClearPendingPromo }: { t: any, direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; onSubscriptionChange: (id: number | UserIdentifier) => Promise<void>; userIdentifier: UserIdentifier | null; pendingPromo?: { code: string; discountPercent: number; promoId: number } | null; onClearPendingPromo?: () => void }) {
  const PRICE_PER_DAY = PRICE_PER_DAY_RUB;
  const MIN_DAYS = 3;
  const MAX_DAYS = 365;
  const PRESET_DAYS = [3, 7, 14, 30, 90, 180, 365];
  const [days, setDays] = useState(30);
  const [payMethod, setPayMethod] = useState<'crypto' | 'sbp'>('sbp');
  const [isLoading, setIsLoading] = useState(false);
  const [sbpState, setSbpState] = useState<'idle' | 'creating' | 'waiting' | 'success' | 'failed'>('idle');
  const [sbpPaymentId, setSbpPaymentId] = useState<number | null>(null);
  const [sbpRedirectUrl, setSbpRedirectUrl] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountPercent: number; promoId?: number } | null>(null);
  const [promoError, setPromoError] = useState('');

  // Автоматически применяем pendingPromo при загрузке
  useEffect(() => {
    if (pendingPromo && !appliedPromo) {
      setAppliedPromo({ code: pendingPromo.code, discountPercent: pendingPromo.discountPercent, promoId: pendingPromo.promoId });
      onClearPendingPromo?.();
    }
  }, [pendingPromo]);

  // Centralized pricing — see lib/pricing.ts. Auto-discount tiers stack
  // with promo codes multiplicatively (rawTotal × (1 − duration%) × (1 − promo%)).
  // Server-side recomputes the same numbers in /api/payments/sbp/create
  // and /api/crypto-invoice — never trust the client `amount`.
  const promoPct = appliedPromo?.discountPercent ?? 0;
  const pricing = calculatePricing(days, promoPct);
  const rawTotal = pricing.rawTotal;
  const totalPrice = pricing.finalTotal;
  const durationDiscountPct = pricing.durationDiscountPercent;
  const discountAmount = pricing.durationDiscountAmount + pricing.promoDiscountAmount;
  const totalUsd = +(totalPrice / 100).toFixed(2);

  const handleApplyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const userParam = userIdentifier?.type === 'telegram' ? `&telegramId=${userIdentifier.telegramId}` : userIdentifier?.type === 'email' ? `&userId=${userIdentifier.userId}` : tgUser?.id ? `&telegramId=${tgUser.id}` : '';
      const res = await fetch(`/api/promos/validate?code=${encodeURIComponent(code)}${userParam}`);
      const data = await res.json();
      if (res.ok && data.ok && data.discountPercent > 0) {
        setAppliedPromo({ code: data.code, discountPercent: data.discountPercent, promoId: data.promoId });
        setPromoError('');
      } else if (res.ok && data.ok && data.days > 0) {
        setPromoError('Этот промокод даёт бесплатные дни — примените его на главной');
      } else {
        setPromoError(data.error || 'Промокод недействителен');
      }
    } catch {
      setPromoError('Ошибка проверки');
    } finally {
      setPromoLoading(false);
    }
  };

  const handleRemovePromo = () => {
    haptic('light');
    setAppliedPromo(null);
    setPromoInput('');
    setPromoError('');
  };

  useEffect(() => {
    if (sbpState !== 'waiting' || !sbpPaymentId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/sbp/status?paymentId=${sbpPaymentId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'paid') {
          setSbpState('success');
          setAppliedPromo(null); // Очищаем промокод после успешной оплаты
          clearInterval(interval);
          if (userIdentifier) {
            setTimeout(() => { void onSubscriptionChange(userIdentifier); }, 1000);
          } else if (tgUser?.id) {
            setTimeout(() => { void onSubscriptionChange(tgUser.id); }, 1000);
          }
        } else if (data.status === 'failed') {
          setSbpState('failed');
          clearInterval(interval);
        }
      } catch { /* ignore polling errors */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [sbpState, sbpPaymentId]);

  const handleSbpCancel = () => {
    haptic('medium');
    setSbpState('idle');
    setSbpPaymentId(null);
    setSbpRedirectUrl(null);
  };

  const handleSubscribe = async () => {
    haptic('heavy');
    setIsLoading(true);
    try {
      if (payMethod === 'crypto') {
        const reqBody: Record<string, unknown> = { days, amount: totalPrice };
        if (userIdentifier?.type === 'telegram') {
          reqBody.telegramId = userIdentifier.telegramId;
        } else if (userIdentifier?.type === 'email') {
          reqBody.userId = userIdentifier.userId;
        } else if (tgUser?.id) {
          reqBody.telegramId = tgUser.id;
        }
        if (appliedPromo?.promoId) {
          reqBody.promoId = appliedPromo.promoId;
          reqBody.promoCode = appliedPromo.code;
        }

        const response = await fetch('/api/crypto-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        const data = await response.json();
        if (data.ok && data.paymentUrl) {
          if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
            window.Telegram.WebApp.openLink(data.paymentUrl);
          } else {
            window.location.href = data.paymentUrl;
          }
        } else {
          alert(data.error || 'Ошибка создания крипто-счета');
        }
      } else if (payMethod === 'sbp') {
        setSbpState('creating');
        const reqBody: Record<string, unknown> = { days, amount: totalPrice };
        if (userIdentifier?.type === 'telegram') {
          reqBody.telegramId = userIdentifier.telegramId;
        } else if (userIdentifier?.type === 'email') {
          reqBody.userId = userIdentifier.userId;
        } else if (tgUser?.id) {
          reqBody.telegramId = tgUser.id;
        }
        // Передаём промокод если применён
        if (appliedPromo?.promoId) {
          reqBody.promoId = appliedPromo.promoId;
          reqBody.promoCode = appliedPromo.code;
        }

        const response = await fetch('/api/payments/sbp/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        const data = await response.json();
        if (data.ok && data.redirect) {
          setSbpPaymentId(data.paymentId);
          setSbpRedirectUrl(data.redirect);
          setSbpState('waiting');
          if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
            window.Telegram.WebApp.openLink(data.redirect);
          } else {
            window.open(data.redirect, '_blank');
          }
        } else {
          setSbpState('idle');
          alert(data.error || 'Ошибка создания платежа СБП');
        }
      }
    } catch (error) {
      console.error('Payment error:', error);
      setSbpState('idle');
      alert('Произошла ошибка');
    } finally {
      setIsLoading(false);
    }
  };

  if (sbpState === 'waiting' || sbpState === 'success' || sbpState === 'failed') {
    return (
      <motion.div
        custom={direction}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="flex flex-col gap-3 flex-1 lg:items-center"
      >
        <div className="w-full max-w-sm mx-auto flex flex-col items-center lg:max-w-[780px]">
          <div className="bg-zinc-900/40 border border-white/10 rounded-xl p-6 w-full text-center">
            {sbpState === 'waiting' && (
              <>
                <div className="flex justify-center mb-4">
                  <div className="w-10 h-10 border-2 border-white/20 border-t-blue-400 rounded-full animate-spin" />
                </div>
                <h3 className="text-white font-medium text-sm mb-2">Ожидание оплаты через СБП</h3>
                <p className="text-zinc-400 text-xs mb-4">Завершите оплату в открывшемся окне. Статус обновится автоматически.</p>
                {sbpRedirectUrl && (
                  <button
                    onClick={() => {
                      if (typeof window !== 'undefined' && window.Telegram?.WebApp?.openLink) {
                        window.Telegram.WebApp.openLink(sbpRedirectUrl);
                      } else {
                        window.open(sbpRedirectUrl, '_blank');
                      }
                    }}
                    className="w-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium py-2.5 rounded-lg hover:bg-blue-500/30 transition-colors text-sm mb-2"
                  >
                    Открыть страницу оплаты
                  </button>
                )}
                <button
                  onClick={handleSbpCancel}
                  className="w-full text-zinc-500 text-xs py-2 hover:text-zinc-300 transition-colors"
                >
                  Отмена
                </button>
              </>
            )}
            {sbpState === 'success' && (
              <>
                <div className="text-3xl mb-3">✅</div>
                <h3 className="text-white font-medium text-sm mb-2">Оплата прошла успешно!</h3>
                <p className="text-zinc-400 text-xs mb-4">Подписка активирована. Статус обновится через несколько секунд.</p>
                <button onClick={handleSbpCancel} className="w-full bg-white text-black font-medium py-2.5 rounded-lg hover:bg-zinc-200 transition-colors text-sm">
                  Готово
                </button>
              </>
            )}
            {sbpState === 'failed' && (
              <>
                <div className="text-3xl mb-3">❌</div>
                <h3 className="text-white font-medium text-sm mb-2">Оплата не прошла</h3>
                <p className="text-zinc-400 text-xs mb-4">Платёж был отменён или произошла ошибка. Попробуйте ещё раз.</p>
                <button onClick={handleSbpCancel} className="w-full bg-white text-black font-medium py-2.5 rounded-lg hover:bg-zinc-200 transition-colors text-sm">
                  Назад
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // Tariff cards (2×2 grid). Each card represents a "named" plan that
  // maps to a specific number of days. Tapping a card sets `days` so
  // the slider below stays in sync. Layout/UX inspired by Volna VPN
  // Shop screenshot (2026-05-13) but in our brand palette: black canvas
  // + red accents instead of blue.
  const PLAN_CARDS: { label: string; days: number }[] = [
    { label: '1 месяц', days: 30 },
    { label: '3 месяца', days: 90 },
    { label: '6 месяцев', days: 180 },
    { label: '1 год', days: 365 },
  ];
  // Find the card with the highest auto-discount tier — gets the
  // "ВЫГОДНО" badge. Ties broken by longest duration.
  const bestPlanDays = (() => {
    let bestPct = 0;
    let bestDays = PLAN_CARDS[PLAN_CARDS.length - 1]!.days;
    for (const p of PLAN_CARDS) {
      const pct = getDurationDiscountPercent(p.days);
      if (pct > bestPct || (pct === bestPct && p.days > bestDays)) {
        bestPct = pct;
        bestDays = p.days;
      }
    }
    return bestDays;
  })();

  return (
    <motion.div 
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col gap-3 flex-1 lg:items-stretch lg:w-full"
    >
      {/* Single-column flow on both mobile and desktop. The block is
          centered and capped at a comfortable reading width so the
          tariff cards stay scannable instead of stretching across the
          whole 1280px content area.
          2026-05-13 v2 — user feedback: «промокод и выбор оплаты вниз
          пусть перекочуют, всё должно быть в столбец друг за другом». */}
      <div className="w-full mx-auto flex flex-col gap-3 lg:gap-4 max-w-sm lg:max-w-2xl">
        {/* Left column: tariff plans grid (2×2) + duration slider. */}
        <motion.div 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.25 }}
          className="relative overflow-hidden bg-gradient-to-br from-zinc-900/60 via-zinc-900/40 to-black/60 border border-red-500/20 rounded-2xl p-4 lg:p-6"
        >
          {/* Decorative red glow — keeps the "premium" feel without
              breaking the strict black/red palette. */}
          <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-red-500/10 blur-3xl pointer-events-none" />

          {/* Plan grid 2×2. Each card is large + tappable; selected =
              red gradient + glow, default = subtle dark. */}
          <div className="relative grid grid-cols-2 gap-2 mb-4 lg:gap-3">
            {PLAN_CARDS.map((plan) => {
              const isSelected = days === plan.days;
              const presetPct = getDurationDiscountPercent(plan.days);
              const planPrice = plan.days * PRICE_PER_DAY;
              const planDiscounted = Math.round(planPrice * (1 - presetPct / 100));
              const planPerMonth = Math.round(planDiscounted / Math.max(1, plan.days / 30));
              const isBest = plan.days === bestPlanDays;
              return (
                <SparkyButton
                  key={plan.days}
                  onClick={() => { haptic('light'); setDays(plan.days); }}
                  className={`relative text-left rounded-xl border p-3 transition-all overflow-hidden ${
                    isSelected
                      ? 'border-red-500/60 bg-gradient-to-br from-red-500/15 via-red-500/8 to-transparent shadow-[0_0_24px_rgba(239,68,68,0.25)]'
                      : 'border-white/10 bg-zinc-900/60 hover:border-red-500/30 hover:bg-zinc-900/80'
                  }`}
                >
                  {/* "Выгодно" badge — only on the best-value plan. */}
                  {isBest && (
                    <div className="absolute -top-px right-3 px-2 py-0.5 rounded-b-md bg-red-500 text-white text-[9px] font-bold uppercase tracking-wider shadow-[0_2px_8px_rgba(239,68,68,0.5)]">
                      Выгодно
                    </div>
                  )}
                  <div className={`text-sm font-semibold mb-2 ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                    {plan.label}
                  </div>
                  <div className="flex items-end justify-between gap-1">
                    <div className="min-w-0">
                      {presetPct > 0 ? (
                        <>
                          <div className="text-zinc-500 text-[10px] line-through leading-none">{planPrice}₽</div>
                          <div className="text-white text-lg font-bold leading-tight lg:text-2xl">{planDiscounted}₽</div>
                        </>
                      ) : (
                        <div className="text-white text-lg font-bold leading-tight lg:text-2xl">{planDiscounted}₽</div>
                      )}
                      {plan.days >= 60 && (
                        <div className="text-zinc-500 text-[10px] mt-0.5 leading-none">{planPerMonth}₽ в мес.</div>
                      )}
                    </div>
                    {presetPct > 0 && (
                      <div className="shrink-0 px-1.5 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 text-[9px] font-bold leading-none">
                        −{presetPct}%
                      </div>
                    )}
                  </div>
                </SparkyButton>
              );
            })}
          </div>

          {/* Slider section — fine-tune days when none of the presets fit. */}
          <div className="relative pt-3 border-t border-white/5">
            <div className="flex justify-between items-end mb-2.5">
              <div>
                <span className="text-zinc-500 text-[10px] uppercase tracking-widest font-medium">Длительность</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-2xl font-bold text-white lg:text-3xl">{days}</span>
                  <span className="text-zinc-400 text-xs">{t.daysLabel}</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-zinc-500 text-[10px] uppercase tracking-widest font-medium">Цена</span>
                <div className="text-white font-bold text-base lg:text-xl mt-0.5">
                  {PRICE_PER_DAY}₽ <span className="text-[10px] text-zinc-500">{t.perDay}</span>
                </div>
              </div>
            </div>
            <input 
              type="range" min={MIN_DAYS} max={MAX_DAYS} value={days} 
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="w-full h-1.5 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-red-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(239,68,68,0.6)] [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-red-500 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0"
              style={{ background: `linear-gradient(to right, #ef4444 ${(days - MIN_DAYS) / (MAX_DAYS - MIN_DAYS) * 100}%, #27272a ${(days - MIN_DAYS) / (MAX_DAYS - MIN_DAYS) * 100}%)` }}
            />
            <div className="flex justify-between text-zinc-600 text-[10px] mt-1.5 font-medium">
              <span>{MIN_DAYS} {t.daysLabel}</span>
              <span>{MAX_DAYS} {t.daysLabel}</span>
            </div>
          </div>

          {/* Total summary block — strikethrough when discount applies. */}
          {durationDiscountPct > 0 && (
            <div className="relative mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
              <span className="text-red-400 text-xs font-medium">
                Скидка за длительность −{durationDiscountPct}%
              </span>
              <span className="text-red-400 text-xs font-semibold">
                −{pricing.durationDiscountAmount}₽
              </span>
            </div>
          )}
          <div className={`relative ${durationDiscountPct > 0 ? 'mt-2' : 'mt-3 pt-3 border-t border-white/5'} flex justify-between items-center`}>
            <span className="text-zinc-400 text-xs">{t.total}</span>
            <div className="text-right">
              {(durationDiscountPct > 0 || appliedPromo) ? (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 text-xs line-through">{rawTotal}₽</span>
                  <span className="text-lg font-bold text-white">{totalPrice}₽</span>
                </div>
              ) : (
                <span className="text-lg font-bold text-white">{totalPrice}₽</span>
              )}
            </div>
          </div>
        </motion.div>

        {/* Continuation of the vertical flow: promo → pay method →
            features → CTA. Same order on mobile and desktop. */}
        <div className="flex flex-col gap-3 lg:gap-4">

        {/* Promo code field. */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.12, duration: 0.25 }}
          className="bg-zinc-900/40 border border-white/10 rounded-xl p-3 lg:p-4"
        >
          {appliedPromo ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag size={14} className="text-red-400" />
                <span className="text-sm text-red-400 font-medium">{appliedPromo.code} (-{appliedPromo.discountPercent}%)</span>
              </div>
              <button onClick={handleRemovePromo} className="text-zinc-500 hover:text-red-400 transition-colors">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                  placeholder={t.promoPlaceholder}
                  className="flex-1 bg-zinc-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-red-500/40"
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyPromo()}
                />
                <button
                  onClick={handleApplyPromo}
                  disabled={promoLoading || !promoInput.trim()}
                  className="bg-white/10 border border-white/15 text-white px-3 rounded-lg text-xs hover:bg-white/15 disabled:opacity-50 shrink-0"
                >
                  {promoLoading ? '...' : t.promoApply}
                </button>
              </div>
              {promoError && <p className="text-red-400 text-[10px] mt-1.5">{promoError}</p>}
            </div>
          )}
        </motion.div>

        {/* Payment method — wide row tiles like the Volna shop screenshot
            but in our palette. SBP = red accent (default), Crypto = white
            accent. */}
        <motion.div 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.25 }}
          className="grid grid-cols-2 gap-2 lg:gap-3"
        >
          {/* 2026-05-13: replaced lucide Wallet/Bitcoin with brand-coloured
              official logos (SBP sigil, CryptoBot mark). Active state is
              encoded in the icon component via opacity — the parent
              `PaymentMethodBtn` still drives the border/glow. */}
          <PaymentMethodBtn icon={<SbpIcon size={20} active={payMethod === 'sbp'} />} label={t.paySbp} isActive={payMethod === 'sbp'} onClick={() => setPayMethod('sbp')} />
          <PaymentMethodBtn icon={<CryptoBotIcon size={20} active={payMethod === 'crypto'} />} label={t.payCrypto} isActive={payMethod === 'crypto'} onClick={() => setPayMethod('crypto')} />
        </motion.div>

        {/* Features list intentionally removed 2026-05-13 — the
            checkout screen is for confirming the purchase, not
            re-selling. Plan capabilities (devices count, unlimited
            bandwidth) are already surfaced earlier in the funnel. */}

        {/* Big red CTA — full width, integrated price. Same shape as the
            tgstore Premium button so the brand feels consistent. */}
        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2, duration: 0.25 }}>
          <button
            onClick={handleSubscribe}
            disabled={isLoading || sbpState === 'creating'}
            className="group relative w-full overflow-hidden rounded-xl py-3.5 px-4 font-bold text-white text-sm flex items-center justify-between gap-2 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all bg-gradient-to-r from-red-600 via-red-500 to-red-600 shadow-[0_8px_32px_-8px_rgba(239,68,68,0.6)] hover:shadow-[0_8px_36px_-6px_rgba(239,68,68,0.75)]"
          >
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
            <span className="relative flex items-center gap-2">
              <Wallet size={16} />
              {isLoading || sbpState === 'creating' ? 'Загрузка…' : t.subscribe}
            </span>
            <span className="relative px-2.5 py-1 rounded-lg bg-black/25 text-white font-bold text-[13px] tracking-wide">
              {totalPrice}₽
            </span>
          </button>
        </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
