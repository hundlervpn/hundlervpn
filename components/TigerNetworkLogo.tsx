'use client';

/**
 * TigerNetworkLogo — main home-screen logo for Hundler VPN.
 *
 * The logo image (`public/tiger.png`) is a pre-rendered composite: the
 * tiger head + red polygonal network mesh + black backdrop, all drawn
 * as a single 600×600 PNG with a soft radial alpha mask around the
 * edges (applied by `scripts/prepare-tiger.js`). Because every visual
 * element lives in the PNG, this React component's only job is:
 *   - render the image full-bleed inside a square container,
 *   - add a subtle red glow behind it so it blends with the page,
 *   - apply a gentle "breathing" scale+opacity loop for life.
 *
 * No SVG overlays, no per-node animation — the heavy lifting is baked
 * into the PNG, which keeps the render cheap and the code tiny.
 */

import Image from 'next/image';
import { motion } from 'motion/react';

export default function TigerNetworkLogo({ className = '' }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {/* The artwork itself. A slow 4 s breathing loop (±2% scale,
          alpha dip) gives the logo a heartbeat-like feel that matches
          the "live" vibe of the glowing eye in the artwork.
          The red "halo" is created by stacking TWO drop-shadows on the
          image itself — they follow the circular alpha mask baked into
          the PNG, so the glow is guaranteed to be round. Using blur-*
          on sibling divs would render a rectangular-looking smear on
          some browsers (notably iOS WebKit) because CSS `filter: blur`
          operates on the bounding box, not on the visible shape. */}
      <motion.div
        className="absolute inset-0"
        animate={{ scale: [1, 1.02, 1], opacity: [0.95, 1, 0.95] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          filter:
            'drop-shadow(0 0 18px rgba(239,68,68,0.35)) ' +
            'drop-shadow(0 0 42px rgba(239,68,68,0.22))',
        }}
      >
        <Image
          src="/tiger.png"
          alt="Hundler VPN Tiger"
          fill
          priority
          sizes="(min-width: 1024px) 320px, 224px"
          className="object-contain object-center select-none pointer-events-none"
          draggable={false}
        />
      </motion.div>
    </div>
  );
}
