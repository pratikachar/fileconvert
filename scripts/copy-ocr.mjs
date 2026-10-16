/**
 * Stage Tesseract.js OCR assets into public/ocr/ (gitignored), mirroring the
 * copy-ort-wasm.mjs / copy-opencv-wasm.mjs convention.
 *
 * - worker.min.js + tesseract-core-* come from node_modules (same-origin, so
 *   the worker script never trips COEP require-corp).
 * - eng.traineddata.gz downloads once from jsDelivr and is skipped when
 *   already present (do NOT re-download 15 MB on every `npm run dev`).
 * - The worker IDB-caches the language data after first use, so repeat visits
 *   skip the download entirely at runtime too.
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destDir = resolve(root, 'public/ocr');
mkdirSync(destDir, { recursive: true });

const CORE_FILES = [
  'tesseract-core.js', 'tesseract-core.wasm', 'tesseract-core.wasm.js',
  'tesseract-core-lstm.js', 'tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd.js', 'tesseract-core-simd.wasm', 'tesseract-core-simd.wasm.js',
  'tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd.js', 'tesseract-core-relaxedsimd.wasm', 'tesseract-core-relaxedsimd.wasm.js',
  'tesseract-core-relaxedsimd-lstm.js', 'tesseract-core-relaxedsimd-lstm.wasm', 'tesseract-core-relaxedsimd-lstm.wasm.js',
];

let copied = 0, skipped = 0;
function copyOnce(src, dest) {
  if (existsSync(dest)) { skipped++; return; }
  copyFileSync(src, dest);
  copied++;
}

copyOnce(
  resolve(root, 'node_modules/tesseract.js/dist/worker.min.js'),
  resolve(destDir, 'worker.min.js')
);
for (const f of CORE_FILES) {
  copyOnce(resolve(root, 'node_modules/tesseract.js-core', f), resolve(destDir, f));
}

// English traineddata (LSTM build, matches tesseract.js v7 defaults).
const LANG_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz';
const langDest = resolve(destDir, 'eng.traineddata.gz');
if (existsSync(langDest)) {
  skipped++;
  console.log('eng.traineddata.gz present, skipping download');
} else {
  console.log('downloading eng.traineddata (~15 MB, once)…');
  const res = await fetch(LANG_URL);
  if (!res.ok) {
    console.error(`Language download failed (HTTP ${res.status}). OCR will not work until this succeeds.`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
    console.error('Downloaded language file is not gzip - aborting (CDN returned an error page?).');
    process.exit(1);
  }
  writeFileSync(langDest, buf);
  copied++;
}

const totalMB = (statSync(langDest).size / 1024 / 1024).toFixed(1);
console.log(`ocr assets ready (copied ${copied}, skipped ${skipped}) - lang data ${totalMB} MB`);
