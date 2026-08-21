// Copies onnxruntime-web's wasm binaries AND their .mjs JS wrappers into
// public/ort/ so the browser loads them same-origin (COEP require-corp).
// The .mjs wrappers are required too: ort's bundled code dynamically imports
// them (e.g. `import('/ort/ort-wasm-simd-threaded.mjs')`), and that import
// instantiates the .wasm. public/ort is gitignored - files are generated from
// node_modules at dev/build time, keeping the repo light.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const outDir = join(root, 'public', 'ort');
mkdirSync(outDir, { recursive: true });
let n = 0;
for (const f of readdirSync(srcDir)) {
  if (/^ort-wasm(?:-simd|-simd-threaded)?\.(wasm|mjs)$/.test(f)) {
    copyFileSync(join(srcDir, f), join(outDir, f));
    console.log('copied', f);
    n++;
  }
}
if (n === 0) {
  console.error('No onnxruntime-web wasm/mjs files found. Run npm install first.');
  process.exit(1);
}