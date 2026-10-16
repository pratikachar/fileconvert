/**
 * Node checks for the OCR module's pure parts (src/editors/ocr.js).
 * The wasm recognize path needs a browser - covered by headless E2E.
 * Run: node scripts/test-ocr.mjs
 */

import { ocrOptions, ocrSizeMB, summarizeResult } from '../src/editors/ocr.js';

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}

{
  const o = ocrOptions();
  check('options: worker script same-origin', o.workerPath === '/ocr/worker.min.js');
  check('options: core + lang same-origin', o.corePath === '/ocr' && o.langPath === '/ocr');
  check('options: no CDN anywhere', JSON.stringify(o).includes('http') === false);
}

{
  check('size quote plausible (core + lang)', ocrSizeMB() >= 10 && ocrSizeMB() <= 30, ocrSizeMB() + ' MB');
}

{
  const r = summarizeResult({ text: '  Hello\n\tWorld  \n', confidence: 87.4 });
  check('summary: trims + collapses trailing spaces', r.text === 'Hello\nWorld', JSON.stringify(r.text));
  check('summary: rounds confidence', r.confidence === 87);
  check('summary: counts words', r.words === 2);
  const empty = summarizeResult({ text: '   ', confidence: NaN });
  check('summary: blank is zeroed', empty.text === '' && empty.words === 0 && empty.confidence === 0);
  const missing = summarizeResult(null);
  check('summary: null-safe', missing.text === '' && missing.confidence === 0);
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
