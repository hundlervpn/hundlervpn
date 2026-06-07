'use client';

import { useEffect, useState } from 'react';

/**
 * Minimal shape of the Telegram WebApp.BackButton API we care about.
 * Inlined so this hook doesn't depend on the global TelegramWebApp
 * interface (which lives in app/page.tsx as a local declaration and is
 * not exported).
 */
type TelegramBackButton = {
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
  isVisible: boolean;
};

type TelegramWebAppMinimal = {
  initData?: string;
  platform?: string;
  BackButton?: TelegramBackButton;
};

function getWebApp(): TelegramWebAppMinimal | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebAppMinimal } };
  return w.Telegram?.WebApp ?? null;
}

/**
 * Detect whether the current page is rendered inside a Telegram
 * Mini App webview (vs. a plain browser).
 *
 * The check is `initData` non-empty — the SDK is also injected on the
 * Telegram desktop "Open in browser" flow, but `initData` is only
 * populated when the page was actually opened from a Mini App button.
 * `platform` would also work but `unknown` is a legitimate Telegram
 * Desktop value, so we stick with initData.
 */
export function isInTelegramMiniApp(): boolean {
  const wa = getWebApp();
  if (!wa) return false;
  return Boolean(wa.initData && wa.initData.length > 0);
}

/**
 * React hook to wire up the native Telegram `BackButton`.
 *
 * Telegram exposes a system-level "Back" button in the Mini App header
 * (the one in the second screenshot — appears next to the close "v"
 * pill). When shown, it replaces the default "Close" affordance, so
 * tapping it should navigate *within* the Mini App rather than close
 * it. We bind it to a callback (usually `router.back()`).
 *
 * Behaviour:
 *   • If not in a Mini App or `enabled === false` → no-op. Safe to
 *     call from pages that may be rendered both in TMA and the public
 *     browser.
 *   • Shows the button on mount, hides it on unmount.
 *   • Subscribes the callback with `onClick`, unsubscribes via
 *     `offClick` on cleanup so we don't leak handlers on route change.
 *
 * UX note from Telegram docs:
 *   "Do not duplicate the Back button inside the HTML if you use the
 *    system Back button — it confuses the user."
 * So callers should hide their in-page back button when the hook is
 * active. The companion `isInTelegramMiniApp()` getter lets them
 * branch on that.
 */
export function useTelegramBackButton(callback: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const wa = getWebApp();
    const bb = wa?.BackButton;
    if (!bb) return;
    bb.onClick(callback);
    bb.show();
    return () => {
      bb.offClick(callback);
      bb.hide();
    };
  }, [callback, enabled]);
}

/**
 * Convenience hook that combines TMA detection with the BackButton
 * wiring in a single call. Returns `true` if the page is rendered
 * inside the Mini App (so callers can hide their HTML back button).
 *
 * The detection state starts as `false` to match SSR output (where
 * `window` is undefined). After the first client effect we re-check
 * and flip the flag — there's a single render with the HTML button
 * visible, then it hides. In practice that's a few ms and is masked
 * by the page mount animation.
 */
export function useTelegramBack(callback: () => void): boolean {
  const [inTma, setInTma] = useState(false);
  useEffect(() => {
    // Telegram's WebApp SDK is injected via a separate <script> and can
    // mount a few hundred ms after the page hydrates. We poll up to
    // ~3s so a Mini App user doesn't see the in-page back button flash
    // and then disappear once the SDK arrives. For plain-browser
    // visitors the loop simply exits after timeout — no observable
    // cost since the only work is reading `window.Telegram`.
    let cancelled = false;
    const start = Date.now();
    const tick = () => {
      if (cancelled) return;
      if (isInTelegramMiniApp()) {
        setInTma(true);
        return;
      }
      if (Date.now() - start >= 3000) return;
      setTimeout(tick, 200);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);
  useTelegramBackButton(callback, inTma);
  return inTma;
}
