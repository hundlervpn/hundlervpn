'use client';

import { Crown } from 'lucide-react';
import { motion } from 'motion/react';

export default function BoxChestImage({ kind, stage }: { kind: 'daily' | 'super'; stage: 'idle' | 'shaking' | 'flashing' }) {
  const isSuper = kind === 'super';
  const lidOpen = stage === 'flashing';

  // Filter that turns the red-neon source into gold/amber for SUPER.
  // Tested values: 28deg hue-rotate slides red (#ef4444 ≈ 0°) toward
  // orange (#f97316 ≈ 25°) without crossing into the green spectrum;
  // saturate/brightness tweaks compensate for the slight desaturation
  // that hue-rotate causes on rich reds.
  const tintFilter = isSuper
    ? 'hue-rotate(28deg) saturate(1.15) brightness(1.06)'
    : 'none';

  // v4.4 (2026-05-23): убрали `drop-shadow` от PNG бокса. На iOS Safari
  // он рендерился как полупрозрачный ПРЯМОУГОЛЬНИК позади сундука (вместо
  // мягкой radial-тени по силуэту), потому что PNG имеет тонкую alpha-
  // полосу по краям из-за антиалиасинга при экспорте. Получался квадрат
  // сзади бокса — юзер жаловался. Подсветку даёт сама hero-card (twin
  // glows top-right/bottom-left), отдельная тень от PNG лишняя.

  return (
    <div
      className="relative w-[180px] h-[180px] flex items-center justify-center"
      style={tintFilter !== 'none' ? { filter: tintFilter } : undefined}
      aria-hidden="true"
    >
      {/* Closed PNG — base layer. WebP source preferred, PNG fallback
          for any WebView without WebP support. Sized intrinsically via
          width/height attrs (browsers can lay out before bytes load).
          loading="eager" because this is above the fold and the user
          stares at it for the entire box-opens-screen lifetime. */}
      <picture>
        <source srcSet="/boxes/box-closed.webp" type="image/webp" />
        <img
          src="/boxes/box-closed.png"
          alt=""
          width={180}
          height={180}
          loading="eager"
          decoding="async"
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain select-none transition-opacity duration-[240ms] ease-out"
          style={{ opacity: lidOpen ? 0 : 1 }}
        />
      </picture>
      {/* Open PNG — same slot, opposite opacity. Keeps both PNGs in the
          DOM during reveal so the crossfade is smooth (no popping). */}
      <picture>
        <source srcSet="/boxes/box-open.webp" type="image/webp" />
        <img
          src="/boxes/box-open.png"
          alt=""
          width={180}
          height={180}
          loading="eager"
          decoding="async"
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain select-none transition-opacity duration-[240ms] ease-out"
          style={{ opacity: lidOpen ? 1 : 0 }}
        />
      </picture>

      {/* v4.4 (2026-05-23): пульсирующая точка под сундуком удалена.
          Юзер жаловался что на iPhone позади неё рендерится тёмный
          квадратик (артефакт WebKit SVG rasterizer + наш drop-shadow
          фильтр от родителя). Точка ничего не добавляла к UX — просто
          лишняя анимация в idle. Бокс и без неё хорошо "дышит" через
          motion.div boxAnimateProps[stage].idle. */}

      {/* SUPER-only flourishes — crown, sparkles, bottom shimmer star.
          Renders on top of the painted box; crown fades to 0.5 opacity
          when the lid is open so it doesn't fight the open-box artwork. */}
      {isSuper && (
        <svg
          width="180"
          height="180"
          viewBox="-90 -90 180 180"
          className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
        >
          {/* Crown — sits above the chest. Gold-on-amber with a soft
              glow. The 7-vertex polyline draws a 3-tooth crown with
              jewel dots in the middle. */}
          <g
            transform="translate(0, -68)"
            opacity={lidOpen ? 0.45 : 0.95}
            style={{
              filter: 'drop-shadow(0 0 5px #f59e0b)',
              transition: 'opacity 240ms ease-out',
            }}
          >
            <path
              d="M -16 6 L -11 -8 L -5 2 L 0 -12 L 5 2 L 11 -8 L 16 6 Z"
              fill="#fbbf24"
              stroke="#fed7aa"
              strokeWidth="0.7"
              strokeLinejoin="round"
            />
            <circle cx="-11" cy="-8" r="1.5" fill="#fff" opacity="0.9" />
            <circle cx="0"   cy="-12" r="1.7" fill="#fff" opacity="0.95" />
            <circle cx="11"  cy="-8" r="1.5" fill="#fff" opacity="0.9" />
          </g>

          {/* 6 sparkle motes orbiting the chest, staggered timing. */}
          {stage === 'idle' && (
            <g opacity="0.85">
              <circle cx="-72" cy="-32" r="1.6" fill="#fbbf24">
                <animate attributeName="opacity" values="0.2;1;0.2" dur="1.8s" repeatCount="indefinite" />
              </circle>
              <circle cx="72"  cy="-38" r="1.4" fill="#fbbf24">
                <animate attributeName="opacity" values="1;0.2;1"   dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="62"  cy="48"  r="1.2" fill="#fbbf24">
                <animate attributeName="opacity" values="0.3;1;0.3" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx="-66" cy="46"  r="1.3" fill="#fbbf24">
                <animate attributeName="opacity" values="0.3;1;0.3" dur="2.0s" begin="0.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="-38" cy="-66" r="1.1" fill="#fbbf24">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="1.4s" begin="0.7s" repeatCount="indefinite" />
              </circle>
              <circle cx="40"  cy="-66" r="1.1" fill="#fbbf24">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="1.4s" begin="1.1s" repeatCount="indefinite" />
              </circle>
            </g>
          )}

          {/* Bottom 4-point twinkle on the shadow plane. */}
          <g transform="translate(0, 76)" opacity="0.65">
            <path
              d="M 0 -5 L 1.2 -1.2 L 5 0 L 1.2 1.2 L 0 5 L -1.2 1.2 L -5 0 L -1.2 -1.2 Z"
              fill="#fed7aa"
            >
              <animate attributeName="opacity" values="0.3;0.95;0.3" dur="3s" repeatCount="indefinite" />
            </path>
          </g>
        </svg>
      )}
    </div>
  );
}
