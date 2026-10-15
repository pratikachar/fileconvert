/**
 * Copy the OpenCV.js build used by Magic Remove out of node_modules and into
 * public/cv/, exactly like copy-ort-wasm.mjs does for onnxruntime-web.
 *
 * Why copy instead of bundling: dist/opencv.js is an 11 MB UMD bundle with the
 * wasm base64-embedded, and it is only needed when someone actually opens the
 * Magic Remove panel. Serving it from public/ means it is fetched on demand as
 * a plain same-origin script (no CJS interop fight in Rollup, and nothing
 * cross-origin for COEP require-corp to block).
 *
 * Version note: 4.10.0-release.1 is a CORE-only build with NO cv.inpaint
 * (verified at runtime). 4.11.0-release.1 ships the photo module - re-check
 * cv.inpaint before ever downgrading this pin.
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/@techstark/opencv-js/dist/opencv.js');
const destDir = resolve(root, 'public/cv');
const dest = resolve(destDir, 'opencv.js');

try {
  const size = statSync(src).size;
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  console.log(`opencv.js copied (${(size / 1024 / 1024).toFixed(1)} MB) -> public/cv/opencv.js`);
} catch (err) {
  console.error('Failed to copy opencv.js:', err.message);
  console.error('Magic Remove will not work until this succeeds.');
  process.exit(1);
}