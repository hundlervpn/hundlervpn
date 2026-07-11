'use client';

import Link from 'next/link';
import { CreditCard, User, Settings, Gift, FileText, Lock, Home, Crown, MessageCircle, Package } from 'lucide-react';
import { haptic } from '@/lib/haptic';
import ReferralModal from '@/components/ReferralModal';
import type { Tab } from '@/app/_shared/constants';
import type { AuthMode } from '@/app/_shared/types';

export default function DesktopSidebar({ t, activeTab, navigate, authMode, unreadSupportCount, onOpenReferral, isAdmin }: { t: any; activeTab: Tab; navigate: (tab: Tab) => void; authMode?: AuthMode; unreadSupportCount?: number; onOpenReferral?: () => void; isAdmin?: boolean }) {
  // 2026-05-13: sidebar items get a leading icon (lucide). The icon
  // colour follows the active state — white when active, zinc-400 idle
  // — so the colour shifts match the existing pill background gradient.
  // `menuItem()` returns the inner JSX so we keep one source of truth
  // for icon + label spacing across all rows.
  const menuBtnClass = (isActive: boolean) => `group w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${isActive ? 'bg-gradient-to-r from-white/20 to-white/5 text-white border border-white/30 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]' : 'text-zinc-300 hover:bg-white/5 hover:border-white/10 border border-transparent'}`;
  const iconCls = (isActive: boolean) => `shrink-0 ${isActive ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`;
  // Same minimal pill style as the menu items above, just without the
  // active-tab gradient — used for actions that don't correspond to a
  // routed tab (e.g. referral modal opener).
  const linkBtnClass = 'group flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-white/5 hover:text-white transition-colors active:scale-[0.98]';
  const supportUnread = unreadSupportCount ?? 0;

  return (
    /* DesktopSidebar 2026-05-13:
       - Pinned to the LEFT edge of the viewport (no margin / no rounded
         corners on the outer border — flush with the window).
       - `lg:sticky lg:top-0 lg:h-screen` keeps it visible while the main
         content scrolls. `lg:overflow-y-auto` so a tall menu can scroll
         independently if it ever exceeds the viewport.
       - Width 256 px (`lg:w-64`) — feels like the Volna VPN PC layout,
         but more compact than the previous 288 px so the main content
         gets more room. */
    <aside className="hidden lg:sticky lg:top-0 lg:h-screen lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-white/10 lg:bg-gradient-to-b lg:from-[#0d0d0d] lg:via-[#080808] lg:to-[#020202] lg:p-4 lg:backdrop-blur-xl">
      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="text-zinc-400 text-[11px] uppercase tracking-[0.16em] mb-2.5">Главная</p>
        <div className="space-y-1">
          <button onClick={() => navigate('home')} className={menuBtnClass(activeTab === 'home')}>
            <span className="inline-flex items-center gap-2.5">
              <Home size={16} strokeWidth={1.75} className={iconCls(activeTab === 'home')} />
              {t.navVpn}
            </span>
          </button>
          <button onClick={() => navigate('support')} className={menuBtnClass(activeTab === 'support')}>
            <span className="inline-flex items-center gap-2.5">
              <MessageCircle size={16} strokeWidth={1.75} className={iconCls(activeTab === 'support')} />
              {t.navSupport}
              {supportUnread > 0 && (
                <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.6)]">
                  {supportUnread > 99 ? '99+' : supportUnread}
                </span>
              )}
            </span>
          </button>
          <button onClick={() => navigate('payment')} className={menuBtnClass(activeTab === 'payment')}>
            <span className="inline-flex items-center gap-2.5">
              <Crown size={16} strokeWidth={1.75} className={iconCls(activeTab === 'payment')} />
              {t.navPremium}
            </span>
          </button>
          <button onClick={() => navigate('profile')} className={menuBtnClass(activeTab === 'profile')}>
            <span className="inline-flex items-center gap-2.5">
              <User size={16} strokeWidth={1.75} className={iconCls(activeTab === 'profile')} />
              {t.navProfile}
            </span>
          </button>
          <button onClick={() => navigate('account')} className={menuBtnClass(activeTab === 'account')}>
            <span className="inline-flex items-center gap-2.5">
              <Settings size={16} strokeWidth={1.75} className={iconCls(activeTab === 'account')} />
              {t.accountTitle}
            </span>
          </button>
          {/* Boxes — открыто всем (2026-05-22, см. mobile bottom-nav). */}
          <button onClick={() => navigate('boxes')} className={menuBtnClass(activeTab === 'boxes')}>
            <span className="inline-flex items-center gap-2.5">
              <Package size={16} strokeWidth={1.75} className={iconCls(activeTab === 'boxes')} />
              {t.navBoxes}
            </span>
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.16em] mb-2.5">Ссылки</p>
        <div className="space-y-1 text-sm text-zinc-300">
          {/* next/link keeps the navigation INSIDE the Telegram mini-app
              webview. `target="_blank"` / `window.open` would punt the
              user to the system browser, which is jarring inside TMA. */}
          <Link href="/privacy" className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/5 hover:text-white transition-colors">
            <Lock size={16} strokeWidth={1.75} className="text-zinc-400 shrink-0" />
            <span>Политика конфиденциальности</span>
          </Link>
          <Link href="/terms" className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/5 hover:text-white transition-colors">
            <FileText size={16} strokeWidth={1.75} className="text-zinc-400 shrink-0" />
            <span>Пользовательское соглашение</span>
          </Link>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.16em] mb-2.5">Программы</p>
        <div className="space-y-1">
          {/* Opens the shared <ReferralModal /> — same instance the home
              CTA and the profile menu button trigger. Disabled if no
              opener is wired (e.g. unit-test render). */}
          <button
            type="button"
            onClick={() => { haptic('light'); onOpenReferral?.(); }}
            disabled={!onOpenReferral}
            className={`${linkBtnClass} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Gift size={16} strokeWidth={1.75} className="text-zinc-400 group-hover:text-zinc-200 shrink-0" />
            <span>{t.referral}</span>
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-zinc-500 text-[11px] uppercase tracking-[0.16em] mb-2.5">Аккаунт</p>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => { haptic('light'); navigate('payments'); }}
            className={linkBtnClass}
          >
            <CreditCard size={16} strokeWidth={1.75} className="text-zinc-400 group-hover:text-zinc-200 shrink-0" />
            <span>{t.payments}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
