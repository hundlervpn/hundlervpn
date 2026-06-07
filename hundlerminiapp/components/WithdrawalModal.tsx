'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Send,
  ArrowDownToLine,
  History,
  Wallet,
  Ban,
} from 'lucide-react';
import { haptic } from '@/lib/haptic';

// ────────────────────────────────────────────────────────────────────────────
// 2026-05-24: Premium brand icons for withdrawal methods. Заменили
// плоские Lucide-глифы (CreditCard / Bitcoin / Star) на «настоящие»
// разноцветные брендовые SVG чтобы карточки выбора метода выглядели
// премиально, а не как монохромный лоу-эффорт UI.
//
// Привязка (как указал заказчик 2026-05-24):
//   • sbp_card       → SbpBrandIcon       — мульти-цветной лого СБП-style
//   • crypto         → CryptoAtmIcon      — зелёный круг + «банкомат»
//   • telegram_stars → StarsGoldIcon      — звезда с золотым градиентом
//
// Все три — самодостаточные React компоненты с прокидываемым size.
// ────────────────────────────────────────────────────────────────────────────

function SbpBrandIcon({ size = 32 }: { size?: number }) {
  const h = (size / 97) * 120;
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 97 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M0 26.12l14.532 25.975v15.844L.017 93.863 0 26.12z" fill="#5B57A2" />
      <path d="M55.797 42.643l13.617-8.346 27.868-.026-41.485 25.414V42.643z" fill="#D90751" />
      <path d="M55.72 25.967l.077 34.39-14.566-8.95V0l14.49 25.967z" fill="#FAB718" />
      <path d="M97.282 34.271l-27.869.026-13.693-8.33L41.231 0l56.05 34.271z" fill="#ED6F26" />
      <path d="M55.797 94.007V77.322l-14.566-8.78.008 51.458 14.558-25.993z" fill="#63B22F" />
      <path d="M69.38 85.737L14.531 52.095 0 26.12l97.223 59.583-27.844.034z" fill="#1487C9" />
      <path d="M41.24 120l14.556-25.993 13.583-8.27 27.843-.034L41.24 120z" fill="#017F36" />
      <path d="M.017 93.863l41.333-25.32-13.896-8.526-12.922 7.922L.017 93.863z" fill="#984995" />
    </svg>
  );
}

function CryptoAtmIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="24" cy="24" r="20" fill="#26a69a" />
      <rect width="18" height="5" x="15" y="13" fill="#fff" />
      <path
        fill="#fff"
        d="M24,21c-4.457,0-12,0.737-12,3.5S19.543,28,24,28s12-0.737,12-3.5S28.457,21,24,21z M24,26c-5.523,0-10-0.895-10-2c0-1.105,4.477-2,10-2s10,0.895,10,2C34,25.105,29.523,26,24,26z"
      />
      <path
        fill="#fff"
        d="M24,24c1.095,0,2.093-0.037,3-0.098V13h-6v10.902C21.907,23.963,22.905,24,24,24z"
      />
      <path
        fill="#fff"
        d="M25.723,25.968c-0.111,0.004-0.223,0.007-0.336,0.01C24.932,25.991,24.472,26,24,26 s-0.932-0.009-1.387-0.021c-0.113-0.003-0.225-0.006-0.336-0.01c-0.435-0.015-0.863-0.034-1.277-0.06V36h6V25.908 C26.586,25.934,26.158,25.953,25.723,25.968z"
      />
    </svg>
  );
}

function StarsGoldIcon({ size = 32 }: { size?: number }) {
  // Уникальный gradient-id на инстанс — иначе при двух иконках на
  // одной странице второй <linearGradient> переопределит первый.
  const gid = useMemo(() => `stars-gold-${Math.random().toString(36).slice(2, 9)}`, []);
  return (
    <svg
      width={size}
      height={(size / 14) * 15}
      viewBox="0 0 14 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="14" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFE27A" />
          <stop offset="45%" stopColor="#FFC83D" />
          <stop offset="100%" stopColor="#E89200" />
        </linearGradient>
      </defs>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.63869 12.1902L3.50621 14.1092C3.18049 14.3087 2.75468 14.2064 2.55515 13.8807C2.45769 13.7216 2.42864 13.5299 2.47457 13.3491L2.95948 11.4405C3.13452 10.7515 3.60599 10.1756 4.24682 9.86791L7.6642 8.22716C7.82352 8.15067 7.89067 7.95951 7.81418 7.80019C7.75223 7.67116 7.61214 7.59896 7.47111 7.62338L3.66713 8.28194C2.89387 8.41581 2.1009 8.20228 1.49941 7.69823L0.297703 6.69116C0.00493565 6.44581 -0.0335059 6.00958 0.211842 5.71682C0.33117 5.57442 0.502766 5.48602 0.687982 5.47153L4.35956 5.18419C4.61895 5.16389 4.845 4.99974 4.94458 4.75937L6.36101 1.3402C6.5072 0.987302 6.91179 0.819734 7.26469 0.965925C7.43413 1.03612 7.56876 1.17075 7.63896 1.3402L9.05539 4.75937C9.15496 4.99974 9.38101 5.16389 9.6404 5.18419L13.3322 5.47311C13.713 5.50291 13.9975 5.83578 13.9677 6.2166C13.9534 6.39979 13.8667 6.56975 13.7269 6.68896L10.9114 9.08928C10.7131 9.25826 10.6267 9.52425 10.6876 9.77748L11.5532 13.3733C11.6426 13.7447 11.414 14.1182 11.0427 14.2076C10.8642 14.2506 10.676 14.2208 10.5195 14.1249L7.36128 12.1902C7.13956 12.0544 6.8604 12.0544 6.63869 12.1902Z"
        fill={`url(#${gid})`}
      />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Withdrawal modal — slides over the referral modal.
//
// Two main views (tabs):
//   1. "Новый вывод" — three-step form (amount → method → destination).
//   2. "Мои заявки"   — list of past requests, taps into a chat thread.
//
// State machine on the request side mirrors the DB enum:
//   pending → in_progress → paid | rejected
//   pending → cancelled (user-initiated only)
//
// Auth: all requests require `telegramId` (mirrors the rest of the
// Mini App's API surface). Email-primary users still pass through as
// userIdentifier.type='email' but currently the withdrawal endpoints
// only accept `telegramId` — for the email path we surface a friendly
// error and ask the user to log in via TG.
// ────────────────────────────────────────────────────────────────────────────

export type WithdrawalUserIdentifier =
  | { type: 'telegram'; telegramId: number }
  | { type: 'email'; userId: number };

export type WithdrawalRow = {
  id: string;
  userId: number;
  amountRub: number;
  method: 'sbp_card' | 'crypto' | 'telegram_stars';
  destination: Record<string, any>;
  status: 'pending' | 'in_progress' | 'paid' | 'rejected' | 'cancelled';
  payoutNote: string | null;
  processedAt: string | null;
  processedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type WithdrawalMessageRow = {
  id: string;
  withdrawalId: string;
  authorUserId: number;
  authorRole: 'user' | 'admin' | 'system';
  body: string;
  attachmentUrl: string | null;
  createdAt: string;
};

export type WithdrawalModalProps = {
  open: boolean;
  onClose: () => void;
  balanceRub: number;
  userIdentifier: WithdrawalUserIdentifier | null;
  lang: 'ru' | 'en';
};

const MIN_AMOUNT = 500;

// Pretty status pill in both languages. Colour-coded so the user can
// scan a long list of requests by hue alone.
function statusMeta(status: WithdrawalRow['status'], lang: 'ru' | 'en') {
  switch (status) {
    case 'pending':
      return {
        label: lang === 'ru' ? 'Ожидает' : 'Pending',
        cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        Icon: Clock,
      };
    case 'in_progress':
      return {
        label: lang === 'ru' ? 'В работе' : 'In progress',
        cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
        Icon: Loader2,
      };
    case 'paid':
      return {
        label: lang === 'ru' ? 'Выплачено' : 'Paid',
        cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        Icon: CheckCircle2,
      };
    case 'rejected':
      return {
        label: lang === 'ru' ? 'Отклонено' : 'Rejected',
        cls: 'bg-red-500/15 text-red-300 border-red-500/30',
        Icon: XCircle,
      };
    case 'cancelled':
      return {
        label: lang === 'ru' ? 'Отменено' : 'Cancelled',
        cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
        Icon: Ban,
      };
  }
}

function methodLabel(method: WithdrawalRow['method'], lang: 'ru' | 'en'): string {
  switch (method) {
    case 'sbp_card':
      return lang === 'ru' ? 'СБП / карта' : 'SBP / card';
    case 'crypto':
      return lang === 'ru' ? 'Криптовалюта' : 'Crypto';
    case 'telegram_stars':
      return 'Telegram Stars';
  }
}

function formatRelative(iso: string, lang: 'ru' | 'en') {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 1) return lang === 'ru' ? 'только что' : 'just now';
  if (diffMin < 60) return lang === 'ru' ? `${diffMin} мин назад` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return lang === 'ru' ? `${diffHr} ч назад` : `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return lang === 'ru' ? `${diffDay} дн назад` : `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US');
}

export default function WithdrawalModal({ open, onClose, balanceRub, userIdentifier, lang }: WithdrawalModalProps) {
  const [tab, setTab] = useState<'new' | 'list'>('new');
  const [list, setList] = useState<WithdrawalRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  // 2026-05-22: live rate from /api/settings/stars-rate. Used by the
  // Stars destination field to show "≈ X ⭐" estimate. Default 0.5
  // matches the server-side fallback so the UI never shows ⭐0.
  const [starsRate, setStarsRate] = useState<number>(0.5);

  // New-request form state. Step is the carousel position (0 amount,
  // 1 method, 2 destination). On successful submit we wipe form and
  // jump back to the "Мои заявки" tab to show the new request.
  const [formStep, setFormStep] = useState(0);
  const [amount, setAmount] = useState<string>('');
  const [method, setMethod] = useState<WithdrawalRow['method'] | null>(null);
  const [destination, setDestination] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isTelegramAuth = userIdentifier?.type === 'telegram';

  // Refresh the list whenever the modal opens or the user flips to the
  // "Мои заявки" tab. Cheap query, debounced via opening transition.
  const reloadList = async () => {
    if (!isTelegramAuth) {
      setList([]);
      return;
    }
    setListLoading(true);
    try {
      const res = await fetch(`/api/users/withdrawals?telegramId=${userIdentifier!.telegramId}`);
      const data = await res.json();
      if (data?.ok) {
        setList(Array.isArray(data.withdrawals) ? data.withdrawals : []);
      }
    } catch (e) {
      console.error('[WithdrawalModal] list fetch failed:', e);
    } finally {
      setListLoading(false);
    }
  };

  // Load Stars rate once on first open. Cheap (single-row read), and
  // the rate rarely changes — no need to poll.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/stars-rate');
        const data = await res.json();
        if (!cancelled && data?.ok && Number.isFinite(data.rate)) {
          setStarsRate(Number(data.rate));
        }
      } catch (e) {
        console.warn('[WithdrawalModal] stars-rate fetch failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (open && isTelegramAuth) {
      void reloadList();
    } else if (!open) {
      // Reset form & thread so a fresh open starts clean.
      setTab('new');
      setFormStep(0);
      setAmount('');
      setMethod(null);
      setDestination({});
      setSubmitting(false);
      setFormError(null);
      setOpenThreadId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isTelegramAuth]);

  const balanceFormatted = useMemo(() => balanceRub.toFixed(2), [balanceRub]);

  const handleSubmit = async () => {
    if (submitting || !isTelegramAuth) return;
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < MIN_AMOUNT) {
      setFormError(lang === 'ru' ? `Минимум ${MIN_AMOUNT} ₽` : `Min ${MIN_AMOUNT} ₽`);
      return;
    }
    if (numAmount > balanceRub) {
      setFormError(lang === 'ru' ? 'Сумма превышает баланс' : 'Amount exceeds balance');
      return;
    }
    if (!method) {
      setFormError(lang === 'ru' ? 'Выберите способ вывода' : 'Pick a method');
      return;
    }

    // Build per-method destination payload from the form. The server
    // re-validates so anything we miss here surfaces as a 400 with a
    // localized message we can show inline.
    const payload: any = { method };
    if (method === 'sbp_card') {
      // fullName убрали из формы — всё ещё пробрасываем если поле есть в state.
      if (destination.fullName?.trim()) payload.fullName = destination.fullName.trim();
      if (destination.phone?.trim()) payload.phone = destination.phone.trim();
      if (destination.cardNumber?.trim()) payload.cardNumber = destination.cardNumber.trim();
      if (destination.bank?.trim()) payload.bank = destination.bank.trim();
    } else if (method === 'crypto') {
      payload.network = destination.network;
      payload.address = destination.address?.trim();
      if (destination.asset) payload.asset = destination.asset;
    } else if (method === 'telegram_stars') {
      if (destination.telegramUsername?.trim()) payload.telegramUsername = destination.telegramUsername.trim();
    }

    setSubmitting(true);
    setFormError(null);
    haptic('medium');
    try {
      const res = await fetch('/api/users/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: userIdentifier!.telegramId,
          amountRub: numAmount,
          method,
          destination: payload,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setFormError(data?.error || (lang === 'ru' ? 'Ошибка отправки' : 'Submit failed'));
        return;
      }
      // Success — reset form, reload list, jump to it.
      setAmount('');
      setMethod(null);
      setDestination({});
      setFormStep(0);
      setTab('list');
      await reloadList();
      haptic('light');
    } catch (e) {
      console.error('[WithdrawalModal] submit failed:', e);
      setFormError(lang === 'ru' ? 'Сетевая ошибка' : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 z-30 bg-[#020202] flex flex-col overflow-x-hidden"
        >
          {/* Premium decorative glow — мягкое красно-оранжевое свечение
              сверху, имитирующее «золотой свет на дорогом интерфейсе».
              pointer-events-none чтобы клики проходили насквозь. */}
          <div
            aria-hidden
            className="absolute top-0 left-0 right-0 h-[280px] pointer-events-none opacity-90"
            style={{
              background:
                'radial-gradient(60% 100% at 50% 0%, rgba(239,68,68,0.18) 0%, rgba(249,115,22,0.07) 35%, transparent 70%)',
            }}
          />

          {/* Header */}
          <div
            className="relative z-10 shrink-0 px-4 sm:px-5 pb-3 flex items-center gap-3 border-b border-white/[0.05] min-w-0"
            style={{ paddingTop: 'calc(var(--sat, 0px) + 3.5rem)' }}
          >
            <button
              onClick={() => { haptic('light'); onClose(); }}
              className="w-9 h-9 rounded-xl border border-white/10 bg-white/[0.04] flex items-center justify-center active:scale-90 transition-transform shrink-0"
              aria-label="back"
            >
              <ChevronLeft size={18} className="text-white" />
            </button>
            <div className="min-w-0 flex-1">
              <h3 className="text-white font-bold text-[15px] truncate">
                {lang === 'ru' ? 'Вывод средств' : 'Withdraw funds'}
              </h3>
              <p className="text-zinc-500 text-[11px] truncate tabular-nums flex items-baseline gap-1.5">
                {lang === 'ru' ? 'Доступно: ' : 'Available: '}
                <span className="text-[13px] font-bold bg-gradient-to-r from-red-300 via-orange-300 to-amber-300 bg-clip-text text-transparent">
                  {balanceFormatted} ₽
                </span>
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="relative z-10 shrink-0 px-4 sm:px-5 pt-3 pb-3 flex gap-2 min-w-0">
            <button
              onClick={() => setTab('new')}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[12.5px] font-semibold transition-colors ${
                tab === 'new'
                  ? 'bg-red-500/15 border border-red-500/30 text-red-300'
                  : 'bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.07]'
              }`}
            >
              <ArrowDownToLine size={14} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{lang === 'ru' ? 'Новый вывод' : 'New withdrawal'}</span>
            </button>
            <button
              onClick={() => { setTab('list'); void reloadList(); }}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[12.5px] font-semibold transition-colors ${
                tab === 'list'
                  ? 'bg-white/[0.08] border border-white/[0.15] text-white'
                  : 'bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.07]'
              }`}
            >
              <History size={14} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{lang === 'ru' ? `Заявки${list.length ? ` · ${list.length}` : ''}` : `Requests${list.length ? ` · ${list.length}` : ''}`}</span>
            </button>
          </div>

          {/* Body */}
          <div
            className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-5"
            style={{ paddingBottom: 'calc(var(--sab, 0px) + 2rem)', WebkitOverflowScrolling: 'touch' as any }}
          >
            <div className="max-w-md lg:max-w-xl mx-auto pb-6 min-w-0">
              {!isTelegramAuth ? (
                <div className="mt-8 p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[13px]">
                  {lang === 'ru'
                    ? 'Вывод средств доступен только при входе через Telegram. Откройте мини-апп через бота, чтобы продолжить.'
                    : 'Withdrawals are available only when signed in via Telegram. Open the mini-app from the bot to continue.'}
                </div>
              ) : tab === 'new' ? (
                <NewWithdrawalForm
                  lang={lang}
                  balanceRub={balanceRub}
                  formStep={formStep}
                  setFormStep={setFormStep}
                  amount={amount}
                  setAmount={setAmount}
                  method={method}
                  setMethod={setMethod}
                  destination={destination}
                  setDestination={setDestination}
                  submitting={submitting}
                  formError={formError}
                  onSubmit={handleSubmit}
                  starsRate={starsRate}
                />
              ) : (
                <WithdrawalsList
                  lang={lang}
                  list={list}
                  loading={listLoading}
                  onOpenThread={(id) => setOpenThreadId(id)}
                  onCreateNew={() => setTab('new')}
                />
              )}
            </div>
          </div>

          {/* Chat thread overlay */}
          {openThreadId && isTelegramAuth && userIdentifier?.type === 'telegram' && (
            <ThreadOverlay
              lang={lang}
              telegramId={userIdentifier.telegramId}
              withdrawalId={openThreadId}
              onClose={() => { setOpenThreadId(null); void reloadList(); }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// New-withdrawal carousel
// ────────────────────────────────────────────────────────────────────────────
function NewWithdrawalForm({
  lang,
  balanceRub,
  formStep,
  setFormStep,
  amount,
  setAmount,
  method,
  setMethod,
  destination,
  setDestination,
  submitting,
  formError,
  onSubmit,
  starsRate,
}: {
  lang: 'ru' | 'en';
  balanceRub: number;
  formStep: number;
  setFormStep: (n: number) => void;
  amount: string;
  setAmount: (s: string) => void;
  method: WithdrawalRow['method'] | null;
  setMethod: (m: WithdrawalRow['method'] | null) => void;
  destination: Record<string, string>;
  setDestination: (d: Record<string, string>) => void;
  submitting: boolean;
  formError: string | null;
  onSubmit: () => void;
  starsRate: number;
}) {
  const numAmount = Number(amount);
  const amountValid = Number.isFinite(numAmount) && numAmount >= MIN_AMOUNT && numAmount <= balanceRub;

  if (balanceRub < MIN_AMOUNT) {
    return (
      <div className="mt-6 p-5 rounded-2xl border border-white/10 bg-white/[0.03] text-center">
        <Wallet size={28} strokeWidth={1.5} className="text-zinc-500 mx-auto mb-2" />
        <p className="text-white font-semibold text-[14px] mb-1">
          {lang === 'ru' ? 'Недостаточно средств для вывода' : 'Not enough to withdraw'}
        </p>
        <p className="text-zinc-500 text-[12px] leading-relaxed">
          {lang === 'ru'
            ? `Минимальная сумма — ${MIN_AMOUNT} ₽. Приглашайте друзей и копите 10 % с каждой их оплаты.`
            : `Minimum withdrawal is ${MIN_AMOUNT} ₽. Invite friends and earn 10% of each payment.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      {/* Step 1: Amount */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-red-500/30 to-orange-500/15 border border-red-500/40 text-red-200 text-[11px] font-bold flex items-center justify-center shadow-[0_2px_8px_-2px_rgba(239,68,68,0.45)]">
            1
          </span>
          <p className="text-white font-semibold text-[13px]">
            {lang === 'ru' ? 'Сумма вывода' : 'Amount'}
          </p>
        </div>
        <div className="relative mb-2.5">
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            min={MIN_AMOUNT}
            max={balanceRub}
            className="w-full bg-black/30 border border-white/[0.08] rounded-xl px-3 py-3 text-white font-mono text-[18px] tabular-nums focus:border-red-500/40 focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400/80 text-[14px] font-semibold pointer-events-none">₽</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[500, 1000, Math.floor(balanceRub / 2), Math.floor(balanceRub)]
            .filter((v, i, arr) => v >= MIN_AMOUNT && v <= balanceRub && arr.indexOf(v) === i)
            .map((v) => (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-zinc-200 text-[12px] font-medium hover:bg-white/[0.08] active:scale-95 transition-all tabular-nums"
              >
                {v} ₽
              </button>
            ))}
          <button
            onClick={() => setAmount(String(Math.floor(balanceRub * 100) / 100))}
            className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-[12px] font-semibold hover:bg-red-500/15 active:scale-95 transition-all"
          >
            {lang === 'ru' ? 'Всё' : 'All'}
          </button>
        </div>
        <p className="text-zinc-500 text-[10.5px] mt-2">
          {lang === 'ru' ? `Минимум ${MIN_AMOUNT} ₽ · максимум ${balanceRub.toFixed(2)} ₽` : `Min ${MIN_AMOUNT} ₽ · max ${balanceRub.toFixed(2)} ₽`}
        </p>
      </div>

      {/* Step 2: Method */}
      <div className={`rounded-2xl border ${amountValid ? 'border-white/[0.08] bg-white/[0.02]' : 'border-white/[0.04] bg-white/[0.01] opacity-60 pointer-events-none'} p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-bold flex items-center justify-center">
            2
          </span>
          <p className="text-white font-semibold text-[13px]">
            {lang === 'ru' ? 'Способ вывода' : 'Method'}
          </p>
        </div>
        <div className="grid gap-2.5">
          <MethodCard
            active={method === 'sbp_card'}
            onClick={() => { haptic('light'); setMethod('sbp_card'); setDestination({}); }}
            iconNode={<SbpBrandIcon size={26} />}
            title={lang === 'ru' ? 'СБП / банковская карта' : 'SBP / bank card'}
            subtitle={lang === 'ru' ? 'Перевод по номеру телефона или карте' : 'Transfer by phone or card number'}
            accent="sbp"
          />
          <MethodCard
            active={method === 'crypto'}
            onClick={() => { haptic('light'); setMethod('crypto'); setDestination({ network: 'TON', asset: 'USDT' }); }}
            iconNode={<CryptoAtmIcon size={30} />}
            title={lang === 'ru' ? 'Криптовалюта' : 'Cryptocurrency'}
            subtitle={lang === 'ru' ? 'USDT (TON / TRC20) · TON (TON)' : 'USDT (TON / TRC20) · TON (TON)'}
            accent="crypto"
          />
          <MethodCard
            active={method === 'telegram_stars'}
            onClick={() => { haptic('light'); setMethod('telegram_stars'); setDestination({}); }}
            iconNode={<StarsGoldIcon size={28} />}
            title="Telegram Stars"
            subtitle={lang === 'ru' ? 'Прямой перевод на ваш Telegram' : 'Direct transfer to your Telegram'}
            accent="stars"
          />
        </div>
      </div>

      {/* Step 3: Destination */}
      <div className={`rounded-2xl border ${amountValid && method ? 'border-white/[0.08] bg-white/[0.02]' : 'border-white/[0.04] bg-white/[0.01] opacity-60 pointer-events-none'} p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-bold flex items-center justify-center">
            3
          </span>
          <p className="text-white font-semibold text-[13px]">
            {lang === 'ru' ? 'Реквизиты' : 'Destination'}
          </p>
        </div>
        <DestinationFields
          lang={lang}
          method={method}
          destination={destination}
          setDestination={setDestination}
          amountRub={numAmount}
          starsRate={starsRate}
        />
      </div>

      {formError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-[12.5px] flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="leading-relaxed">{formError}</span>
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={!amountValid || !method || submitting}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 text-white shadow-lg shadow-red-500/25 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <ArrowDownToLine size={16} strokeWidth={2.25} />
        )}
        {submitting
          ? (lang === 'ru' ? 'Отправка…' : 'Submitting…')
          : (lang === 'ru' ? 'Создать заявку' : 'Submit request')}
      </button>
      <p className="text-zinc-500 text-[10.5px] leading-relaxed text-center">
        {lang === 'ru'
          ? 'Сумма списывается с баланса при создании заявки. Если админ отклонит — деньги вернутся автоматически.'
          : 'The amount is debited at submission. If the admin rejects, funds are refunded automatically.'}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Method card (one of three options in step 2)
//
// 2026-05-24: премиум-редизайн. Каждая карточка получает:
//   • Брендовую цветную SVG-иконку (передаётся через iconNode) в
//     gradient-обрамлении 48×48px, чтобы иконка «дышала», а не плющилась.
//   • На активной карточке — мягкий цветной glow (shadow), gradient bg
//     и приподнятость scale-[1.01]. Это вместе с brand SVG даёт
//     ощущение «настоящей» payment-карточки, а не плоского чекбокса.
//   • Hover для неактивных — лёгкое подсвечивание border + bg.
//   • Палитра разная per-accent (sbp = красно-оранжевая, crypto =
//     teal/emerald, stars = янтарный), чтобы цвета карточек коррелировали
//     с цветами самих SVG-иконок — это узнаваемость и premium feel.
// ────────────────────────────────────────────────────────────────────────────
function MethodCard({
  active, onClick, iconNode, title, subtitle, accent,
}: {
  active: boolean;
  onClick: () => void;
  iconNode: React.ReactNode;
  title: string;
  subtitle: string;
  accent: 'sbp' | 'crypto' | 'stars';
}) {
  const palette = {
    sbp: {
      activeBorder: 'border-red-500/40',
      activeBgGradient: 'bg-gradient-to-br from-red-500/[0.08] via-orange-500/[0.05] to-transparent',
      glow: 'shadow-[0_8px_30px_-8px_rgba(239,68,68,0.35)]',
      iconWrap: 'bg-gradient-to-br from-white/[0.08] to-white/[0.02] border-white/[0.10]',
      check: 'text-red-300',
    },
    crypto: {
      activeBorder: 'border-emerald-500/40',
      activeBgGradient: 'bg-gradient-to-br from-emerald-500/[0.08] via-teal-500/[0.05] to-transparent',
      glow: 'shadow-[0_8px_30px_-8px_rgba(38,166,154,0.40)]',
      iconWrap: 'bg-gradient-to-br from-emerald-500/[0.10] to-teal-500/[0.04] border-emerald-500/[0.15]',
      check: 'text-emerald-300',
    },
    stars: {
      activeBorder: 'border-amber-500/45',
      activeBgGradient: 'bg-gradient-to-br from-amber-500/[0.10] via-yellow-500/[0.05] to-transparent',
      glow: 'shadow-[0_8px_30px_-8px_rgba(251,191,36,0.45)]',
      iconWrap: 'bg-gradient-to-br from-amber-500/[0.12] to-yellow-500/[0.04] border-amber-500/[0.20]',
      check: 'text-amber-300',
    },
  }[accent];

  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center gap-3.5 p-3.5 rounded-2xl border transition-all duration-200 active:scale-[0.99] overflow-hidden ${
        active
          ? `${palette.activeBorder} ${palette.activeBgGradient} ${palette.glow}`
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.035]'
      }`}
    >
      {/* Subtle inner shine — только на активной. Создаёт ощущение
          глянца, как у физической банковской карты. */}
      {active && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-60"
          style={{
            background:
              'radial-gradient(60% 80% at 0% 0%, rgba(255,255,255,0.06) 0%, transparent 60%)',
          }}
        />
      )}

      <div
        className={`relative z-10 w-12 h-12 rounded-2xl ${palette.iconWrap} border flex items-center justify-center shrink-0 overflow-hidden`}
      >
        {iconNode}
      </div>

      <div className="relative z-10 min-w-0 flex-1 text-left">
        <p className="text-white font-semibold text-[13.5px] truncate leading-tight mb-0.5">
          {title}
        </p>
        <p className="text-zinc-500 text-[11px] truncate leading-tight">{subtitle}</p>
      </div>

      {active ? (
        <CheckCircle2
          size={18}
          className={`${palette.check} shrink-0 relative z-10`}
          strokeWidth={2.25}
        />
      ) : (
        <div
          aria-hidden
          className="w-[18px] h-[18px] rounded-full border border-white/[0.10] shrink-0 relative z-10 group-hover:border-white/[0.20] transition-colors"
        />
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Method-specific destination form fields
// ────────────────────────────────────────────────────────────────────────────
function DestinationFields({
  lang, method, destination, setDestination, amountRub, starsRate,
}: {
  lang: 'ru' | 'en';
  method: WithdrawalRow['method'] | null;
  destination: Record<string, string>;
  setDestination: (d: Record<string, string>) => void;
  amountRub: number;
  starsRate: number;
}) {
  if (!method) {
    return (
      <p className="text-zinc-500 text-[11.5px] italic">
        {lang === 'ru' ? 'Сначала выберите способ выше.' : 'Pick a method above first.'}
      </p>
    );
  }
  const update = (k: string, v: string) => setDestination({ ...destination, [k]: v });
  const inputCls = 'w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2.5 text-white text-[13px] focus:border-red-500/40 focus:outline-none placeholder:text-zinc-600';
  const labelCls = 'text-zinc-400 text-[11px] mb-1 block';

  if (method === 'sbp_card') {
    return (
      <div className="space-y-2.5">
        <div>
          <label className={labelCls}>{lang === 'ru' ? 'Телефон СБП' : 'SBP phone'}</label>
          <input className={inputCls} placeholder="+7 999 123 45 67" value={destination.phone ?? ''} onChange={(e) => update('phone', e.target.value)} inputMode="tel" />
        </div>
        <div>
          <label className={labelCls}>{lang === 'ru' ? 'Или номер карты' : 'Or card number'}</label>
          <input className={`${inputCls} font-mono tabular-nums`} placeholder="2200 0000 0000 0000" value={destination.cardNumber ?? ''} onChange={(e) => update('cardNumber', e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label className={labelCls}>{lang === 'ru' ? 'Банк (необязательно)' : 'Bank (optional)'}</label>
          <input className={inputCls} placeholder={lang === 'ru' ? 'Тинькофф, Сбер, Альфа…' : 'Tinkoff, Sber, …'} value={destination.bank ?? ''} onChange={(e) => update('bank', e.target.value)} />
        </div>
        <p className="text-amber-300/80 text-[10.5px] leading-relaxed break-words">
          {lang === 'ru'
            ? '⚠ Укажите либо телефон СБП, либо номер карты. Имя получателя СБП покажет автоматически.'
            : '⚠ Provide either an SBP phone or card number. The recipient name will be shown by SBP automatically.'}
        </p>
      </div>
    );
  }
  if (method === 'crypto') {
    // 2026-05-22: only the two assets the admin actually holds wallets for.
    // Network options change with the asset: USDT supports TON+TRC20,
    // TON only TON. Picking an asset auto-selects a sane default network
    // so the user can't end up in an invalid combo.
    const NETWORKS_BY_ASSET: Record<string, string[]> = {
      USDT: ['TON', 'TRC20'],
      TON: ['TON'],
    };
    const currentAsset = (destination.asset ?? 'USDT') as 'USDT' | 'TON';
    const availableNetworks = NETWORKS_BY_ASSET[currentAsset];
    return (
      <div className="space-y-2.5">
        <div>
          <label className={labelCls}>{lang === 'ru' ? 'Актив *' : 'Asset *'}</label>
          <div className="grid grid-cols-2 gap-1.5">
            {(['USDT', 'TON'] as const).map((a) => (
              <button
                key={a}
                onClick={() => {
                  // Reset network to first valid option for this asset.
                  setDestination({ ...destination, asset: a, network: NETWORKS_BY_ASSET[a][0] });
                }}
                className={`py-2 rounded-lg text-[12px] font-bold transition-colors ${
                  currentAsset === a
                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                    : 'bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:bg-white/[0.07]'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>{lang === 'ru' ? 'Сеть *' : 'Network *'}</label>
          <div className={`grid gap-1.5 ${availableNetworks.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {availableNetworks.map((n) => (
              <button
                key={n}
                onClick={() => update('network', n)}
                className={`py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                  (destination.network ?? availableNetworks[0]) === n
                    ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                    : 'bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:bg-white/[0.07]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-zinc-500 text-[10px] mt-1.5 leading-relaxed">
            {currentAsset === 'TON'
              ? (lang === 'ru' ? 'TON выводится только в сети TON.' : 'TON is paid out only via the TON network.')
              : (lang === 'ru' ? 'USDT — в сетях TON или TRC20.' : 'USDT — via TON or TRC20.')}
          </p>
        </div>
        <div>
          <label className={labelCls}>{lang === 'ru' ? 'Адрес кошелька *' : 'Wallet address *'}</label>
          <input
            className={`${inputCls} font-mono`}
            placeholder={(destination.network ?? availableNetworks[0]) === 'TON' ? 'UQ… или EQ…' : 'T…'}
            value={destination.address ?? ''}
            onChange={(e) => update('address', e.target.value)}
          />
        </div>
        <p className="text-amber-300/80 text-[10.5px] leading-relaxed">
          {lang === 'ru' ? '⚠ Внимательно проверьте сеть и адрес. Перевод в другой сети или на неверный адрес необратим.' : '⚠ Double-check network & address. Wrong-network transfers are irreversible.'}
        </p>
      </div>
    );
  }
  if (method === 'telegram_stars') {
    // Estimated Stars at the current rate. starsRate is ₽ per ⭐, so
    // stars = amountRub / starsRate. We round down to the nearest whole
    // star because Telegram doesn't transfer fractional Stars — what we
    // show is what the user will actually see in their balance.
    const estimatedStars = amountRub > 0 && starsRate > 0
      ? Math.floor(amountRub / starsRate)
      : 0;
    return (
      <div className="space-y-2.5">
        <div>
          <label className={labelCls}>{lang === 'ru' ? 'Telegram username' : 'Telegram username'}</label>
          <input className={inputCls} placeholder="@username" value={destination.telegramUsername ?? ''} onChange={(e) => update('telegramUsername', e.target.value)} />
        </div>
        {/* Live conversion preview using the admin-tunable rate from
            /api/settings/stars-rate. */}
        <div className="p-2.5 rounded-lg bg-blue-500/[0.08] border border-blue-500/20 text-blue-200 text-[11.5px] leading-relaxed">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-blue-300/80 text-[10px] uppercase tracking-wider">
              {lang === 'ru' ? 'Текущий курс' : 'Current rate'}
            </span>
            <span className="font-mono tabular-nums text-blue-200">{starsRate.toFixed(2)} ₽ / ⭐</span>
          </div>
          {amountRub > 0 ? (
            <p>
              {lang === 'ru' ? 'Вы получите примерно ' : 'You will receive about '}
              <span className="font-bold text-blue-100 tabular-nums">{estimatedStars} ⭐</span>
            </p>
          ) : (
            <p className="text-blue-300/70">
              {lang === 'ru' ? 'Введите сумму выше — покажу сколько ⭐ придёт.' : 'Enter an amount above to preview Stars.'}
            </p>
          )}
        </div>
        <p className="text-zinc-500 text-[10.5px] leading-relaxed">
          {lang === 'ru'
            ? 'Если оставить пусто — Stars придут на ваш текущий Telegram-аккаунт. Курс настраивается админом и может меняться.'
            : 'Leave empty to receive Stars on your current Telegram account. The rate is set by the admin and may change.'}
        </p>
      </div>
    );
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Withdrawals list (tab 2)
// ────────────────────────────────────────────────────────────────────────────
function WithdrawalsList({
  lang, list, loading, onOpenThread, onCreateNew,
}: {
  lang: 'ru' | 'en';
  list: WithdrawalRow[];
  loading: boolean;
  onOpenThread: (id: string) => void;
  onCreateNew: () => void;
}) {
  if (loading && list.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="text-zinc-500 animate-spin" />
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center text-center gap-3 px-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500/15 to-orange-600/5 border border-red-500/20 flex items-center justify-center">
          <History size={24} strokeWidth={1.75} className="text-red-300/80" />
        </div>
        <p className="text-white font-semibold text-[14px]">
          {lang === 'ru' ? 'Заявок ещё нет' : 'No requests yet'}
        </p>
        <p className="text-zinc-500 text-[12.5px] leading-relaxed max-w-[280px]">
          {lang === 'ru'
            ? 'Когда оформите вывод, его статус и переписка с админом появятся здесь.'
            : 'Submit a withdrawal and its status + chat with admin will appear here.'}
        </p>
        <button
          onClick={onCreateNew}
          className="mt-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-lg shadow-red-500/25 active:scale-95"
        >
          {lang === 'ru' ? 'Создать заявку' : 'Create request'}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2 pt-1">
      {list.map((w) => {
        const meta = statusMeta(w.status, lang);
        const Icon = meta.Icon;
        return (
          <button
            key={w.id}
            onClick={() => { haptic('light'); onOpenThread(w.id); }}
            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] active:scale-[0.99] transition-all text-left"
          >
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/[0.10] flex items-center justify-center shrink-0 overflow-hidden">
              {w.method === 'sbp_card' ? <SbpBrandIcon size={20} /> :
               w.method === 'crypto' ? <CryptoAtmIcon size={24} /> :
               <StarsGoldIcon size={22} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-white font-bold text-[15px] tabular-nums">{w.amountRub.toFixed(2)} ₽</p>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.cls} flex items-center gap-1`}>
                  <Icon size={9} strokeWidth={2.5} className={w.status === 'in_progress' ? 'animate-spin' : ''} />
                  {meta.label}
                </span>
              </div>
              <p className="text-zinc-500 text-[11px] truncate">
                {methodLabel(w.method, lang)} · {formatRelative(w.createdAt, lang)}
              </p>
            </div>
            <Send size={14} strokeWidth={2} className="text-zinc-500 shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Chat thread overlay — opens above the list when user taps a request.
// Self-contained: fetches messages, polls every 8s while open, and
// sends user replies / cancel-request via the existing endpoints.
// ────────────────────────────────────────────────────────────────────────────
function ThreadOverlay({
  lang, telegramId, withdrawalId, onClose,
}: {
  lang: 'ru' | 'en';
  telegramId: number;
  withdrawalId: string;
  onClose: () => void;
}) {
  const [withdrawal, setWithdrawal] = useState<WithdrawalRow | null>(null);
  const [messages, setMessages] = useState<WithdrawalMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    try {
      const res = await fetch(`/api/users/withdrawals/${withdrawalId}?telegramId=${telegramId}`);
      const data = await res.json();
      if (data?.ok) {
        setWithdrawal(data.withdrawal);
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      }
    } catch (e) {
      console.error('[ThreadOverlay] reload failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    const tid = setInterval(() => { void reload(); }, 8000);
    return () => clearInterval(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawalId, telegramId]);

  useEffect(() => {
    // Auto-scroll to bottom on new messages.
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const sendMessage = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/users/withdrawals/${withdrawalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message', telegramId, body: draft.trim() }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setDraft('');
        await reload();
      } else {
        alert(data?.error || 'Send failed');
      }
    } catch (e) {
      console.error('[ThreadOverlay] send failed:', e);
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async () => {
    if (cancelling) return;
    if (!window.confirm(lang === 'ru' ? 'Отменить заявку? Средства вернутся на баланс.' : 'Cancel this request? Funds will be refunded.')) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/users/withdrawals/${withdrawalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', telegramId }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        await reload();
      } else {
        alert(data?.error || 'Cancel failed');
      }
    } catch (e) {
      console.error('[ThreadOverlay] cancel failed:', e);
    } finally {
      setCancelling(false);
    }
  };

  const meta = withdrawal ? statusMeta(withdrawal.status, lang) : null;
  const isLocked = withdrawal && (withdrawal.status === 'paid' || withdrawal.status === 'rejected' || withdrawal.status === 'cancelled');

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 z-40 bg-[#020202] flex flex-col"
    >
      {/* Header */}
      <div
        className="shrink-0 px-5 pb-3 flex items-center gap-3 border-b border-white/[0.05]"
        style={{ paddingTop: 'calc(var(--sat, 0px) + 3.5rem)' }}
      >
        <button
          onClick={() => { haptic('light'); onClose(); }}
          className="w-9 h-9 rounded-xl border border-white/10 bg-white/[0.04] flex items-center justify-center active:scale-90 transition-transform shrink-0"
        >
          <ChevronLeft size={18} className="text-white" />
        </button>
        <div className="min-w-0 flex-1">
          {withdrawal ? (
            <>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-bold text-[14px] tabular-nums truncate">
                  {withdrawal.amountRub.toFixed(2)} ₽
                </h3>
                {meta && (
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.cls}`}>
                    {meta.label}
                  </span>
                )}
              </div>
              <p className="text-zinc-500 text-[11px] truncate">
                {methodLabel(withdrawal.method, lang)} · #{withdrawal.id}
              </p>
            </>
          ) : (
            <p className="text-zinc-500 text-[12px]">{lang === 'ru' ? 'Загрузка…' : 'Loading…'}</p>
          )}
        </div>
        {withdrawal?.status === 'pending' && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="px-2.5 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-[11px] font-semibold hover:bg-red-500/25 disabled:opacity-50 active:scale-95"
            title={lang === 'ru' ? 'Отменить заявку' : 'Cancel request'}
          >
            {cancelling ? <Loader2 size={12} className="animate-spin" /> : (lang === 'ru' ? 'Отменить' : 'Cancel')}
          </button>
        )}
      </div>

      {/* Destination summary */}
      {withdrawal && (
        <div className="shrink-0 px-5 py-3 bg-white/[0.02] border-b border-white/[0.05]">
          <DestinationSummary withdrawal={withdrawal} lang={lang} />
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-2.5">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={18} className="text-zinc-500 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-zinc-500 text-[12.5px] leading-relaxed">
              {lang === 'ru'
                ? 'Чат пуст. Можете задать вопрос админу или подождать обработки заявки.'
                : 'No messages yet. Ask the admin a question or wait for processing.'}
            </p>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} lang={lang} />)
        )}
      </div>

      {/* Input bar */}
      {!isLocked && (
        <div
          className="shrink-0 border-t border-white/[0.06] bg-[#0a0a0a] px-3 py-2.5 flex items-end gap-2"
          style={{ paddingBottom: 'calc(var(--sab, 0px) + 0.625rem)' }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={lang === 'ru' ? 'Написать админу…' : 'Message admin…'}
            rows={1}
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-white text-[13px] resize-none max-h-32 focus:border-red-500/40 focus:outline-none placeholder:text-zinc-600"
          />
          <button
            onClick={sendMessage}
            disabled={!draft.trim() || sending}
            className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 flex items-center justify-center hover:bg-red-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} strokeWidth={2.25} />}
          </button>
        </div>
      )}
    </motion.div>
  );
}

function DestinationSummary({ withdrawal, lang }: { withdrawal: WithdrawalRow; lang: 'ru' | 'en' }) {
  const d = withdrawal.destination ?? {};
  if (withdrawal.method === 'sbp_card') {
    return (
      <div className="text-[11.5px] space-y-0.5">
        <p className="text-zinc-500">{lang === 'ru' ? 'Получатель:' : 'Recipient:'} <span className="text-zinc-200">{d.fullName}</span></p>
        {d.phone && <p className="text-zinc-500">{lang === 'ru' ? 'Телефон СБП:' : 'SBP phone:'} <span className="text-zinc-200 font-mono">{d.phone}</span></p>}
        {d.cardNumber && <p className="text-zinc-500">{lang === 'ru' ? 'Карта:' : 'Card:'} <span className="text-zinc-200 font-mono">**** {String(d.cardNumber).slice(-4)}</span></p>}
        {d.bank && <p className="text-zinc-500">{lang === 'ru' ? 'Банк:' : 'Bank:'} <span className="text-zinc-200">{d.bank}</span></p>}
      </div>
    );
  }
  if (withdrawal.method === 'crypto') {
    return (
      <div className="text-[11.5px] space-y-0.5">
        <p className="text-zinc-500">{lang === 'ru' ? 'Сеть:' : 'Network:'} <span className="text-amber-300 font-semibold">{d.network}</span> · <span className="text-zinc-200">{d.asset || 'USDT'}</span></p>
        <p className="text-zinc-500 break-all">{lang === 'ru' ? 'Адрес:' : 'Address:'} <span className="text-zinc-200 font-mono">{d.address}</span></p>
      </div>
    );
  }
  if (withdrawal.method === 'telegram_stars') {
    return (
      <p className="text-[11.5px] text-zinc-500">
        {lang === 'ru' ? 'Получатель Stars:' : 'Stars recipient:'}{' '}
        <span className="text-zinc-200">{d.telegramUsername ? `@${d.telegramUsername}` : (lang === 'ru' ? 'текущий аккаунт' : 'current account')}</span>
      </p>
    );
  }
  return null;
}

function MessageBubble({ m, lang }: { m: WithdrawalMessageRow; lang: 'ru' | 'en' }) {
  if (m.authorRole === 'system') {
    return (
      <div className="flex justify-center">
        <span className="text-[10.5px] text-zinc-500 bg-white/[0.03] border border-white/[0.06] px-2.5 py-1 rounded-full">
          {m.body}
        </span>
      </div>
    );
  }
  const isUser = m.authorRole === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed ${
          isUser
            ? 'bg-red-500/20 border border-red-500/25 text-red-50 rounded-br-sm'
            : 'bg-white/[0.05] border border-white/[0.08] text-zinc-100 rounded-bl-sm'
        }`}
      >
        {!isUser && (
          <p className="text-[9.5px] uppercase tracking-wider text-zinc-500 mb-0.5">
            {lang === 'ru' ? 'Админ' : 'Admin'}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        <p className="text-[9.5px] text-zinc-500 mt-1 text-right tabular-nums">
          {new Date(m.createdAt).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}
