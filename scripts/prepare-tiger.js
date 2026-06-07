// Preprocess the tiger artwork for the home-screen logo.
//
// The source (`public/tiger-source.png`) is a pre-rendered composite
// of the tiger head + red polygonal network mesh on a SOLID BLACK
// square background. It's AI-generated, typically 1024x1024, and
// already includes all the visual detail we want to display — no
// further compositing is needed in the React component.
//
// This script produces `public/tiger.png`:
//   1. Downscaled to OUTPUT_SIZE (default 600px) for a sensible file size.
//   2. A soft RADIAL ALPHA MASK applied so the black background fades
//      to transparent near the corners. This avoids a hard black square
//      visible against the app's dark (but not pure-black) backdrop —
//      the logo "floats" on the page instead of sitting in a tile.
//   3. Aggressive PNG compression.
//
// Run with:  node scripts/prepare-tiger.js
// Idempotent: tiger-source.png is never modified.

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'tiger-source.png');
const DST = path.join(__dirname, '..', 'public', 'tiger.png');
const TMP = path.join(__dirname, '..', 'public', 'tiger.tmp.png');

// ── Output tuning ───────────────────────────────────────────────────
// OUTPUT_SIZE: logo is displayed at most at ~320px CSS, so 600px covers
// 2x DPR displays and still compresses to a sensible size.
const OUTPUT_SIZE = 600;
// Radial mask geometry (fractions of OUTPUT_SIZE / 2):
//   r < INNER_FRAC          → alpha stays at source alpha (fully visible)
//   INNER_FRAC ≤ r ≤ OUTER  → smooth cosine fade from 1 → 0
//   r > OUTER_FRAC          → alpha = 0
const INNER_FRAC = 0.72; // content stays crisp within 72% of radius
const OUTER_FRAC = 0.98; // everything past 98% is fully transparent

if (!fs.existsSync(SRC)) {
  throw new Error(
    'Missing public/tiger-source.png — place the original tiger artwork there.',
  );
}

(async () => {
  // 1) Downscale the source to OUTPUT_SIZE square. The source is a
  //    square composite so we don't need to pad — just resize.
  const resizedBuf = await sharp(SRC)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: px, info } = resizedBuf;
  const { width: W, height: H } = info;
  const cx = W / 2;
  const cy = H / 2;
  const maxR = Math.min(W, H) / 2;
  const innerR = INNER_FRAC * maxR;
  const outerR = OUTER_FRAC * maxR;

  // 2) Apply the radial mask in-place on the raw RGBA buffer.
  //    We use a smoothstep (cosine) curve between innerR and outerR so
  //    the fade has no visible banding.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const i = (y * W + x) * 4;
      if (r <= innerR) {
        // leave alpha as-is
        continue;
      }
      if (r >= outerR) {
        px[i + 3] = 0;
        continue;
      }
      // smoothstep fade: t=0 at innerR, t=1 at outerR
      const t = (r - innerR) / (outerR - innerR);
      const fade = 0.5 + 0.5 * Math.cos(Math.PI * t); // 1 → 0
      px[i + 3] = Math.round(px[i + 3] * fade);
    }
  }

  // 3) Encode as compressed PNG. Palette mode shrinks the file a lot
  //    (<<100 KB typical) while preserving the visual quality of a
  //    mostly black + red + white-grey composite.
  await sharp(px, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(TMP);

  const finalKB = (fs.statSync(TMP).size / 1024).toFixed(0);
  console.log(
    'Final:', W + 'x' + H,
    '| radial mask:', INNER_FRAC.toFixed(2) + '..' + OUTER_FRAC.toFixed(2),
    '| size:', finalKB + ' KB',
  );

  fs.renameSync(TMP, DST);
})();
