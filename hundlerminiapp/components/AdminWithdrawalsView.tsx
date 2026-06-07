'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Send,
  ChevronLeft,
  CreditCard,
  Bitcoin,
  Star,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  AlertCircle,
  RefreshCw,
  PlayCircle,
  Wallet,
  User as UserIcon,
  Trash2,
} from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────────
// AdminWithdrawalsView (2026-05-22) — admin inbox for referral cash
// withdrawal requests. Two-pane layout on desktop, stacked on mobile:
//
//   [ left: list of requests ]    [ right: selected request + chat ]
//
// Status filter buttons across the top (pending / in_progress / paid /
// rejected / cancelled / all). Each list row shows the requester, amount,
// method, last message preview and status pill — enough to triage at a
// glance. Tapping a row opens the right pane with the full chat thread,
// destination details, and the action buttons:
//
//   · "Взять в работу"   (pending → in_progress)
//   · "Выплачено"        (in_progress → paid)
//   · "Отклонить"        (any → rejected, refund balance)
//
// All actions go through POST /api/admin/withdrawals/[id] which validates
// the transition server-side. The chat is polled every 8s while open.
// ────────────────────────────────────────────────────────────────────────────

type Method = 'sbp_card' | 'crypto' | 'telegram_stars';
type Status = 'pending' | 'in_progress' | 'paid' | 'rejected' | 'cancelled';

type ListItem = {
  id: string;
  userId: number;
  amountRub: number;
  method: Method;
  destination: Record<string, any>;
  status: Status;
  payoutNote: string | null;
  processedAt: string | null;
  processedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: { body: string; authorRole: string; createdAt: string | null } | null;
  user: {
    id: number;
    telegramId: string | null;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    displayName: string;
  };
};

type Totals = {
  pending: number;
  inProgress: number;
  paid: number;
  rejected: number;
  cancelled: number;
  openAmountRub: number;
};

type DetailMessage = {
  id: string;
  authorUserId: number;
  authorRole: 'user' | 'admin' | 'system';
  body: string;
  attachmentUrl: string | null;
  createdAt: string;
};

type DetailWithdrawal = ListItem;
type DetailUser = ListItem['user'] & { photoUrl: string | null; referralBalanceRub: number };

function statusMeta(status: Status, lang: 'ru' | 'en') {
  switch (status) {
    case 'pending':
      return { label: lang === 'ru' ? 'Ожидает' : 'Pending', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', Icon: Clock };
    case 'in_progress':
      return { label: lang === 'ru' ? 'В работе' : 'In progress', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30', Icon: Loader2 };
    case 'paid':
      return { label: lang === 'ru' ? 'Выплачено' : 'Paid', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', Icon: CheckCircle2 };
    case 'rejected':
      return { label: lang === 'ru' ? 'Отклонено' : 'Rejected', cls: 'bg-red-500/15 text-red-300 border-red-500/30', Icon: XCircle };
    case 'cancelled':
      return { label: lang === 'ru' ? 'Отменено' : 'Cancelled', cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30', Icon: Ban };
  }
}

function methodLabel(m: Method, lang: 'ru' | 'en'): string {
  if (m === 'sbp_card') return lang === 'ru' ? 'СБП / карта' : 'SBP / card';
  if (m === 'crypto') return lang === 'ru' ? 'Крипта' : 'Crypto';
  return 'Stars';
}

function methodIcon(m: Method) {
  if (m === 'sbp_card') return <CreditCard size={14} strokeWidth={2} className="text-emerald-300" />;
  if (m === 'crypto') return <Bitcoin size={14} strokeWidth={2} className="text-amber-300" />;
  return <Star size={14} strokeWidth={2} className="text-blue-300" />;
}

// One-liner used in the list row so the admin can see куда платить ещё
// до открытия деталей. Truncates long crypto addresses into <head>…<tail>
// и в общем — старается уместить самое важное в одну строчку.
function destinationSummary(
  method: Method,
  destination: Record<string, any> | null | undefined,
  lang: 'ru' | 'en',
): string {
  const d = destination ?? {};
  if (method === 'sbp_card') {
    const parts: string[] = [];
    if (d.phone) parts.push(String(d.phone));
    if (d.cardNumber) {
      const card = String(d.cardNumber);
      parts.push(card.length > 8 ? `${card.slice(0, 4)}…${card.slice(-4)}` : card);
    }
    if (d.bank) parts.push(String(d.bank));
    if (parts.length === 0) return lang === 'ru' ? '— реквизиты не указаны' : '— no destination';
    return parts.join(' · ');
  }
  if (method === 'crypto') {
    const asset = (d.asset as string) || 'USDT';
    const network = (d.network as string) || '?';
    const addr = String(d.address ?? '');
    const short = addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
    return `${asset} (${network}) · ${short || (lang === 'ru' ? 'без адреса' : 'no address')}`;
  }
  if (method === 'telegram_stars') {
    if (d.telegramUsername) return `@${d.telegramUsername}`;
    return lang === 'ru' ? 'на текущий аккаунт' : 'to current account';
  }
  return '';
}

function fmtTime(iso: string | null, lang: 'ru' | 'en'): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMin = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (diffMin < 1) return lang === 'ru' ? 'только что' : 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US');
}

// 2026-05-23: top-level tab между "Заявки" и "Балансы". Балансы — это
// список всех юзеров с ненулевым referral_balance_rub (даже если они
// не подавали заявку). См. /api/admin/withdrawals/balances.
type TopTab = 'requests' | 'balances';

export default function AdminWithdrawalsView({
  tgId, lang,
}: {
  tgId: number | undefined;
  lang: 'ru' | 'en';
}) {
  const [topTab, setTopTab] = useState<TopTab>('requests');
  const [items, setItems] = useState<ListItem[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [filter, setFilter] = useState<Status | 'all'>('pending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 2026-05-22: defensive flag — until the migration runs (creates
  // referral_withdrawals + referral_balance_transactions), the GET
  // endpoint 500s. We show a friendly banner with a "run migration"
  // button instead of a generic error.
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [migrating, setMigrating] = useState(false);
  // 2026-05-22: dev-only "grant 500₽" button so the admin can exercise
  // the withdrawal flow without inviting real paying friends. Backed
  // by POST /api/admin/db/grant-test-balance.
  const [granting, setGranting] = useState(false);
  const [grantToast, setGrantToast] = useState<string | null>(null);
  // 2026-05-22: Stars rate editor. Read from /api/settings/stars-rate
  // (public GET), written via the same endpoint with telegramId in body.
  const [starsRate, setStarsRate] = useState<number | null>(null);
  const [starsRateDraft, setStarsRateDraft] = useState('');
  const [savingRate, setSavingRate] = useState(false);
  const [rateToast, setRateToast] = useState<string | null>(null);

  const fetchList = async () => {
    if (!tgId) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/admin/withdrawals', window.location.origin);
      url.searchParams.set('telegramId', String(tgId));
      if (filter !== 'all') url.searchParams.set('status', filter);
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        // Specifically detect missing-table errors so the admin can
        // fire the migration runner from the UI without leaving the page.
        const msg = String(data?.error || `HTTP ${res.status}`);
        if (/relation .* does not exist/i.test(msg) || /referral_withdrawals/i.test(msg)) {
          setMigrationNeeded(true);
          setError(null);
          return;
        }
        setError(msg);
        return;
      }
      setMigrationNeeded(false);
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotals(data.totals ?? null);
    } catch (e: any) {
      console.error('[AdminWithdrawalsView] fetch failed:', e);
      setError(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const grantTestBalance = async () => {
    if (!tgId || granting) return;
    setGranting(true);
    setGrantToast(null);
    try {
      const res = await fetch('/api/admin/db/grant-test-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, amountRub: 500 }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setGrantToast(lang === 'ru'
          ? `+500 ₽ начислено. Баланс: ${Number(data.balanceRub).toFixed(2)} ₽`
          : `+500 ₽ credited. Balance: ${Number(data.balanceRub).toFixed(2)} ₽`);
        setTimeout(() => setGrantToast(null), 3500);
      } else {
        setGrantToast(data?.error || 'Grant failed');
        setTimeout(() => setGrantToast(null), 4000);
      }
    } catch (e: any) {
      setGrantToast(e?.message || 'Network error');
    } finally {
      setGranting(false);
    }
  };

  const runMigration = async () => {
    if (!tgId || migrating) return;
    setMigrating(true);
    try {
      const res = await fetch('/api/admin/db/migrate-referral-cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setMigrationNeeded(false);
        await fetchList();
      } else {
        setError(data?.error || `Migration failed (HTTP ${res.status})`);
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setMigrating(false);
    }
  };

  useEffect(() => {
    void fetchList();
    // Refresh every 15s so the admin sees new requests without manual refresh.
    const tid = setInterval(() => { void fetchList(); }, 15000);
    return () => clearInterval(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgId, filter]);

  // Load the current Stars rate on mount. We seed the draft input from
  // the live value so the admin can tweak from "what's set" instead of
  // typing the whole number again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/stars-rate');
        const data = await res.json();
        if (!cancelled && data?.ok && Number.isFinite(data.rate)) {
          setStarsRate(Number(data.rate));
          setStarsRateDraft(String(data.rate));
        }
      } catch (e) {
        console.warn('[AdminWithdrawalsView] stars-rate fetch failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveStarsRate = async () => {
    if (!tgId || savingRate) return;
    const num = Number(starsRateDraft);
    if (!Number.isFinite(num) || num <= 0) {
      setRateToast(lang === 'ru' ? 'Введите положительное число' : 'Enter a positive number');
      setTimeout(() => setRateToast(null), 3000);
      return;
    }
    setSavingRate(true);
    setRateToast(null);
    try {
      const res = await fetch('/api/settings/stars-rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, rate: num }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setStarsRate(Number(data.rate));
        setStarsRateDraft(String(data.rate));
        setRateToast(lang === 'ru' ? 'Курс обновлён' : 'Rate updated');
        setTimeout(() => setRateToast(null), 2500);
      } else {
        setRateToast(data?.error || 'Save failed');
        setTimeout(() => setRateToast(null), 4000);
      }
    } catch (e: any) {
      setRateToast(e?.message || 'Network error');
    } finally {
      setSavingRate(false);
    }
  };

  return (
    // min-w-0 on every flex/grid descendant — the parent AdminView wraps
    // us in a fixed-width column on mobile (≤360px), and a single
    // unbreakable word in an error string used to push our content past
    // the viewport edge. break-words + min-w-0 stop that cold.
    <div className="min-w-0">
      {/* 2026-05-23: two top-level tabs внутри views — "Заявки" (старый
          flow) и "Балансы" (новый: список юзеров с ненулевым кошельком). */}
      <div className="mb-3 flex gap-1.5 flex-wrap">
        <button
          onClick={() => setTopTab('requests')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
            topTab === 'requests'
              ? 'bg-red-500/15 border-red-500/40 text-red-200'
              : 'bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-white'
          }`}
        >
          {lang === 'ru' ? 'Заявки' : 'Requests'}
        </button>
        <button
          onClick={() => setTopTab('balances')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
            topTab === 'balances'
              ? 'bg-red-500/15 border-red-500/40 text-red-200'
              : 'bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-white'
          }`}
        >
          <Wallet size={12} strokeWidth={2.25} />
          {lang === 'ru' ? 'Балансы юзеров' : 'User balances'}
        </button>
      </div>

      {topTab === 'balances' && (
        <BalancesPane tgId={tgId} lang={lang} />
      )}

      {topTab === 'requests' && (
      <>
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap min-w-0">
        <p className="text-zinc-500 text-[10px] uppercase tracking-wider shrink-0">
          {lang === 'ru' ? 'Заявки на вывод' : 'Withdrawal requests'}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Dev test grant — admin-only, capped at 50 000 ₽ per call. */}
          <button
            onClick={() => void grantTestBalance()}
            disabled={granting}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-fuchsia-500/15 border border-fuchsia-500/30 hover:bg-fuchsia-500/25 text-fuchsia-200 text-[11px] font-semibold transition-colors active:scale-95 disabled:opacity-50"
            title={lang === 'ru' ? 'Тестовое начисление 500 ₽ на свой реф-баланс' : 'Credit yourself 500 ₽ for testing'}
          >
            {granting ? <Loader2 size={11} className="animate-spin" /> : <Wallet size={11} strokeWidth={2.25} />}
            {lang === 'ru' ? '+ 500 ₽ себе' : '+ 500 ₽ self'}
          </button>
          <button
            onClick={() => void fetchList()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-zinc-300 text-[11px] font-medium transition-colors active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={11} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
            {lang === 'ru' ? 'Обновить' : 'Refresh'}
          </button>
        </div>
      </div>

      {grantToast && (
        <div className="mb-2 p-2 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-200 text-[12px] flex items-start gap-2 min-w-0">
          <CheckCircle2 size={12} className="shrink-0 mt-0.5" />
          <span className="break-words min-w-0">{grantToast}</span>
        </div>
      )}

      {/* Stars conversion rate editor (2026-05-22). Admin types the new
          ₽-per-⭐ rate, presses save → /api/settings/stars-rate updates.
          The user-side WithdrawalModal re-reads this on each open so
          the change propagates within seconds. */}
      <div className="mb-3 p-3 rounded-xl bg-blue-500/[0.05] border border-blue-500/20">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Star size={13} className="text-blue-300 shrink-0" />
          <p className="text-blue-200 text-[12px] font-bold">
            {lang === 'ru' ? 'Курс Telegram Stars' : 'Telegram Stars rate'}
          </p>
          {starsRate !== null && (
            <span className="text-blue-300/80 text-[11px] tabular-nums ml-auto">
              {lang === 'ru' ? 'сейчас' : 'now'}: <span className="text-blue-200 font-semibold">{starsRate.toFixed(2)} ₽ / ⭐</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="relative flex-1 min-w-[120px]">
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              value={starsRateDraft}
              onChange={(e) => setStarsRateDraft(e.target.value)}
              placeholder="0.50"
              className="w-full bg-black/30 border border-white/[0.08] rounded-lg pl-3 pr-12 py-2 text-white text-[13px] font-mono tabular-nums focus:border-blue-500/40 focus:outline-none"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300/70 text-[11px] font-medium pointer-events-none">₽/⭐</span>
          </div>
          <button
            onClick={() => void saveStarsRate()}
            disabled={savingRate || !starsRateDraft || Number(starsRateDraft) === starsRate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-200 text-[12px] font-semibold hover:bg-blue-500/30 active:scale-95 disabled:opacity-40 transition-all shrink-0"
          >
            {savingRate ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} strokeWidth={2.25} />}
            {lang === 'ru' ? 'Сохранить' : 'Save'}
          </button>
        </div>
        <p className="text-blue-300/60 text-[10.5px] mt-1.5 leading-relaxed">
          {lang === 'ru'
            ? 'Сколько рублей стоит одна ⭐. Пользователи увидят оценку в форме вывода Stars. Сами Stars вы отправляете руками — это только справка.'
            : 'How many ₽ one ⭐ is worth. Users see the estimate in the Stars withdrawal form. You send Stars manually — this is informational only.'}
        </p>
        {rateToast && (
          <div className="mt-2 text-[11px] text-blue-200 break-words">{rateToast}</div>
        )}
      </div>

      {migrationNeeded && (
        <div className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-300 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-amber-200 text-[12px] font-semibold mb-1">
              {lang === 'ru' ? 'Требуется миграция БД' : 'DB migration required'}
            </p>
            <p className="text-amber-200/80 text-[11px] leading-relaxed mb-2">
              {lang === 'ru'
                ? 'Таблицы referral_withdrawals и referral_balance_transactions ещё не созданы. Нажмите кнопку, чтобы применить идемпотентную миграцию 2026-05-22-referral-cash.sql.'
                : 'Tables referral_withdrawals and referral_balance_transactions don\'t exist yet. Click to apply the idempotent 2026-05-22-referral-cash.sql migration.'}
            </p>
            <button
              onClick={runMigration}
              disabled={migrating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[11px] font-bold hover:bg-amber-500/30 active:scale-95 disabled:opacity-50"
            >
              {migrating ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} strokeWidth={2.25} />}
              {migrating ? (lang === 'ru' ? 'Применение…' : 'Applying…') : (lang === 'ru' ? 'Применить миграцию' : 'Apply migration')}
            </button>
          </div>
        </div>
      )}

      {/* Totals bar — 2 cols on phones so "ОЖИДАЮТ"/"ОТКЛОНЕНО" fit
          comfortably; 3 cols on tablets; full row of 6 on desktop. */}
      {totals && !migrationNeeded && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 mb-3">
          {[
            { k: 'pending' as const, label: lang === 'ru' ? 'Ожидают' : 'Pending', val: totals.pending, color: 'amber' },
            { k: 'in_progress' as const, label: lang === 'ru' ? 'В работе' : 'In progress', val: totals.inProgress, color: 'blue' },
            { k: 'paid' as const, label: lang === 'ru' ? 'Выплачено' : 'Paid', val: totals.paid, color: 'emerald' },
            { k: 'rejected' as const, label: lang === 'ru' ? 'Отклонено' : 'Rejected', val: totals.rejected, color: 'red' },
            { k: 'cancelled' as const, label: lang === 'ru' ? 'Отмена' : 'Cancelled', val: totals.cancelled, color: 'zinc' },
            { k: 'open' as const, label: lang === 'ru' ? 'К выплате ₽' : 'Open ₽', val: totals.openAmountRub.toFixed(0), color: 'fuchsia' },
          ].map(({ k, label, val, color }) => (
            <div
              key={k}
              className={`p-2 rounded-lg border bg-${color}-500/[0.05] border-${color}-500/[0.15] text-center`}
              style={{ borderColor: `rgba(255,255,255,0.06)` }}
            >
              <p className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">{label}</p>
              <p className={`text-${color}-300 font-bold text-[15px] tabular-nums`}>{val}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter chips */}
      {!migrationNeeded && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide mb-2">
          {(['pending', 'in_progress', 'paid', 'rejected', 'cancelled', 'all'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors ${
                filter === s
                  ? 'bg-white/[0.08] border-white/[0.20] text-white'
                  : 'bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:bg-white/[0.05]'
              }`}
            >
              {s === 'all' ? (lang === 'ru' ? 'Все' : 'All') : statusMeta(s as Status, lang).label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-[12px] flex items-start gap-2 mb-3 min-w-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span className="leading-relaxed break-words min-w-0">{error}</span>
        </div>
      )}

      {!migrationNeeded && (
        <div className="grid lg:grid-cols-[minmax(0,360px)_1fr] gap-3 min-h-[60vh] min-w-0">
          {/* List pane */}
          <div className={`${selectedId ? 'hidden lg:block' : ''} space-y-1.5 min-w-0`}>
            {loading && items.length === 0 ? (
              <div className="py-10 flex items-center justify-center">
                <Loader2 size={18} className="text-zinc-500 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-[12px]">
                {lang === 'ru' ? 'Заявок нет' : 'No requests'}
              </div>
            ) : (
              items.map((it) => {
                const meta = statusMeta(it.status, lang);
                const Icon = meta.Icon;
                const selected = selectedId === it.id;
                return (
                  <button
                    key={it.id}
                    onClick={() => setSelectedId(it.id)}
                    className={`w-full p-2.5 rounded-xl border text-left transition-colors ${
                      selected
                        ? 'bg-emerald-500/[0.08] border-emerald-500/30'
                        : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="shrink-0">{methodIcon(it.method)}</span>
                      <p className="text-white font-bold text-[14px] tabular-nums">
                        {it.amountRub.toFixed(2)} ₽
                      </p>
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.cls} flex items-center gap-1 ml-auto shrink-0`}>
                        <Icon size={8} strokeWidth={2.5} className={it.status === 'in_progress' ? 'animate-spin' : ''} />
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-zinc-300 text-[11px] truncate">
                      {it.user.displayName}
                    </p>
                    {/* One-line destination summary so the admin can
                        triage who/where to pay without opening the row. */}
                    <p className="text-amber-200/85 text-[10.5px] truncate mt-0.5 font-mono">
                      {destinationSummary(it.method, it.destination, lang)}
                    </p>
                    {it.lastMessage && (
                      <p className="text-zinc-500 text-[10.5px] truncate mt-0.5">
                        {it.lastMessage.authorRole === 'admin' && '↳ '}
                        {it.lastMessage.authorRole === 'system' && '⚙ '}
                        {it.lastMessage.body}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-zinc-500 text-[10px]">{methodLabel(it.method, lang)} · {fmtTime(it.createdAt, lang)}</p>
                      {it.messageCount > 0 && (
                        <span className="text-[9.5px] text-zinc-500">{it.messageCount} {lang === 'ru' ? 'сообщ.' : 'msg'}</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Detail pane */}
          {selectedId ? (
            <DetailPane
              key={selectedId}
              tgId={tgId}
              withdrawalId={selectedId}
              lang={lang}
              onBack={() => setSelectedId(null)}
              onChanged={fetchList}
            />
          ) : (
            <div className="hidden lg:flex items-center justify-center text-zinc-600 text-[12.5px] border border-dashed border-white/[0.08] rounded-2xl">
              {lang === 'ru' ? 'Выберите заявку слева' : 'Pick a request from the list'}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Detail pane — opens for the selected request, shows full destination,
// chat thread, and admin action buttons. Self-contained: fetches its own
// data and polls every 8s.
// ────────────────────────────────────────────────────────────────────────────
function DetailPane({
  tgId, withdrawalId, lang, onBack, onChanged,
}: {
  tgId: number | undefined;
  withdrawalId: string;
  lang: 'ru' | 'en';
  onBack: () => void;
  onChanged: () => void;
}) {
  const [withdrawal, setWithdrawal] = useState<DetailWithdrawal | null>(null);
  const [user, setUser] = useState<DetailUser | null>(null);
  const [messages, setMessages] = useState<DetailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [payoutNote, setPayoutNote] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    if (!tgId) return;
    try {
      const res = await fetch(`/api/admin/withdrawals/${withdrawalId}?telegramId=${tgId}`);
      const data = await res.json();
      if (data?.ok) {
        setWithdrawal(data.withdrawal);
        setUser(data.user);
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      }
    } catch (e) {
      console.error('[AdminWithdrawals/DetailPane] reload failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void reload();
    const tid = setInterval(() => { void reload(); }, 8000);
    return () => clearInterval(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawalId, tgId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const sendMessage = async () => {
    if (!draft.trim() || sending || !tgId) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/withdrawals/${withdrawalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message', telegramId: tgId, body: draft.trim() }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setDraft('');
        await reload();
      } else {
        setActionError(data?.error || 'Send failed');
      }
    } catch (e: any) {
      setActionError(e?.message || 'Network error');
    } finally {
      setSending(false);
    }
  };

  // Полное удаление заявки (с возвратом средств если ещё не закрыта).
  // Используется админом для чистки тестовых заявок чтобы не мозолили
  // глаза в списке. Дёргает DELETE /api/admin/withdrawals/<id>.
  const doDelete = async () => {
    if (!tgId || actionBusy || !withdrawal) return;
    const isOpen = withdrawal.status === 'pending' || withdrawal.status === 'in_progress';
    const confirmText = isOpen
      ? (lang === 'ru'
          ? `Удалить заявку #${withdrawal.id}? Сумма ${withdrawal.amountRub.toFixed(2)} ₽ вернётся пользователю.`
          : `Delete request #${withdrawal.id}? ${withdrawal.amountRub.toFixed(2)} ₽ will be refunded.`)
      : (lang === 'ru'
          ? `Удалить заявку #${withdrawal.id} навсегда? История переписки тоже будет удалена.`
          : `Delete request #${withdrawal.id} permanently? Chat history will be deleted too.`);
    if (!window.confirm(confirmText)) return;
    setActionBusy('delete' as any);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/withdrawals/${withdrawalId}?telegramId=${tgId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        // Notify the parent so it refreshes the list, then bail out of
        // the detail pane (the withdrawal we were viewing no longer
        // exists).
        onChanged();
        onBack();
      } else {
        setActionError(data?.error || 'Delete failed');
      }
    } catch (e: any) {
      setActionError(e?.message || 'Network error');
    } finally {
      setActionBusy(null);
    }
  };

  const doAction = async (status: 'in_progress' | 'paid' | 'rejected') => {
    if (!tgId || actionBusy) return;
    if (status === 'rejected' && !payoutNote.trim()) {
      setActionError(lang === 'ru' ? 'Укажите причину отклонения' : 'Provide a reason for rejection');
      return;
    }
    if (status === 'paid' && !window.confirm(lang === 'ru' ? 'Подтвердить выплату? Заявка закроется.' : 'Confirm payout? Request will be closed.')) {
      return;
    }
    setActionBusy(status);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/withdrawals/${withdrawalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          telegramId: tgId,
          status,
          payoutNote: payoutNote.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setPayoutNote('');
        await reload();
        onChanged();
      } else {
        setActionError(data?.error || 'Action failed');
      }
    } catch (e: any) {
      setActionError(e?.message || 'Network error');
    } finally {
      setActionBusy(null);
    }
  };

  if (loading && !withdrawal) {
    return (
      <div className="flex items-center justify-center py-12 border border-white/[0.08] rounded-2xl">
        <Loader2 size={20} className="text-zinc-500 animate-spin" />
      </div>
    );
  }
  if (!withdrawal) {
    return (
      <div className="p-6 text-center text-zinc-500 border border-white/[0.08] rounded-2xl">
        {lang === 'ru' ? 'Заявка не найдена' : 'Not found'}
      </div>
    );
  }

  const meta = statusMeta(withdrawal.status, lang);
  const Icon = meta.Icon;
  const d = withdrawal.destination ?? {};
  const isLocked = withdrawal.status === 'paid' || withdrawal.status === 'rejected' || withdrawal.status === 'cancelled';

  return (
    <div className="border border-white/[0.08] rounded-2xl bg-[#080808] flex flex-col overflow-hidden">
      {/* Header with back button on mobile */}
      <div className="shrink-0 px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <button
          onClick={onBack}
          className="lg:hidden w-8 h-8 rounded-lg border border-white/10 bg-white/[0.04] flex items-center justify-center active:scale-90 shrink-0"
        >
          <ChevronLeft size={16} className="text-white" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-white font-bold text-[15px] tabular-nums">
              {withdrawal.amountRub.toFixed(2)} ₽
            </p>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.cls} flex items-center gap-1`}>
              <Icon size={9} strokeWidth={2.5} className={withdrawal.status === 'in_progress' ? 'animate-spin' : ''} />
              {meta.label}
            </span>
          </div>
          <p className="text-zinc-500 text-[11px] truncate">
            #{withdrawal.id} · {methodLabel(withdrawal.method, lang)} · {fmtTime(withdrawal.createdAt, lang)}
          </p>
        </div>
        {/* Permanent-delete button — works for any status. Refunds the
            balance if the request was still open. */}
        <button
          onClick={() => void doDelete()}
          disabled={!!actionBusy}
          title={lang === 'ru' ? 'Удалить заявку' : 'Delete request'}
          aria-label="Delete"
          className="shrink-0 w-8 h-8 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 flex items-center justify-center hover:bg-red-500/20 active:scale-95 disabled:opacity-50 transition-all"
        >
          {actionBusy === ('delete' as any) ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} strokeWidth={2.25} />}
        </button>
      </div>

      {/* User + destination block */}
      <div className="shrink-0 px-4 py-3 border-b border-white/[0.06] bg-white/[0.01] space-y-2">
        {user && (
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-zinc-800 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
              {user.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.photoUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon size={14} className="text-zinc-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-[12.5px] font-semibold truncate">{user.displayName}</p>
              <p className="text-zinc-500 text-[10.5px] truncate">
                {user.username && `@${user.username}`}
                {user.username && user.telegramId && ' · '}
                {user.telegramId && `tg:${user.telegramId}`}
                {user.email && ` · ${user.email}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-zinc-500 text-[9.5px] uppercase tracking-wider">
                {lang === 'ru' ? 'Баланс' : 'Balance'}
              </p>
              <p className="text-emerald-300 text-[12px] font-bold tabular-nums">{user.referralBalanceRub.toFixed(2)} ₽</p>
            </div>
          </div>
        )}
        <div className="text-[11.5px] space-y-0.5 pt-1.5 border-t border-white/[0.04]">
          {withdrawal.method === 'sbp_card' && (
            <>
              {d.fullName && (
                <p className="text-zinc-500">{lang === 'ru' ? 'Получатель:' : 'Recipient:'} <span className="text-zinc-200 font-semibold">{d.fullName}</span></p>
              )}
              {d.phone && <p className="text-zinc-500">{lang === 'ru' ? 'Телефон СБП:' : 'SBP phone:'} <span className="text-zinc-200 font-mono">{d.phone}</span></p>}
              {d.cardNumber && <p className="text-zinc-500">{lang === 'ru' ? 'Карта:' : 'Card:'} <span className="text-zinc-200 font-mono">{d.cardNumber}</span></p>}
              {d.bank && <p className="text-zinc-500">{lang === 'ru' ? 'Банк:' : 'Bank:'} <span className="text-zinc-200">{d.bank}</span></p>}
            </>
          )}
          {withdrawal.method === 'crypto' && (
            <>
              <p className="text-zinc-500">{lang === 'ru' ? 'Сеть:' : 'Network:'} <span className="text-amber-300 font-semibold">{d.network}</span> · <span className="text-zinc-200">{d.asset || 'USDT'}</span></p>
              <p className="text-zinc-500 break-all">{lang === 'ru' ? 'Адрес:' : 'Address:'} <span className="text-zinc-200 font-mono">{d.address}</span></p>
            </>
          )}
          {withdrawal.method === 'telegram_stars' && (
            <p className="text-zinc-500">
              {lang === 'ru' ? 'Получатель Stars:' : 'Stars recipient:'}{' '}
              <span className="text-zinc-200">{d.telegramUsername ? `@${d.telegramUsername}` : (lang === 'ru' ? 'текущий аккаунт пользователя' : 'user\'s current account')}</span>
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[200px] max-h-[400px]">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-[12px]">
            {lang === 'ru' ? 'Сообщений пока нет' : 'No messages yet'}
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} lang={lang} />)
        )}
      </div>

      {/* Action bar */}
      {!isLocked && (
        <div className="shrink-0 border-t border-white/[0.06] p-3 space-y-2">
          {actionError && (
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-[11.5px] flex items-start gap-1.5">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}
          {(withdrawal.status === 'pending' || withdrawal.status === 'in_progress') && (
            <input
              type="text"
              value={payoutNote}
              onChange={(e) => setPayoutNote(e.target.value)}
              placeholder={lang === 'ru' ? 'Заметка (TX hash, причина отказа…)' : 'Note (TX hash, rejection reason…)'}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-white text-[12px] placeholder:text-zinc-600 focus:outline-none focus:border-white/20"
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            {withdrawal.status === 'pending' && (
              <button
                onClick={() => void doAction('in_progress')}
                disabled={!!actionBusy}
                className="col-span-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[12px] font-semibold hover:bg-blue-500/25 active:scale-[0.98] disabled:opacity-50"
              >
                {actionBusy === 'in_progress' ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} strokeWidth={2.25} />}
                {lang === 'ru' ? 'Взять в работу' : 'Take in progress'}
              </button>
            )}
            {(withdrawal.status === 'pending' || withdrawal.status === 'in_progress') && (
              <>
                <button
                  onClick={() => void doAction('paid')}
                  disabled={!!actionBusy || withdrawal.status === 'pending'}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[12px] font-semibold hover:bg-emerald-500/25 active:scale-[0.98] disabled:opacity-40"
                  title={withdrawal.status === 'pending' ? (lang === 'ru' ? 'Сначала "Взять в работу"' : 'Take in progress first') : undefined}
                >
                  {actionBusy === 'paid' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} strokeWidth={2.25} />}
                  {lang === 'ru' ? 'Выплачено' : 'Paid'}
                </button>
                <button
                  onClick={() => void doAction('rejected')}
                  disabled={!!actionBusy}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-[12px] font-semibold hover:bg-red-500/25 active:scale-[0.98] disabled:opacity-50"
                >
                  {actionBusy === 'rejected' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} strokeWidth={2.25} />}
                  {lang === 'ru' ? 'Отклонить' : 'Reject'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Chat input */}
      {!isLocked && (
        <div className="shrink-0 border-t border-white/[0.06] bg-[#0a0a0a] px-3 py-2.5 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={lang === 'ru' ? 'Ответить пользователю…' : 'Reply to user…'}
            rows={1}
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-white text-[12.5px] resize-none max-h-32 focus:border-emerald-500/40 focus:outline-none placeholder:text-zinc-600"
          />
          <button
            onClick={sendMessage}
            disabled={!draft.trim() || sending}
            className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 flex items-center justify-center hover:bg-emerald-500/30 active:scale-95 disabled:opacity-40 transition-all shrink-0"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} strokeWidth={2.25} />}
          </button>
        </div>
      )}

      {/* Read-only footer if terminal */}
      {isLocked && (
        <div className="shrink-0 border-t border-white/[0.06] p-3 text-zinc-500 text-[11.5px] text-center">
          {lang === 'ru' ? 'Заявка закрыта. Переписка только для чтения.' : 'Request closed. Messages are read-only.'}
          {withdrawal.payoutNote && (
            <p className="text-zinc-300 text-[11.5px] mt-1.5 italic">«{withdrawal.payoutNote}»</p>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ m, lang }: { m: DetailMessage; lang: 'ru' | 'en' }) {
  if (m.authorRole === 'system') {
    return (
      <div className="flex justify-center">
        <span className="text-[10px] text-zinc-500 bg-white/[0.03] border border-white/[0.06] px-2 py-1 rounded-full">
          {m.body}
        </span>
      </div>
    );
  }
  const isAdmin = m.authorRole === 'admin';
  return (
    <div className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-2xl text-[12.5px] leading-relaxed ${
          isAdmin
            ? 'bg-emerald-500/20 border border-emerald-500/25 text-emerald-50 rounded-br-sm'
            : 'bg-white/[0.05] border border-white/[0.08] text-zinc-100 rounded-bl-sm'
        }`}
      >
        {!isAdmin && (
          <p className="text-[9.5px] uppercase tracking-wider text-zinc-500 mb-0.5">
            {lang === 'ru' ? 'Пользователь' : 'User'}
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

// ────────────────────────────────────────────────────────────────────────────
// BalancesPane (2026-05-23) — список всех юзеров с НЕНУЛЕВЫМ реферальным
// балансом. Источник — GET /api/admin/withdrawals/balances. Показываем
// баланс, lifetime заработано, выведено, открытые заявки + контакты для
// связи (tg/email).
// ────────────────────────────────────────────────────────────────────────────

type BalanceItem = {
  id: number;
  telegramId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  photoUrl: string | null;
  displayName: string;
  balanceRub: number;
  lifetimeEarnedRub: number;
  paidOutRub: number;
  openRequestRub: number;
  lastAccrualAt: string | null;
};

type BalanceTotals = {
  usersWithBalance: number;
  totalBalanceRub: number;
  lifetimeAccruedRub: number;
};

function BalancesPane({ tgId, lang }: { tgId: number | undefined; lang: 'ru' | 'en' }) {
  const [items, setItems] = useState<BalanceItem[]>([]);
  const [totals, setTotals] = useState<BalanceTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // 2026-05-23: backfill state. Таблица referral_balance_transactions
  // была добавлена 2026-05-22, и все SBP-платежи ДО этой даты не
  // получили 10% начисление. Кнопка ниже однократно прогоняет всю
  // историю через тот же applyReferralCashReward (идемпотентно).
  const [backfilling, setBackfilling] = useState(false);
  const [backfillToast, setBackfillToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Дебаунс поиска: ждём 250 ms простоя перед запросом — иначе на каждое
  // нажатие летел бы network. Достаточно для админ-листа из сотен записей.
  useEffect(() => {
    if (!tgId) return;
    let cancelled = false;
    const tid = setTimeout(() => {
      (async () => {
        setLoading(true);
        setError(null);
        try {
          const url = new URL('/api/admin/withdrawals/balances', window.location.origin);
          url.searchParams.set('telegramId', String(tgId));
          if (query.trim()) url.searchParams.set('q', query.trim());
          const res = await fetch(url.toString());
          const data = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (!res.ok || !data?.ok) {
            setError(data?.error || `HTTP ${res.status}`);
            return;
          }
          setItems(Array.isArray(data.items) ? data.items : []);
          setTotals(data.totals ?? null);
        } catch (e: any) {
          if (!cancelled) setError(e?.message || 'Network error');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 250);
    return () => { cancelled = true; clearTimeout(tid); };
  }, [tgId, query, reloadKey]);

  const runBackfill = async (dryRun: boolean) => {
    if (!tgId || backfilling) return;
    if (!dryRun) {
      const ok = window.confirm(lang === 'ru'
        ? 'Запустить бэкфилл реф-кошельков? Все SBP-платежи в истории будут перепроверены и недостающие 10% начислены инвайтерам. Идемпотентно — повторный запуск ничего не сломает.'
        : 'Run referral wallet backfill? All historical SBP payments will be re-checked and missing 10% credited to inviters. Idempotent — re-running is safe.');
      if (!ok) return;
    }
    setBackfilling(true);
    setBackfillToast(null);
    try {
      const res = await fetch('/api/admin/db/backfill-referral-cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, dryRun }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setBackfillToast(data?.error || `HTTP ${res.status}`);
        setTimeout(() => setBackfillToast(null), 5000);
        return;
      }
      const verb = dryRun
        ? (lang === 'ru' ? 'Будет начислено' : 'Would credit')
        : (lang === 'ru' ? 'Начислено' : 'Credited');
      setBackfillToast(
        `${verb}: ${data.credited} ${lang === 'ru' ? 'платежей' : 'payments'} · ${data.totalAmountRub.toFixed(2)} ₽ · ${lang === 'ru' ? 'просканировано' : 'scanned'} ${data.scanned}`
      );
      setTimeout(() => setBackfillToast(null), 7000);
      if (!dryRun && data.credited > 0) {
        // Перезагружаем список чтобы увидеть новые балансы.
        setReloadKey((k) => k + 1);
      }
    } catch (e: any) {
      setBackfillToast(e?.message || 'Network error');
      setTimeout(() => setBackfillToast(null), 5000);
    } finally {
      setBackfilling(false);
    }
  };

  const fmtRub = (n: number) => n.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const fmtAge = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const diffH = Math.floor((Date.now() - d.getTime()) / 3600_000);
    if (diffH < 1) return lang === 'ru' ? 'только что' : 'just now';
    if (diffH < 24) return lang === 'ru' ? `${diffH} ч назад` : `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return lang === 'ru' ? `${diffD} дн назад` : `${diffD}d ago`;
    return d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US');
  };

  return (
    <div className="min-w-0">
      {/* Totals strip — три ключевых метрики наверху. */}
      {totals && (
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <div className="p-2 rounded-lg border border-white/[0.06] bg-red-500/[0.05] text-center">
            <p className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">
              {lang === 'ru' ? 'Юзеров с балансом' : 'Users with balance'}
            </p>
            <p className="text-red-300 font-bold text-[15px] tabular-nums">{totals.usersWithBalance}</p>
          </div>
          <div className="p-2 rounded-lg border border-white/[0.06] bg-orange-500/[0.05] text-center">
            <p className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">
              {lang === 'ru' ? 'Сейчас на кошельках' : 'Wallets total'}
            </p>
            <p className="text-orange-300 font-bold text-[15px] tabular-nums">{fmtRub(totals.totalBalanceRub)} ₽</p>
          </div>
          <div className="p-2 rounded-lg border border-white/[0.06] bg-white/[0.04] text-center">
            <p className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">
              {lang === 'ru' ? 'Всего начислено' : 'Lifetime accrued'}
            </p>
            <p className="text-zinc-200 font-bold text-[15px] tabular-nums">{fmtRub(totals.lifetimeAccruedRub)} ₽</p>
          </div>
        </div>
      )}

      {/* 2026-05-23: backfill controls — для админа критичный one-shot
          инструмент. Dry-run сначала показывает СКОЛЬКО денег прилетит,
          реальный run пишет в БД. Идемпотентно — UNIQUE(payment_id). */}
      <div className="mb-3 p-3 rounded-xl bg-amber-500/[0.05] border border-amber-500/20">
        <div className="flex items-start gap-2 mb-2">
          <AlertCircle size={13} className="text-amber-300 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-amber-200 text-[12px] font-bold mb-0.5">
              {lang === 'ru' ? 'Бэкфилл исторических SBP-платежей' : 'Backfill historical SBP payments'}
            </p>
            <p className="text-amber-200/70 text-[10.5px] leading-relaxed">
              {lang === 'ru'
                ? 'Cash-кошельки появились 2026-05-22. SBP-платежи до этой даты не получили 10% — кнопка прогоняет всю историю и начисляет недостающее. Идемпотентно (UNIQUE по payment_id), запускать сколько угодно раз.'
                : 'Cash wallets shipped 2026-05-22. SBP payments before that didn\'t receive the 10%. This walks the full history and credits the missing share. Idempotent (UNIQUE on payment_id), safe to re-run.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => void runBackfill(true)}
            disabled={backfilling}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.10] hover:bg-white/[0.08] text-zinc-200 text-[11px] font-semibold transition-colors active:scale-95 disabled:opacity-50"
          >
            {backfilling ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} strokeWidth={2.25} />}
            {lang === 'ru' ? 'Dry run' : 'Dry run'}
          </button>
          <button
            onClick={() => void runBackfill(false)}
            disabled={backfilling}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[11px] font-bold hover:bg-amber-500/30 active:scale-95 disabled:opacity-50 transition-colors"
          >
            {backfilling ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={11} strokeWidth={2.25} />}
            {lang === 'ru' ? 'Запустить бэкфилл' : 'Run backfill'}
          </button>
        </div>
        {backfillToast && (
          <div className="mt-2 px-2 py-1.5 rounded-lg bg-black/30 border border-white/[0.08] text-amber-200 text-[11px] font-mono break-words">
            {backfillToast}
          </div>
        )}
      </div>

      <div className="mb-3 relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={lang === 'ru' ? 'Поиск по имени / username / email / tg-id' : 'Search by name / username / email / tg-id'}
          className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-[13px] focus:border-red-500/40 focus:outline-none placeholder:text-zinc-600"
        />
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-[12px] flex items-start gap-2 mb-3 min-w-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span className="leading-relaxed break-words min-w-0">{error}</span>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="py-10 flex items-center justify-center">
          <Loader2 size={18} className="text-zinc-500 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-zinc-500 text-[12px]">
          {query
            ? (lang === 'ru' ? 'По запросу ничего не найдено' : 'No matches')
            : (lang === 'ru' ? 'Нет юзеров с ненулевым балансом' : 'No users with non-zero balance')}
        </div>
      ) : (
        /* Карточная сетка для ПК (2-3 колонки) и одна колонка на мобайле.
           На ПК админка теперь широкая (1280 px), 3 колонки выглядят
           значительно компактнее чем длинный список 1×N. */
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => (
            <div
              key={it.id}
              className="p-3 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:border-white/[0.15] transition-colors min-w-0"
            >
              <div className="flex items-start gap-2 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500/15 to-orange-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                  <UserIcon size={14} strokeWidth={2} className="text-red-300/80" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white font-semibold text-[13px] truncate">{it.displayName}</p>
                  <p className="text-zinc-500 text-[10.5px] truncate font-mono">
                    {it.username ? `@${it.username}` : null}
                    {it.username && it.telegramId ? ' · ' : ''}
                    {it.telegramId ? `tg ${it.telegramId}` : null}
                    {!it.username && !it.telegramId && it.email ? it.email : null}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-red-300 font-bold text-[15px] tabular-nums">{fmtRub(it.balanceRub)} ₽</p>
                  <p className="text-zinc-500 text-[9.5px]">{lang === 'ru' ? 'на балансе' : 'on balance'}</p>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-white/[0.05] grid grid-cols-3 gap-1 text-center">
                <div>
                  <p className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">
                    {lang === 'ru' ? 'Всего' : 'Lifetime'}
                  </p>
                  <p className="text-zinc-200 text-[11px] font-semibold tabular-nums">{fmtRub(it.lifetimeEarnedRub)}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">
                    {lang === 'ru' ? 'Выведено' : 'Paid'}
                  </p>
                  <p className="text-emerald-300/90 text-[11px] font-semibold tabular-nums">{fmtRub(it.paidOutRub)}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-[9px] uppercase tracking-wider mb-0.5">
                    {lang === 'ru' ? 'В заявках' : 'Open req'}
                  </p>
                  <p className={`text-[11px] font-semibold tabular-nums ${it.openRequestRub > 0 ? 'text-amber-300' : 'text-zinc-500'}`}>
                    {fmtRub(it.openRequestRub)}
                  </p>
                </div>
              </div>
              <p className="text-zinc-500 text-[10px] mt-2">
                {lang === 'ru' ? 'Последнее начисление: ' : 'Last accrual: '}
                <span className="text-zinc-300">{fmtAge(it.lastAccrualAt)}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
