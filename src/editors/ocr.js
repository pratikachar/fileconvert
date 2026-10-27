/**
 * OCR - Tesseract.js text extraction, 100% in the browser.
 *
 * Self-hosting (NOT CDN) is mandatory here, same lesson as OpenCV/imgly:
 * under COEP require-corp a cross-origin worker script and wasm fetch get
 * blocked. scripts/copy-ocr.mjs stages dist/worker.min.js, the core wasm
 * variants and eng.traineddata.gz into public/ocr/ (gitignored), and the
 * worker IDB-caches the language data after first use.
 *
 * ACCURACY NOTES (why the preprocessing below exists):
 * Tesseract is trained on ~30px-tall glyphs at 300 DPI. Phone photos are
 * either far larger (so text ends up tiny after any resize) or low contrast
 * (grey paper, shadows). Two cheap fixes buy most of the accuracy:
 *   1. scale so the long side is >= OCR_MIN_DIM and <= OCR_MAX_DIM,
 *   2. stretch contrast (2nd..98th percentile) and, for the second pass,
 *      Otsu-binarize the grayscale.
 * "Smart" mode runs both variants and keeps the better result, which is far
 * more reliable than guessing one setting from image dimensions.
 *
 * HONEST SCOPE: printed/document text in English at decent resolution.
 * Handwriting, decorative fonts and tiny low-contrast text will disappoint -
 * that is a property of the engine, not a bug, and the UI says so.
 */

/** Engine paths. Pure (returns data, no side effects) so it is Node-testable. */
export function ocrOptions() {
  return {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr',
    langPath: '/ocr',
  };
}

/** First-run download size, for honest UI copy. */
export function ocrSizeMB() {
  return 17;
}

/** Long-side cap for OCR canvases. Beyond this, detail gains are not worth the time. */
export const OCR_MAX_DIM = 2400;
/** Small images are upscaled to at least this long side (glyph height matters). */
export const OCR_MIN_DIM = 1400;

/**
 * Recognizer presets. `passes` are the preprocessing variants to try;
 * the best result wins (smart) or the first is kept (fast).
 *
 * Smart includes a raw pass because preprocessing is not always a win:
 * a phone-snapshot JPEG with an uneven background can confuse the contrast
 * stretch while Tesseract reads the untouched pixels perfectly (measured -
 * smart used to pick the worse enhanced pass on exactly that image).
 */
export const OCR_MODES = {
  smart: { label: 'Smart - tries 3 passes, keeps the best', passes: ['enhance', 'none', 'binarize'] },
  fast: { label: 'Fast - single pass', passes: ['enhance'] },
  raw: { label: 'Original pixels only', passes: ['none'] },
};

/** Human names for the preprocessing variant that produced the winning read. */
export const OCR_PASSES = {
  enhance: 'contrast-boosted',
  binarize: 'black & white',
  none: 'original pixels',
};

/** Page segmentation modes exposed in the UI (Tesseract PSM numbers). */
export const OCR_LAYOUTS = {
  auto: { label: 'Automatic - mixed page', psm: '3' },
  block: { label: 'Single block of text', psm: '6' },
  sparse: { label: 'Sparse text - screens, memes, signs', psm: '11' },
};

/**
 * Otsu's automatic threshold from a 256-bin histogram.
 * Pure so it is unit-tested without a browser.
 */
export function otsuThreshold(hist) {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i] || 0;
    sum += i * (hist[i] || 0);
  }
  if (!total) return 128;
  let sumB = 0;
  let wB = 0;
  let best = 128;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] || 0;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * (hist[t] || 0);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

/** Contrast levels from a histogram, clipping `clip` of the tails on each side. */
export function contrastLevels(hist, clip = 0.02) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i] || 0;
  if (!total) return { lo: 0, hi: 255 };
  const edge = Math.max(0, Math.min(0.2, clip)) * total;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i] || 0; if (acc > edge) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i] || 0; if (acc > edge) { hi = i; break; } }
  if (hi - lo < 24) { lo = 0; hi = 255; } // flat image: leave it alone
  return { lo, hi };
}

/** Luminance of one RGB triplet (Rec. 601, matches Tesseract's own grayscale). */
export function luma(r, g, b) {
  return (r * 0.299 + g * 0.587 + b * 0.114) | 0;
}

/**
 * Score a recognizer pass so variants can be compared honestly.
 * Confidence alone rewards a pass that read one big word and quit, so word
 * coverage gets a logarithmic bonus that cannot overwhelm confidence.
 */
export function scoreCandidate(input) {
  const { confidence = 0, words = 0 } = input || {};
  const c = Number.isFinite(+confidence) ? Math.max(0, Math.min(100, +confidence)) : 0;
  const w = Math.max(0, Number(words) || 0);
  if (!w) return 0;
  return c * Math.log2(2 + w);
}

/** Shape raw tesseract output into { text, confidence, words }. Pure. */
export function summarizeResult(data) {
  const raw = String((data && data.text) || '');
  const text = raw
    .replace(/\f/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, '').replace(/^\s+/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const confidence = data && Number.isFinite(+data.confidence) ? Math.round(+data.confidence) : 0;
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  return { text, confidence, words };
}

/** Scale factor that keeps the long side inside [OCR_MIN_DIM, OCR_MAX_DIM]. */
export function ocrScale(width, height, minDim = OCR_MIN_DIM, maxDim = OCR_MAX_DIM) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const long = Math.max(w, h);
  if (long > maxDim) return maxDim / long;
  if (long < minDim) return Math.min(3, minDim / long);
  return 1;
}

/**
 * Turn an image (canvas, ImageBitmap, Image or ImageData) into a canvas tuned
 * for OCR. `mode` is 'enhance' (grayscale + contrast), 'binarize' (enhance +
 * Otsu) or 'none' (just scaled).
 */
export function prepareOcrCanvas(source, { mode = 'enhance', maxDim = OCR_MAX_DIM, minDim = OCR_MIN_DIM } = {}) {
  const sw = source.width || (source.naturalWidth || 0);
  const sh = source.height || (source.naturalHeight || 0);
  if (!sw || !sh) throw new Error('OCR needs a loaded image.');
  const scale = ocrScale(sw, sh, minDim, maxDim);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  if (mode === 'none') return canvas;

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = luma(px[i], px[i + 1], px[i + 2]);
    hist[g]++;
  }
  const { lo, hi } = contrastLevels(hist);
  const span = Math.max(1, hi - lo);
  const stretched = new Uint32Array(256);
  for (let g = 0; g < 256; g++) {
    const v = Math.max(0, Math.min(255, Math.round(((g - lo) * 255) / span)));
    stretched[v] += hist[g];
  }
  const threshold = mode === 'binarize' ? otsuThreshold(stretched) : 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = luma(px[i], px[i + 1], px[i + 2]);
    let v = Math.max(0, Math.min(255, Math.round(((g - lo) * 255) / span)));
    if (mode === 'binarize') v = v > threshold ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let workerPromise = null;
let activeLogger = () => {};

/**
 * Load (once) and return the OCR worker. onProgress receives { status, progress }.
 * Resolves after loadLanguage + initialize so recognize() never races setup.
 *
 * The logger is forwarded to whichever call is running NOW (the old version
 * captured the first caller's callback forever, so later runs reported
 * progress to a dead closure).
 */
export function loadOCR(onProgress = () => {}) {
  activeLogger = onProgress;
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    if (typeof window === 'undefined') throw new Error('OCR needs a browser.');
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      ...ocrOptions(),
      logger: (m) => {
        try { activeLogger(m); } catch { /* progress must never break loading */ }
      },
    });
    // 300 DPI matches Tesseract's training data; without it the engine guesses
    // the resolution from image size and mangles small text. Interword spaces
    // keep columns from being glued together.
    try {
      await worker.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1' });
    } catch { /* older core: harmless */ }
    return worker;
  })().catch((err) => {
    workerPromise = null; // allow a retry after a failed load
    throw err;
  });
  return workerPromise;
}

/**
 * Recognize text in an image (canvas, ImageData, Blob or URL).
 *
 * @param {*} image
 * @param {function} onProgress - ({status, progress, pass, passes})
 * @param {object} opts - { mode: 'smart'|'fast'|'raw', layout: 'auto'|'block'|'sparse' }
 * @returns {Promise<{text, confidence, words, mode, passes}>}
 */
export async function recognizeImage(image, onProgress = () => {}, opts = {}) {
  const modeKey = OCR_MODES[opts.mode] ? opts.mode : 'smart';
  const layoutKey = OCR_LAYOUTS[opts.layout] ? opts.layout : 'auto';
  const variants = OCR_MODES[modeKey].passes;
  let currentPass = 0;
  const worker = await loadOCR((m) => {
    const p = Number(m && m.progress) || 0;
    onProgress({
      status: (m && m.status) || 'loading',
      progress: p,
      pass: currentPass + 1,
      passes: variants.length,
    });
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: OCR_LAYOUTS[layoutKey].psm });
  } catch { /* keep engine defaults */ }

  const results = [];
  let best = null;
  for (let i = 0; i < variants.length; i++) {
    currentPass = i;
    const variant = variants[i];
    onProgress({ status: `preparing pass ${i + 1}`, progress: 0, pass: i + 1, passes: variants.length });
    let input = image;
    try {
      input = prepareOcrCanvas(image, { mode: variant });
    } catch {
      input = image; // non-canvas input (Blob/URL) - let tesseract handle it
    }
    let data = null;
    try {
      ({ data } = await worker.recognize(input));
    } catch (err) {
      results.push({ mode: variant, confidence: 0, words: 0, error: String((err && err.message) || err) });
      continue;
    }
    const summary = summarizeResult(data);
    const scored = { ...summary, mode: variant, score: scoreCandidate(summary) };
    results.push({ mode: variant, confidence: summary.confidence, words: summary.words, score: scored.score });
    if (!best || scored.score > best.score) best = scored;
  }
  if (!best) {
    const detail = results.find((r) => r.error);
    throw new Error('OCR could not read this image.' + (detail ? ' ' + detail.error : ''));
  }
  const { score, ...out } = best;
  return { ...out, passes: results };
}
