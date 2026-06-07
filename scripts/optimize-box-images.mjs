// Optimize the two box hero PNGs (closed + open) shipped by the user.
//
// The originals are ~2.2 MB each at 1024×1024. They live at the repo
// root next to AGENTS.md (NOT in the miniapp tree) so they're not yet
// served by Next. This script:
//   1. Reads the two source PNGs from `HundlerAll/`
//   2. Produces a square 720×720 WebP at quality 88 (≈ 60-120 KB) — the
//      primary asset, used by every modern browser including the Telegram
//      WebView on Android/iOS.
//   3. Produces a 720×720 PNG fallback compressed with sharp's pngquant-
//      equivalent palette + zlib level 9 (≈ 200-350 KB) — used by old
//      WebViews that don't support WebP (rare, but cheap insurance).
//   4. Writes both into `hundlerminiapp/public/boxes/` so Next can serve
//      them under `/boxes/box-closed.webp` etc.
//
// Run from the miniapp dir:  node scripts/optimize-box-images.mjs
//
// Idempotent — overwrites previous outputs.

import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');           // …/HundlerAll
const outDir   = join(__dirname, '..', 'public', 'boxes');

const inputs = [
  {
    src: join(repoRoot, '09dd707e-5a3b-443b-a14f-4f45abcb95df-Photoroom.png'),
    name: 'box-closed',
  },
  {
    src: join(repoRoot, 'ChatGPT Image 21 мая 2026 г., 23_13_21-Photoroom.png'),
    name: 'box-open',
  },
];

const TARGET_SIZE = 720; // box renders at 140-200 px in UI; 720 covers 3x DPI

async function fileSize(p) {
  try {
    const s = await stat(p);
    return s.size;
  } catch {
    return null;
  }
}

function fmt(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

await mkdir(outDir, { recursive: true });

for (const { src, name } of inputs) {
  const srcSize = await fileSize(src);
  if (srcSize === null) {
    console.error(`[skip] missing source: ${src}`);
    continue;
  }
  console.log(`\n→ ${name}  (source: ${fmt(srcSize)})`);

  // Resize once, fan out to two encoders. Fit "inside" preserves the
  // square 1024×1024 source aspect; PNGs already have transparent
  // backgrounds (Photoroom-cut), so no flatten needed.
  const base = sharp(src).resize(TARGET_SIZE, TARGET_SIZE, {
    fit: 'inside',
    withoutEnlargement: true,
  });

  const webpOut = join(outDir, `${name}.webp`);
  const pngOut  = join(outDir, `${name}.png`);

  await base.clone()
    .webp({ quality: 88, alphaQuality: 92, effort: 6 })
    .toFile(webpOut);
  await base.clone()
    // sharp's PNG encoder with `palette: true` quantises down to 256
    // colours (similar to pngquant) — gives us ~5-8x smaller PNGs while
    // preserving the neon-on-black look. compressionLevel 9 is max zlib.
    .png({ quality: 90, palette: true, compressionLevel: 9, effort: 10 })
    .toFile(pngOut);

  const webpSize = await fileSize(webpOut);
  const pngSize  = await fileSize(pngOut);
  console.log(`  webp → ${fmt(webpSize)}   (${(srcSize / webpSize).toFixed(1)}x smaller)`);
  console.log(`  png  → ${fmt(pngSize)}    (${(srcSize / pngSize).toFixed(1)}x smaller)`);
}

console.log('\n✓ done');
