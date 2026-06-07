'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

/**
 * Brand-accented "Matrix rain" — red 0/1 streams falling top-to-bottom
 * with a glow on the leading character. Used as the atmospheric backdrop
 * for the VPN setup wizard ("more premium feel" — user request 2026-05-13).
 *
 * Architecture:
 *   - One <canvas> sized to its parent (absolute inset-0). DPI-scaled
 *     for crisp glyphs on retina without eating pixel budget on plain
 *     1× displays.
 *   - Imperative `burst(x, y)` handle so the host component can fire a
 *     localised cluster of fast, glowing streams when the user taps
 *     anywhere inside the wizard. Hot drops fade out in ~1.2 s; ambient
 *     drops live ~4 s.
 *   - rAF-driven loop, no React re-renders during the animation. The
 *     entire effect costs one canvas + one rAF subscription regardless
 *     of how many drops are on screen.
 *   - Drop budget capped (`MAX_DROPS`) so heavy-tap sessions don't
 *     pile up GC pressure on low-end Android.
 *
 * NOT used for general decoration — the rain has visual weight and
 * shouldn't compete with the home screen / profile / payment views.
 * Setup is a focused, infrequent flow where the extra pizzazz reads as
 * "techy/cyberpunk" instead of "noisy".
 */

export type MatrixRainHandle = {
  /** Spawn a localised burst of hot drops near (x, y) (parent-local px). */
  burst: (x: number, y: number) => void;
};

type Drop = {
  x: number;
  /** y-coordinate of the leading glyph (the brightest one). */
  yHead: number;
  speed: number;
  /** Number of trailing characters behind the head. */
  length: number;
  /** Master alpha multiplier; hot drops fade with age. */
  alpha: number;
  hot: boolean;
  born: number;
};

const CHARS = '01';
const LINE_HEIGHT = 14;
const FONT = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
const MAX_DROPS = 140;

/**
 * Density = ambient drops spawned per frame. Higher = thicker rain.
 * 0.18 looks dense without being distracting on a 360×640 viewport.
 */
type MatrixRainProps = {
  density?: number;
  className?: string;
};

const MatrixRain = forwardRef<MatrixRainHandle, MatrixRainProps>(function MatrixRain(
  { density = 0.18, className },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dropsRef = useRef<Drop[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });

  useImperativeHandle(
    ref,
    () => ({
      burst(x: number, y: number) {
        // Spawn ~16 hot drops in a small radius around the tap point.
        // Hot = brighter red + glow, faster, shorter lifetime.
        const count = 16;
        const now = performance.now();
        for (let i = 0; i < count; i++) {
          const offsetX = (Math.random() - 0.5) * 90;
          const offsetY = (Math.random() - 0.5) * 30;
          dropsRef.current.push({
            x: x + offsetX,
            yHead: y + offsetY,
            speed: 2.5 + Math.random() * 3.5,
            length: 8 + Math.floor(Math.random() * 10),
            alpha: 1,
            hot: true,
            born: now,
          });
        }
        // Trim if we overflow the budget — drop oldest ambient first.
        if (dropsRef.current.length > MAX_DROPS) {
          dropsRef.current.sort((a, b) => {
            // Hot drops always survive a trim; among non-hot, oldest dies.
            if (a.hot && !b.hot) return 1;
            if (!a.hot && b.hot) return -1;
            return b.born - a.born;
          });
          dropsRef.current.length = MAX_DROPS;
        }
      },
    }),
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Skip zero-size measurements — happens on the first paint
      // before flexbox has laid out the modal. The follow-up rAF
      // (or the ResizeObserver) will retry once real dimensions land.
      if (rect.width < 2 || rect.height < 2) return;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w: rect.width, h: rect.height };
    };
    // Defer first measurement to the next frame so the parent has
    // finished its first layout pass (the AnimatePresence transition
    // mounts us alongside the slide-in animation — boundingClientRect
    // returns the *final* size by frame 2).
    requestAnimationFrame(resize);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    window.addEventListener('resize', resize);

    let raf = 0;
    const loop = (t: number) => {
      const { w, h } = sizeRef.current;
      // Clear instead of fading-fill: a full clear per frame avoids
      // accumulating darkness over the parent gradient. The rain itself
      // creates the "trail" via the per-drop char column rendering.
      ctx.clearRect(0, 0, w, h);

      // Spawn ambient drops up to budget. Density scales with width so
      // a 1280px desktop modal gets proportionally more streams than a
      // 360px phone (otherwise the rain feels sparse on desktop and
      // claustrophobic on mobile).
      const widthFactor = Math.max(0.5, Math.min(2, w / 360));
      if (
        dropsRef.current.length < MAX_DROPS &&
        Math.random() < density * widthFactor
      ) {
        dropsRef.current.push({
          x: Math.random() * w,
          yHead: -LINE_HEIGHT * (2 + Math.random() * 3),
          speed: 0.6 + Math.random() * 1.4,
          length: 6 + Math.floor(Math.random() * 10),
          // 2026-05-13: alpha lowered (was 0.5–0.85) — at the previous
          // intensity the rain was reading as "main content" and made
          // CTA buttons hard to see. We're back to a subtle backdrop
          // that frames the wizard rather than competing with it.
          alpha: 0.18 + Math.random() * 0.18,
          hot: false,
          born: t,
        });
      }

      ctx.font = FONT;
      ctx.textBaseline = 'top';

      const survivors: Drop[] = [];
      for (const d of dropsRef.current) {
        d.yHead += d.speed;

        // Hot drops fade with age; ambient stays at constant alpha.
        let masterAlpha = d.alpha;
        if (d.hot) {
          const age = t - d.born;
          masterAlpha = d.alpha * Math.max(0, 1 - age / 1200);
        }
        if (masterAlpha < 0.02) continue;
        // Off-screen below + tail clear → dead.
        if (d.yHead - d.length * LINE_HEIGHT > h) continue;

        const baseRgb = d.hot ? '255, 90, 90' : '239, 68, 68';
        for (let i = 0; i < d.length; i++) {
          const y = d.yHead - i * LINE_HEIGHT;
          if (y < -LINE_HEIGHT || y > h + LINE_HEIGHT) continue;
          // Linear fade along the tail. Head (i=0) is fully bright.
          const tailFade = 1 - i / d.length;
          const a = masterAlpha * tailFade;
          if (a < 0.02) continue;
          const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
          // 2026-05-13: ambient drops no longer get a glow — the small
          // shadowBlur was reading as "the page is on fire" against the
          // CTA buttons. Only `hot` drops glow, and even those are off
          // by default now that the tap-burst feature was removed.
          if (d.hot && i === 0) {
            ctx.shadowColor = 'rgba(239, 68, 68, 0.85)';
            ctx.shadowBlur = 14;
          } else {
            ctx.shadowBlur = 0;
          }
          ctx.fillStyle = `rgba(${baseRgb}, ${a})`;
          ctx.fillText(ch, d.x, y);
        }
        ctx.shadowBlur = 0;
        survivors.push(d);
      }
      dropsRef.current = survivors;

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      // 2026-05-13 bugfix: <canvas> is a *replaced* element with an
      // intrinsic 300×150 size. `absolute inset-0` alone does NOT
      // stretch it to the parent (because replaced elements ignore the
      // implicit stretch from setting all four insets to 0). Without
      // explicit width/height the canvas rendered as a tiny rectangle
      // in the corner — see screenshot from the user. Forcing
      // `width: 100%; height: 100%` plus `display: block` (kills the
      // baseline-inline gap) gives us the full setup-modal area.
      style={{ width: '100%', height: '100%', display: 'block' }}
      className={`pointer-events-none absolute inset-0 ${className ?? ''}`}
    />
  );
});

export default MatrixRain;
