/**
 * Brand-coloured payment-method glyphs for the checkout buttons.
 *
 * We keep them as inline React components (rather than <img src="/sbp.svg">)
 * so the icon ships with the JS bundle — no extra HTTP request, no FOUC,
 * and we can tweak opacity per active state without burdening the
 * stylesheet with `filter: grayscale(...)` hacks.
 *
 * The source SVGs are also mirrored under `public/sbp.svg` and
 * `public/cryptobot.svg` for places that genuinely need a file URL
 * (og:image, external previews, future emails). Keep the two in sync
 * if you tweak the artwork.
 */

type IconProps = {
  size?: number;
  className?: string;
  /** When false, render in muted form for the inactive payment option. */
  active?: boolean;
};

const inactiveStyle = (active: boolean) => ({
  // Inactive payment options are visually de-emphasised so the
  // selected option pops. Dimming instead of desaturating keeps
  // the multi-colour SBP sigil legible at 16 px.
  opacity: active ? 1 : 0.45,
  transition: 'opacity 150ms ease',
});

/**
 * Official «Система Быстрых Платежей» mark (8-colour star sigil).
 * Aspect ratio preserved — width matches `size`, height auto-scales.
 */
export function SbpIcon({ size = 16, className, active = true }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 120) / 97}
      viewBox="0 0 97 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={inactiveStyle(active)}
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

/**
 * CryptoBot logo (blue rounded square + white "Cb"-like mark).
 *
 * The original artwork ships with deeply nested group transforms
 * (translate(15310, -1417), translate(-15309, 1418)…). Rather than
 * algebraically collapse them and risk silent drift, we preserve the
 * exact same transform chain — TypeScript / React are happy with any
 * SVG markup as long as attribute names are camelCased. The chain
 * resolves to a 58×58 viewBox-aligned drawing.
 */
export function CryptoBotIcon({ size = 16, className, active = true }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 58 58"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={inactiveStyle(active)}
    >
      <g transform="translate(15310.861 -1417.65)">
        <g transform="translate(-15309.861 1418.75)">
          <path
            d="M.235,28.626C.235,6.721,6.544.412,28.449.412S56.662,6.721,56.662,28.626,50.353,56.838,28.449,56.838.235,50.529.235,28.626Z"
            transform="translate(-0.235 -0.512)"
            fill="#1b34c2"
          />
        </g>
        <g transform="translate(-15299.99 1438.884)">
          <g transform="translate(20.112 0)">
            <path
              d="M790.844,993h7.067a4.5,4.5,0,0,1,4.5,4.5v8.768a2.743,2.743,0,0,1-2.743,2.743h0V997.464a1.758,1.758,0,0,0-1.758-1.758h-7a1.759,1.759,0,0,0-1.363.648l-2,2.463-1.771-2.168,1.648-2.029A4.4,4.4,0,0,1,790.844,993Z"
              transform="translate(-785.788 -993)"
              fill="#fff"
            />
          </g>
          <path
            d="M583.792,1007.4a4.4,4.4,0,0,1-3.408,1.619h-6.969a4.5,4.5,0,0,1-4.5-4.5V997.5a4.5,4.5,0,0,1,4.5-4.5h6.994a4.4,4.4,0,0,1,3.408,1.619l9,11.045a1.758,1.758,0,0,0,1.363.648h5.979v2.7h-6.054a4.4,4.4,0,0,1-3.408-1.619l-9-11.043a1.759,1.759,0,0,0-1.363-.648h-6.924a1.758,1.758,0,0,0-1.758,1.758v7.09a1.758,1.758,0,0,0,1.758,1.758h6.9a1.759,1.759,0,0,0,1.363-.648l2.024-2.483,1.766,2.167Z"
            transform="translate(-568.911 -993)"
            fill="#fff"
          />
        </g>
      </g>
    </svg>
  );
}
