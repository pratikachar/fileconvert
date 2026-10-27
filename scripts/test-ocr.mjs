/**
 * Node checks for the OCR module's pure parts (src/editors/ocr.js).
 * The wasm recognize path needs a browser - covered by headless E2E.
 * Run: node scripts/test-ocr.mjs
 */

import {
  ocrOptions, ocrSizeMB, summarizeResult,
  otsuThreshold, contrastLevels, luma, scoreCandidate, ocrScale,
  OCR_MODES, OCR_LAYOUTS, OCR_PASSES, OCR_MAX_DIM, OCR_MIN_DIM,
} from '../src/editors/ocr.js';

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
  const ff = summarizeResult({ text: 'One\fTwo\n\f\nThree', confidence: 90 });
  check('summary: form feeds become line breaks', ff.text === 'One\nTwo\n\nThree', JSON.stringify(ff.text));
  const nbsp = summarizeResult({ text: 'a\u00a0b', confidence: 90 });
  check('summary: nbsp becomes a space', nbsp.text === 'a b' && nbsp.words === 2);
}

{
  // Bimodal histogram: 40% dark (30), 60% light (220) -> threshold in between.
  const hist = new Uint32Array(256);
  hist[30] = 400; hist[220] = 600;
  const t = otsuThreshold(hist);
  check('otsu: splits a bimodal histogram', t >= 30 && t < 220, `t=${t}`);
  check('otsu: empty histogram is safe', otsuThreshold(new Uint32Array(256)) === 128);
  const lv = contrastLevels(hist, 0.02);
  check('contrast: finds the used range', lv.lo === 30 && lv.hi === 220, JSON.stringify(lv));
  const flat = new Uint32Array(256);
  flat[200] = 1000;
  const flatLv = contrastLevels(flat, 0.02);
  check('contrast: flat image is left alone', flatLv.lo === 0 && flatLv.hi === 255, JSON.stringify(flatLv));
}

{
  check('luma: black', luma(0, 0, 0) === 0);
  check('luma: white', luma(255, 255, 255) === 255);
  check('luma: green is brightest channel', luma(0, 255, 0) > luma(255, 0, 0) && luma(0, 255, 0) > luma(0, 0, 255));
}

{
  check('score: zero words scores zero', scoreCandidate({ confidence: 99, words: 0 }) === 0);
  const few = scoreCandidate({ confidence: 95, words: 2 });
  const many = scoreCandidate({ confidence: 80, words: 40 });
  check('score: better confidence wins at equal-ish coverage', scoreCandidate({ confidence: 90, words: 10 }) > scoreCandidate({ confidence: 70, words: 10 }));
  check('score: many words can beat a lucky short read', many > few, `${many} vs ${few}`);
  check('score: bad input is safe', scoreCandidate({}) === 0 && scoreCandidate(null) === 0);
}

{
  check('scale: large image is capped', ocrScale(6000, 4000) === OCR_MAX_DIM / 6000);
  check('scale: small image is upscaled', ocrScale(500, 300) > 1);
  check('scale: upscaling is capped at 3x', ocrScale(100, 100) === 3);
  check('scale: normal image is untouched', ocrScale(2000, 1500) === 1);
  check('scale: degenerate dimensions are safe', ocrScale(0, 0) > 0);
  const scaled = 500 * ocrScale(500, 300);
  check('scale: small image meets the minimum long side', Math.round(scaled) >= OCR_MIN_DIM * 0.95, String(scaled));
}

{
  check('modes: smart compares three passes', OCR_MODES.smart.passes.length === 3
    && OCR_MODES.smart.passes.includes('binarize') && OCR_MODES.smart.passes.includes('none'));
  check('modes: smart starts with the enhanced pass', OCR_MODES.smart.passes[0] === 'enhance');
  check('modes: fast runs one pass', OCR_MODES.fast.passes.length === 1);
  check('modes: raw keeps original pixels', OCR_MODES.raw.passes[0] === 'none');
  check('passes: every variant has a label', ['enhance', 'binarize', 'none'].every((k) => !!OCR_PASSES[k]));
  check('layouts: sparse is PSM 11', OCR_LAYOUTS.sparse.psm === '11');
  check('layouts: auto is PSM 3', OCR_LAYOUTS.auto.psm === '3');
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
