'use client';

import { ReactNode, useCallback } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import ParticlesBackground from './ParticlesBackground';
import { useTelegramBack } from '@/lib/use-telegram-back-button';

/**
 * Shared chrome for `/privacy` and `/terms`. Matches the Hundler dark
 * brand (black bg, red accents, Syncopate display + Inter body) so the
 * legal pages don't feel like a 1990s footer dump.
 *
 * Renders:
 *   • full-bleed particle backdrop (same as the landing page);
 *   • sticky-ish header with a "Назад" pill button on mobile and the
 *     tiger logo + brand title on desktop;
 *   • centred narrow column for body copy (max-w-2xl) so paragraphs
 *     don't get unreadably wide on big monitors;
 *   • footer line with the support handle.
 */
export default function LegalLayout({
  title,
  subtitle,
  updatedAt,
  children,
}: {
  title: string;
  subtitle?: string;
  updatedAt?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  // Use stable callback so the hook's effect cleanup doesn't keep
  // re-subscribing on every render.
  const handleBack = useCallback(() => router.back(), [router]);
  // Wires up Telegram's native `BackButton` (header chevron) when the
  // page is opened inside a Mini App. Returns true so we can hide our
  // own in-page button — Telegram UX guidelines say not to duplicate.
  const inTma = useTelegramBack(handleBack);

  return (
    <div className="relative min-h-screen bg-black text-white overflow-x-hidden">
      <ParticlesBackground />

      {/* Subtle red glow at the top, echoes the landing hero */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.18),transparent_60%)]" />

      <div className="relative z-10 max-w-2xl mx-auto px-4 lg:px-6 pt-6 pb-16">
        {/* Top bar — when running inside Telegram the system BackButton
            takes over, so we drop our HTML "Назад" and right-align the
            brand mark to keep the header from looking lopsided. In a
            regular browser the in-page button is the only way back, so
            it stays. */}
        <div className={`flex items-center mb-8 lg:mb-10 ${inTma ? 'justify-end' : 'justify-between'}`}>
          {!inTma && (
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white border border-white/10 hover:border-white/25 bg-white/[0.02] rounded-xl px-3 py-2 text-xs font-medium transition-colors"
            >
              <ChevronLeft size={14} />
              Назад
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="relative w-7 h-7">
              <Image src="/tiger.png" alt="Hundler VPN" fill sizes="28px" className="object-contain" />
            </div>
            <span className="font-bold text-sm tracking-wide" style={{ fontFamily: 'Syncopate, sans-serif' }}>
              HUNDLER
            </span>
          </div>
        </div>

        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <p className="text-red-400 text-[10px] font-medium uppercase tracking-[0.24em] mb-2">
            Hundler VPN
          </p>
          <h1
            className="text-3xl lg:text-4xl font-bold leading-tight mb-2"
            style={{ fontFamily: 'Syncopate, sans-serif' }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-zinc-400 text-sm leading-relaxed mb-1">{subtitle}</p>
          )}
          {updatedAt && (
            <p className="text-zinc-600 text-xs mt-2">Последнее обновление: {updatedAt}</p>
          )}
        </motion.div>

        <div className="h-px w-full bg-gradient-to-r from-red-500/40 via-red-500/10 to-transparent my-6 lg:my-8" />

        {/* Body */}
        <motion.article
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="legal-prose space-y-7 text-zinc-300 text-sm lg:text-[15px] leading-relaxed"
        >
          {children}
        </motion.article>

        <div className="h-px w-full bg-white/5 my-10" />

        <p className="text-zinc-500 text-xs leading-relaxed">
          Возникли вопросы? Свяжитесь с поддержкой:{' '}
          <a
            href="https://t.me/hundlervpn"
            target="_blank"
            rel="noopener noreferrer"
            className="text-red-400 hover:text-red-300 underline underline-offset-2"
          >
            @hundlervpn
          </a>
        </p>
      </div>

      <style jsx global>{`
        .legal-prose h2 {
          color: #ffffff;
          font-size: 1rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          margin-bottom: 0.5rem;
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }
        .legal-prose h2 .legal-num {
          color: #ef4444;
          font-family: 'Syncopate', sans-serif;
          font-size: 0.75rem;
          letter-spacing: 0.12em;
          font-weight: 700;
        }
        .legal-prose p {
          margin-bottom: 0.5rem;
        }
        .legal-prose ul {
          list-style: none;
          padding: 0;
          margin: 0.5rem 0;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .legal-prose ul li {
          position: relative;
          padding-left: 1rem;
          color: #d4d4d8;
        }
        .legal-prose ul li::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0.6em;
          width: 0.35rem;
          height: 0.35rem;
          border-radius: 999px;
          background: #ef4444;
          opacity: 0.7;
        }
        .legal-prose .clause {
          display: block;
        }
        .legal-prose .clause-num {
          color: #a3a3a3;
          font-variant-numeric: tabular-nums;
          margin-right: 0.35rem;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
