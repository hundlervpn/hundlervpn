'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Gift,
  X,
  Send,
  Copy,
  ClipboardCheck,
  Users as UsersIcon,
  Loader2,
  User as UserIcon,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Info,
  CheckCircle2,
  CreditCard,
  Sparkles,
  Wallet,
  ArrowDownToLine,
} from 'lucide-react';
import { haptic } from '@/lib/haptic';
import WithdrawalModal from '@/components/WithdrawalModal';

/**
 * Compact relative-time formatter used in the invitees list. Avoids pulling
 * in dayjs / date-fns just for one helper. Falls back to a localized
 * absolute date once the difference exceeds 30 days.
 */
function formatRelativeDate(iso: string, lang: 'ru' | 'en'): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const ru = lang === 'ru';
  if (diffSec < 60) return ru ? 'только что' : 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return ru ? `${diffMin} мин назад` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return ru ? `${diffHr} ч назад` : `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return ru ? `${diffDay} дн назад` : `${diffDay}d ago`;
  try {
    return new Date(ts).toLocaleDateString(ru ? 'ru-RU' : 'en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

/**
 * Russian plural (one / few / many) or English singular/plural picker.
 * Used to label counters like "1 друг", "2 друга", "5 друзей".
 */
function pluralize(
  lang: 'ru' | 'en',
  count: number,
  forms: { one: string; few: string; many: string }
): string {
  const n = Math.abs(count);
  if (lang === 'en') {
    return (n === 1 ? forms.one : forms.many).replace('{count}', String(count));
  }
  const mod10 = n % 10;
  const mod100 = n % 100;
  let form: string;
  if (mod10 === 1 && mod100 !== 11) form = forms.one;
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) form = forms.few;
  else form = forms.many;
  return form.replace('{count}', String(count));
}

/** Mirrors the discriminated union in app/page.tsx so we can do a fetch
 *  with whichever identifier the caller already has. */
export type ReferralModalUserIdentifier =
  | { type: 'telegram'; telegramId: number }
  | { type: 'email'; userId: number };

/** Shape returned by GET /api/users/referrals (one element per invitee). */
type ReferralRow = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  authType: string;
  invitedAt: string;
  signupBonus: number;
  paymentBonus: number;
  paymentCount: number;
  totalBonus: number;
  // 2026-05-22: cash referral fields. paidAmountRub is the lifetime
  // RUB sum the invitee has paid; cashEarnedRub is the 10% slice that
  // landed on the caller's wallet.
  paidAmountRub: number;
  cashEarnedRub: number;
};

// Narrow shape of `window.Telegram.WebApp` we touch from this modal.
// We cast at the call site instead of `declare global` to avoid clashing
// with the richer global declaration that lives in `app/page.tsx`.
type TgWebAppShareApi = {
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
};

export type ReferralModalProps = {
  open: boolean;
  onClose: () => void;
  /**
   * Canonical referral code from `users.referral_code` (populated by
   * /api/users/state). Two formats coexist:
   *   - `u{base36(telegramId)}` for telegram-primary users
   *   - `e{base36(userId)}`     for email/google-primary users
   * Pass `null` if the user doesn't have one yet (the modal will
   * still render but copy/share will be disabled).
   */
  referralCode?: string | null;
  /** Translation bundle (the same `t` object the parent view uses). */
  t: any;
  /** Language code, used to localise the share-sheet caption. */
  lang: 'ru' | 'en';
  /**
   * Identifier used to query GET /api/users/referrals. When omitted (e.g.
   * the user is still authenticating) the friends panel stays empty
   * instead of erroring out.
   */
  userIdentifier?: ReferralModalUserIdentifier | null;
};

/**
 * Full-screen referral modal — v2 premium layout (2026-05-04).
 *
 * Unlike the v1 layout that stacked every section vertically, this one is a
 * shallow 3-block hero:
 *   1. Stat card (earned days + friend count)
 *   2. Referral link with copy/share
 *   3. Row of CTAs: "Your friends" (opens inner panel), "Rules" (collapses)
 * The invitee list itself lives in a slide-in inner panel so the main view
 * stays airy. Rendered via `createPortal` to `document.body` to escape any
 * transformed ancestor (otherwise `position: fixed` scopes to the parent).
 */
export default function ReferralModal({ open, onClose, referralCode, t, lang, userIdentifier }: ReferralModalProps) {
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [referralsLoading, setReferralsLoading] = useState(false);
  const [totalBonusDays, setTotalBonusDays] = useState(0);
  const [showInvitees, setShowInvitees] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // 2026-05-22 referral cash: spendable wallet + lifetime gross earnings.
  const [referralBalanceRub, setReferralBalanceRub] = useState(0);
  const [totalCashEarnedRub, setTotalCashEarnedRub] = useState(0);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch invitees while the modal is visible. Refetch on every open so the
  // user sees freshly applied bonuses without having to reload the whole
  // app. AbortController guards against fast open→close flicker.
  useEffect(() => {
    if (!open || !userIdentifier) {
      return;
    }
    const controller = new AbortController();
    setReferralsLoading(true);
    const query = userIdentifier.type === 'telegram'
      ? `telegramId=${userIdentifier.telegramId}`
      : `userId=${userIdentifier.userId}`;
    fetch(`/api/users/referrals?${query}`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((data) => {
        if (!data?.ok) return;
        setReferrals(Array.isArray(data.referrals) ? data.referrals : []);
        setTotalBonusDays(Number(data.totalDays) || 0);
        setReferralBalanceRub(Number(data.referralBalanceRub) || 0);
        setTotalCashEarnedRub(Number(data.totalCashEarnedRub) || 0);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') console.error('[ReferralModal] referrals fetch failed:', err);
      })
      .finally(() => setReferralsLoading(false));
    return () => controller.abort();
  }, [open, userIdentifier]);

  // Reset transient state whenever the modal is closed/reopened.
  useEffect(() => {
    if (!open) {
      setCopied(false);
      setShowInvitees(false);
      setShowDetails(false);
      setWithdrawalOpen(false);
    }
  }, [open]);

  // Refetch the referrals payload when the withdrawal sheet closes — a
  // submitted request debits the wallet, a cancelled request credits it
  // back, and either case must reflect immediately in the balance pill.
  // We trigger by transitioning withdrawalOpen from true → false.
  const prevWithdrawalOpenRef = useRef(false);
  useEffect(() => {
    if (prevWithdrawalOpenRef.current && !withdrawalOpen && open && userIdentifier) {
      const query = userIdentifier.type === 'telegram'
        ? `telegramId=${userIdentifier.telegramId}`
        : `userId=${userIdentifier.userId}`;
      fetch(`/api/users/referrals?${query}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (!data?.ok) return;
          setReferrals(Array.isArray(data.referrals) ? data.referrals : []);
          setTotalBonusDays(Number(data.totalDays) || 0);
          setReferralBalanceRub(Number(data.referralBalanceRub) || 0);
          setTotalCashEarnedRub(Number(data.totalCashEarnedRub) || 0);
        })
        .catch(() => { /* ignore */ });
    }
    prevWithdrawalOpenRef.current = withdrawalOpen;
  }, [withdrawalOpen, open, userIdentifier]);

  // Site-format referral link (2026-06-12). Was a Telegram deep link
  // (t.me/<bot>?startapp=ref_<code>); now points at the website so it also
  // works for email/Google signups — those attribute the inviter for the
  // 10% cash reward. The TG Mini App still accepts startapp=ref_<code> for
  // in-Telegram signups, and the web landing reads `?ref=<code>`.
  const referralUrl = referralCode
    ? `${process.env.NEXT_PUBLIC_APP_URL || 'https://hundlervpn.xyz'}/?ref=${referralCode}`
    : '';

  const friendsCount = referrals.length;
  const friendsLabel = useMemo(
    () => pluralize(lang, friendsCount, {
      one: t.referralInviteesSummaryOne,
      few: t.referralInviteesSummaryFew,
      many: t.referralInviteesSummary,
    }).replace('{days}', String(totalBonusDays)),
    [lang, friendsCount, totalBonusDays, t]
  );

  const handleCopy = async () => {
    haptic('light');
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard might be blocked; ignore silently */
    }
  };

  const handleShare = () => {
    haptic('light');
    if (!referralUrl) return;
    const shareText = lang === 'ru'
      ? 'Присоединяйся к Hundler VPN — быстрый и безопасный VPN'
      : 'Join Hundler VPN — fast and secure VPN';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=${encodeURIComponent(shareText)}`;
    const tgWebApp = (typeof window !== 'undefined'
      ? (window as unknown as { Telegram?: { WebApp?: TgWebAppShareApi } }).Telegram?.WebApp
      : undefined);
    if (tgWebApp?.openTelegramLink) {
      tgWebApp.openTelegramLink(shareUrl);
    } else if (tgWebApp?.openLink) {
      tgWebApp.openLink(shareUrl);
    } else if (typeof window !== 'undefined') {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }
  };

  if (!mounted || typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] bg-[#020202] flex flex-col"
        >
          {/* Ambient decorative glows — subtle, premium vibe */}
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            <div className="absolute -top-[15%] left-[20%] w-[60vw] h-[60vw] max-w-[500px] max-h-[500px] rounded-full bg-red-500/[0.08] blur-[100px]" />
            <div className="absolute top-[40%] -right-[20%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-orange-500/[0.06] blur-[90px]" />
          </div>

          {/* Header — iOS-safe top inset */}
          <div
            className="relative z-10 shrink-0 px-5 pb-4 flex items-center justify-between gap-3"
            style={{ paddingTop: 'calc(var(--sat, 0px) + 3.5rem)' }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500/25 to-red-600/10 border border-red-500/30 flex items-center justify-center shrink-0">
                <Gift size={16} strokeWidth={2} className="text-red-300" />
              </div>
              <div className="min-w-0">
                <h3 className="text-white font-bold text-[15px] truncate">{t.referralTitle}</h3>
                <p className="text-zinc-500 text-[11px] truncate">{t.referralSubtitle}</p>
              </div>
            </div>
            <button
              onClick={() => { haptic('light'); onClose(); }}
              className="w-9 h-9 rounded-xl border border-white/10 bg-white/[0.04] flex items-center justify-center active:scale-90 transition-transform shrink-0"
              aria-label={t.referralCloseBtn}
            >
              <X size={18} className="text-white" />
            </button>
          </div>

          {/* Scrollable body */}
          <div
            className="relative z-10 flex-1 overflow-y-auto px-5"
            style={{ paddingBottom: 'calc(var(--sab, 0px) + 2rem)', WebkitOverflowScrolling: 'touch' as any }}
          >
            <div className="max-w-md lg:max-w-xl mx-auto space-y-4">

              {/* ========== Hero stat card ========== */}
              <motion.div
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.05, duration: 0.3 }}
                className="relative overflow-hidden rounded-3xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.12] via-[#130707]/80 to-[#0a0404]/80 p-6 lg:p-7"
              >
                {/* Sparkle glints */}
                <div className="pointer-events-none absolute -top-6 -right-6 opacity-60">
                  <Sparkles size={80} strokeWidth={1.2} className="text-red-500/20" />
                </div>
                <div className="pointer-events-none absolute -bottom-4 -left-4 opacity-40">
                  <Sparkles size={50} strokeWidth={1.2} className="text-orange-400/15" />
                </div>

                <div className="relative flex items-baseline gap-6 mb-3">
                  <div>
                    <p className="text-red-300/70 text-[11px] lg:text-xs uppercase tracking-[0.15em] font-medium mb-1">
                      {t.referralStatsEarned}
                    </p>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-white font-bold text-[44px] lg:text-[56px] leading-none tabular-nums">
                        {totalBonusDays}
                      </span>
                      <span className="text-red-300 font-semibold text-sm lg:text-base">{t.referralDaysSuffix}</span>
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-zinc-500 text-[11px] lg:text-xs uppercase tracking-[0.15em] font-medium mb-1">
                      {t.referralStatsFriends}
                    </p>
                    <div className="text-white font-bold text-2xl lg:text-3xl tabular-nums">{friendsCount}</div>
                  </div>
                </div>

                <p className="relative text-white/60 text-[12px] lg:text-sm leading-relaxed">
                  {t.referralSubtitle}
                </p>
              </motion.div>

              {/* ========== Balance + withdraw CTA (2026-05-22) ==========
                  Sits between the hero and the link card so it's the
                  second-most-prominent block. Big numeric balance on the
                  left, "Вывести" CTA on the right. The "Накоплено всего"
                  sub-line shows the lifetime gross earnings so the user
                  knows the difference (= already withdrawn). */}
              <motion.div
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.08, duration: 0.3 }}
                /* 2026-05-23: палитра приведена к нашему бренду —
                   красно-чёрный градиент вместо emerald. Сумма баланса
                   остаётся белой, валюта подсвечена red-400. */
                className="relative overflow-hidden rounded-2xl border border-red-500/25 bg-gradient-to-br from-red-500/[0.08] via-[#140707]/80 to-[#060202]/80 p-4 lg:p-5"
              >
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-red-500/20 to-orange-600/15 border border-red-500/30 flex items-center justify-center shrink-0">
                    <Wallet size={18} strokeWidth={2} className="text-red-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-red-300/70 text-[10px] lg:text-[11px] uppercase tracking-[0.15em] font-medium mb-0.5">
                      {lang === 'ru' ? 'Реферальный баланс' : 'Referral balance'}
                    </p>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-white font-bold text-[26px] lg:text-[32px] leading-none tabular-nums">
                        {referralBalanceRub.toFixed(2)}
                      </span>
                      <span className="text-red-300 font-semibold text-sm">₽</span>
                    </div>
                    {totalCashEarnedRub > 0 && (
                      <p className="text-zinc-500 text-[10.5px] mt-1">
                        {lang === 'ru' ? 'Всего заработано: ' : 'Lifetime earned: '}
                        <span className="text-zinc-300 tabular-nums">{totalCashEarnedRub.toFixed(2)} ₽</span>
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { haptic('light'); setWithdrawalOpen(true); }}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 text-white shadow-lg shadow-red-500/25 active:scale-[0.98] transition-transform"
                >
                  <ArrowDownToLine size={15} strokeWidth={2.25} className="shrink-0" />
                  <span>{lang === 'ru' ? 'Вывести / заявки' : 'Withdraw / requests'}</span>
                </button>
                <p className="text-zinc-500 text-[10px] mt-2 leading-relaxed">
                  {lang === 'ru'
                    ? '10 % с каждой оплаты приглашённого друга. Минимум для вывода — 500 ₽.'
                    : '10% from every paid friend. Min withdrawal — 500 ₽.'}
                </p>
              </motion.div>

              {/* ========== Your link ========== */}
              <motion.div
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.3 }}
                className="rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.03] to-white/[0.01] p-4 lg:p-5"
              >
                <p className="text-zinc-500 text-[10px] lg:text-[11px] uppercase tracking-[0.15em] font-semibold mb-2.5">{t.referralYourLink}</p>
                <div className="rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2.5 mb-3">
                  <p className="text-white/90 text-[11px] lg:text-sm font-mono break-all leading-relaxed">
                    {referralUrl || '—'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleCopy}
                    disabled={!referralUrl}
                    className={`flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition-all active:scale-[0.98] disabled:opacity-40 ${
                      copied
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                        : 'bg-white/[0.05] border border-white/10 text-white hover:bg-white/[0.08]'
                    }`}
                  >
                    {copied ? (
                      <>
                        <ClipboardCheck size={15} strokeWidth={2} className="shrink-0" />
                        <span className="truncate">{t.referralCopied}</span>
                      </>
                    ) : (
                      <>
                        <Copy size={15} strokeWidth={2} className="shrink-0" />
                        <span className="truncate">{t.referralCopyBtn}</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleShare}
                    disabled={!referralUrl}
                    className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition-all active:scale-[0.98] disabled:opacity-40 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white shadow-lg shadow-red-500/20"
                  >
                    <Send size={15} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">{t.referralShareBtn}</span>
                  </button>
                </div>
              </motion.div>

              {/* ========== Friends CTA (opens inner panel) ========== */}
              <motion.button
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.13, duration: 0.3 }}
                onClick={() => { haptic('light'); setShowInvitees(true); }}
                className="group w-full rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.03] to-white/[0.01] hover:border-white/15 transition-colors p-4 flex items-center gap-3 active:scale-[0.99]"
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-red-500/20 to-red-600/10 border border-red-500/25 flex items-center justify-center shrink-0">
                  <UsersIcon size={18} strokeWidth={2} className="text-red-300" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-white font-semibold text-[14px] lg:text-[15px] truncate">{t.referralInviteesTitle}</p>
                  <p className="text-zinc-500 text-[11px] lg:text-xs truncate">
                    {friendsCount > 0
                      ? friendsLabel
                      : t.referralInviteesEmptyCta}
                  </p>
                </div>
                <ChevronRight size={18} strokeWidth={2} className="text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
              </motion.button>

              {/* ========== Rules collapsible ========== */}
              <motion.div
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.16, duration: 0.3 }}
                className="rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.03] to-white/[0.01] overflow-hidden"
              >
                <button
                  onClick={() => { haptic('light'); setShowDetails((v) => !v); }}
                  className="w-full p-4 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0">
                    <Info size={15} strokeWidth={1.75} className="text-zinc-300" />
                  </div>
                  <p className="text-white font-semibold text-[14px] flex-1 text-left">{t.referralDetailsToggle}</p>
                  <motion.div
                    animate={{ rotate: showDetails ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="shrink-0"
                  >
                    <ChevronDown size={18} strokeWidth={2} className="text-zinc-500" />
                  </motion.div>
                </button>
                <AnimatePresence initial={false}>
                  {showDetails && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 space-y-3">
                        {/* Signup tier */}
                        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/[0.06] border border-red-500/20">
                          <div className="w-7 h-7 rounded-lg bg-red-500/15 border border-red-500/25 flex items-center justify-center shrink-0 mt-0.5">
                            <Gift size={12} strokeWidth={2} className="text-red-300" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-white font-semibold text-[12px]">{t.referralSignupTitle}</p>
                              <span className="text-[10px] font-bold tracking-wider text-red-300 bg-red-500/15 border border-red-500/30 px-1.5 py-0.5 rounded-full">
                                +3
                              </span>
                            </div>
                            <p className="text-zinc-400 text-[11px] leading-relaxed">{t.referralSignupDesc}</p>
                          </div>
                        </div>

                        {/* Payment tiers */}
                        <div className="p-3 rounded-xl bg-red-500/[0.05] border border-red-500/15">
                          <div className="flex items-center gap-2 mb-2.5">
                            <div className="w-7 h-7 rounded-lg bg-red-500/15 border border-red-500/25 flex items-center justify-center shrink-0">
                              <CreditCard size={12} strokeWidth={2} className="text-red-300" />
                            </div>
                            <p className="text-white font-semibold text-[12px]">{t.referralTiersTitle}</p>
                          </div>
                          <div className="space-y-1.5 pl-1">
                            {[t.referralTier7, t.referralTier14, t.referralTier21].map((label, i) => (
                              <div key={i} className="flex items-center gap-2 text-[12px] text-zinc-300">
                                <CheckCircle2 size={12} strokeWidth={2} className="text-red-400/80 shrink-0" />
                                <span>{label}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Conditions. 2026-05-23: с amber (warning-like)
                            переведён в нейтральный red-200/zinc — info,
                            а не "осторожно". Бренду подходит лучше. */}
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
                          <Info size={13} className="text-zinc-400 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-white text-[11px] font-semibold mb-0.5">{t.referralNoteTitle}</p>
                            <p className="text-zinc-400 text-[10.5px] leading-relaxed">{t.referralNoteDesc}</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          </div>

          {/* ========== Inner panel: Friends list ========== */}
          <AnimatePresence>
            {showInvitees && (
              <motion.div
                initial={{ x: '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 z-20 bg-[#020202] flex flex-col"
              >
                <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                  <div className="absolute top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-red-500/[0.05] blur-[80px]" />
                </div>

                <div
                  className="relative z-10 shrink-0 px-5 pb-4 flex items-center gap-3"
                  style={{ paddingTop: 'calc(var(--sat, 0px) + 3.5rem)' }}
                >
                  <button
                    onClick={() => { haptic('light'); setShowInvitees(false); }}
                    className="w-9 h-9 rounded-xl border border-white/10 bg-white/[0.04] flex items-center justify-center active:scale-90 transition-transform shrink-0"
                    aria-label={t.referralInviteesBack}
                  >
                    <ChevronLeft size={18} className="text-white" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-bold text-[15px] truncate">{t.referralInviteesTitle}</h3>
                    {friendsCount > 0 && (
                      <p className="text-zinc-500 text-[11px] truncate">{friendsLabel}</p>
                    )}
                  </div>
                </div>

                <div
                  className="relative z-10 flex-1 overflow-y-auto px-5"
                  style={{ paddingBottom: 'calc(var(--sab, 0px) + 2rem)', WebkitOverflowScrolling: 'touch' as any }}
                >
                  <div className="max-w-md lg:max-w-xl mx-auto">
                    {referralsLoading && referrals.length === 0 ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 size={20} className="text-zinc-500 animate-spin" />
                      </div>
                    ) : referrals.length === 0 ? (
                      <div className="mt-8 flex flex-col items-center text-center gap-3 px-6">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500/15 to-red-600/5 border border-red-500/20 flex items-center justify-center">
                          <UsersIcon size={24} strokeWidth={1.75} className="text-red-300/80" />
                        </div>
                        <p className="text-white font-semibold text-[14px]">{t.referralInviteesTitle}</p>
                        <p className="text-zinc-500 text-[12.5px] leading-relaxed max-w-[280px]">{t.referralInviteesEmpty}</p>
                        <button
                          onClick={() => { setShowInvitees(false); handleShare(); }}
                          disabled={!referralUrl}
                          className="mt-2 flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-red-600 to-red-500 text-white shadow-lg shadow-red-500/20 active:scale-95 disabled:opacity-40"
                        >
                          <Send size={14} strokeWidth={2} />
                          {t.referralShareBtn}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {referrals.map((r) => {
                          const displayName = [r.firstName, r.lastName].filter(Boolean).join(' ').trim()
                            || (r.username ? `@${r.username}` : t.referralInviteesAnonymous);
                          const relative = formatRelativeDate(r.invitedAt, lang);
                          const hasBonus = r.totalBonus > 0;
                          const paymentLabel = r.paymentCount > 0
                            ? pluralize(lang, r.paymentCount, {
                                one: t.referralInviteesPaymentsOne,
                                few: t.referralInviteesPaymentsFew,
                                many: t.referralInviteesPaymentsMany,
                              })
                            : null;
                          return (
                            <div
                              key={r.id}
                              className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]"
                            >
                              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                                {r.photoUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={r.photoUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  <UserIcon size={16} strokeWidth={1.5} className="text-zinc-500" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-white text-[13.5px] font-semibold truncate">{displayName}</p>
                                <p className="text-zinc-500 text-[11px] truncate">
                                  {relative}{paymentLabel ? ` • ${paymentLabel}` : ''}
                                </p>
                                {/* 2026-05-22: paid amount + your 10% slice.
                                    Only render when the invitee has paid in
                                    RUB (>0); other rails (Stars, crypto)
                                    don't accrue cash so showing "0 ₽" would
                                    just be noise. */}
                                {r.paidAmountRub > 0 && (
                                  <p className="text-emerald-400/80 text-[10.5px] mt-0.5 truncate tabular-nums">
                                    {lang === 'ru' ? 'оплатил ' : 'paid '}
                                    <span className="text-emerald-300 font-semibold">{r.paidAmountRub.toFixed(0)} ₽</span>
                                    {r.cashEarnedRub > 0 && (
                                      <>
                                        <span className="text-zinc-600"> · </span>
                                        <span className="text-emerald-300/90">+{r.cashEarnedRub.toFixed(2)} ₽ {lang === 'ru' ? 'тебе' : 'to you'}</span>
                                      </>
                                    )}
                                  </p>
                                )}
                              </div>
                              {hasBonus ? (
                                <div className="text-right shrink-0">
                                  <div className="text-red-300 font-bold text-[14px] tabular-nums leading-tight">+{r.totalBonus}</div>
                                  <div className="text-red-400/70 text-[10px] uppercase tracking-wider">{t.referralDaysSuffix}</div>
                                </div>
                              ) : (
                                <span className="text-[10px] font-medium tracking-wider text-zinc-500 bg-white/[0.03] border border-white/10 px-2 py-1 rounded-full shrink-0">
                                  {t.referralInviteesPending}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 2026-05-22 referral cash: WithdrawalModal slides over the
              referral modal when "Вывести / заявки" is tapped. Lives
              inside this modal's portal so the close-then-refetch
              sequence in the parent useEffect actually fires. */}
          <WithdrawalModal
            open={withdrawalOpen}
            onClose={() => setWithdrawalOpen(false)}
            balanceRub={referralBalanceRub}
            userIdentifier={userIdentifier ?? null}
            lang={lang}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
