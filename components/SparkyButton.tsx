'use client';

import {
  ButtonHTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useCallback,
  useState,
} from 'react';
import { motion } from 'motion/react';

/**
 * SparkyButton — drop-in replacement for <button> that fires a short
 * burst of sparks at the click point.
 *
 * UX intent:
 *   - Radial burst (sparks fly outward in all directions), NOT a ripple.
 *     The brief user feedback was «не волны как от капли воды, а искры
 *     небольшие кругом».
 *   - Palette: pure white with a soft white glow — reads as "spark"
 *     against the dark card background without competing with the red
 *     brand accents that signal selection state.
 *   - Duration ~550ms — long enough to feel, short enough not to
 *     interfere with rapid plan switching.
 *   - Zero-cost when idle: particles are absolutely positioned inside
 *     the button and removed from state when their animation ends. No
 *     tsparticles engine (overkill for a one-shot burst).
 *
 * Constraints worth remembering:
 *   - The host <button> usually has `overflow-hidden` (our plan cards
 *     do, for the "Выгодно" badge). That clips sparks at the edges,
 *     which is actually a desired effect here — keeps the burst
 *     contained inside the card instead of bleeding onto neighbours.
 *   - We do NOT replace the existing haptic/state logic — the caller's
 *     onClick still fires exactly once, synchronously, before the
 *     visual burst starts.
 */

type Burst = { id: number; x: number; y: number };

type SparkyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  /** Number of sparks per burst. Default 14 — looks dense but stays cheap. */
  sparkCount?: number;
  /** Base distance (px) sparks travel from the click point. */
  sparkDistance?: number;
};

export default function SparkyButton({
  children,
  onClick,
  sparkCount = 14,
  sparkDistance = 28,
  className,
  style,
  ...rest
}: SparkyButtonProps) {
  const [bursts, setBursts] = useState<Burst[]>([]);

  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      // Capture the click point in the button's local coordinate space
      // BEFORE React re-renders or the synthetic event is pooled.
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setBursts((prev) => [
        ...prev,
        { id: performance.now() + Math.random(), x, y },
      ]);
      onClick?.(e);
    },
    [onClick]
  );

  const removeBurst = useCallback((id: number) => {
    setBursts((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return (
    <button
      {...rest}
      onClick={handleClick}
      className={className}
      style={style}
    >
      {children}
      {bursts.map((b) => (
        <SparkBurst
          key={b.id}
          x={b.x}
          y={b.y}
          count={sparkCount}
          distance={sparkDistance}
          onDone={() => removeBurst(b.id)}
        />
      ))}
    </button>
  );
}

/* -------------------------------------------------------------------- */

/**
 * One radial explosion of N sparks centred at (x, y).
 *
 * Geometry:
 *   - Each spark gets an angle = base_i + jitter, where base_i evenly
 *     spreads sparks around the full circle. Pure even distribution
 *     looks mechanical — the jitter randomises each instance.
 *   - Distance is drawn from [distance * 0.6 … distance * 1.4] so the
 *     burst has a bit of depth.
 *   - Sparks are 2–4 px round dots with a warm glow (box-shadow). Mixed
 *     colour palette (#ef4444, #f97316, #fbbf24, #ffffff) keeps the
 *     effect from looking flat.
 *   - One spark (index 0) reports animation completion so the parent
 *     can drop this burst from state — no need to track 14 events.
 */
function SparkBurst({
  x,
  y,
  count,
  distance,
  onDone,
}: {
  x: number;
  y: number;
  count: number;
  distance: number;
  onDone: () => void;
}) {
  // Pure-white sparks. Picked over a multi-colour palette per user
  // request — the brand-red accents already saturate the card on
  // selection, so coloured sparks blended in. White on dark reads
  // unambiguously as "spark / flash".
  const sparkColor = '#ffffff';

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: x,
        top: y,
        width: 0,
        height: 0,
      }}
    >
      {Array.from({ length: count }).map((_, i) => {
        const baseAngle = (i / count) * Math.PI * 2;
        const jitter = (Math.random() - 0.5) * 0.6; // ±0.3 rad
        const angle = baseAngle + jitter;
        const d = distance * (0.6 + Math.random() * 0.8);
        const dx = Math.cos(angle) * d;
        const dy = Math.sin(angle) * d;
        const size = 2 + Math.random() * 2; // 2–4 px
        return (
          <motion.span
            key={i}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: dx, y: dy, opacity: 0, scale: 0.2 }}
            transition={{
              duration: 0.45 + Math.random() * 0.2,
              ease: [0.2, 0.7, 0.3, 1],
            }}
            onAnimationComplete={i === 0 ? onDone : undefined}
            className="absolute block rounded-full"
            style={{
              width: size,
              height: size,
              backgroundColor: sparkColor,
              // Two-layer white glow: a tight 2px halo so the dot keeps
              // a defined edge, plus a softer 8px bloom that gives the
              // burst its "flash" feel against the dark background.
              boxShadow: `0 0 8px ${sparkColor}, 0 0 2px ${sparkColor}`,
              marginLeft: -size / 2,
              marginTop: -size / 2,
            }}
          />
        );
      })}
    </span>
  );
}
