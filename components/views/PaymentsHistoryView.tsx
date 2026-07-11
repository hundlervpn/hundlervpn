'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { pageVariants } from '@/app/_shared/constants';
import type { Tab } from '@/app/_shared/constants';

export default function PaymentsHistoryView({ t, direction, tgUser, navigate, lang }: { t: any; direction: number; tgUser: { id: number; name: string; photo: string; username?: string } | null; navigate: (tab: Tab) => void; lang: 'ru' | 'en' }) {
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
      <div className="w-full max-w-xs lg:max-w-[900px]">
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
              {payments.map((payment) => {
                // Status -> color + i18n label.
                // Semantic colors are an explicit exception to the dark+white+red
                // palette: success/error/warning need to be instantly readable
                // and the green/red/yellow language is universal for payments.
                const s = (payment.status || '').toLowerCase();
                const isPaid = s === 'paid' || s === 'success' || s === 'completed';
                const isFailed = s === 'failed' || s === 'cancelled' || s === 'canceled' || s === 'expired' || s === 'error';
                const isPending = s === 'pending' || s === 'awaiting_payment' || s === 'awaiting' || s === 'processing' || s === 'created';
                const cls = isPaid
                  ? 'bg-green-500/15 text-green-400 border-green-500/25'
                  : isFailed
                    ? 'bg-red-500/15 text-red-400 border-red-500/25'
                    : isPending
                      ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25'
                      : 'bg-white/[0.06] text-zinc-400 border-white/[0.08]';
                const label = isPaid
                  ? (lang === 'ru' ? 'Оплачено' : 'Paid')
                  : isFailed
                    ? (lang === 'ru' ? 'Отклонено' : 'Failed')
                    : isPending
                      ? (lang === 'ru' ? 'В обработке' : 'Pending')
                      : payment.status;
                return (
                  <div key={payment.id} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-white font-medium text-sm">{Number(payment.amount)} {payment.currency}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">{payment.provider}</div>
                    <div className="text-[10px] text-zinc-500 mt-1 flex items-center gap-1">
                      <Calendar size={11} />
                      {new Date(payment.paid_at || payment.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
