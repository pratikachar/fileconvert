/**
 * OCR - Tesseract.js text extraction, 100% in the browser.
 *
 * Self-hosting (NOT CDN) is mandatory here, same lesson as OpenCV/imgly:
 * under COEP require-corp a cross-origin worker script and wasm fetch get
 * blocked. scripts/copy-ocr.mjs stages dist/worker.min.js, the core wasm
 * variants and eng.traineddata.gz into public/ocr/ (gitignored), and the
 * worker IDB-caches the language data after first use.
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

let workerPromise = null;

/**
 * Load (once) and return the OCR worker. onProgress receives { status, progress }.
 * Resolves after loadLanguage + initialize so recognize() never races setup.
 */
export function loadOCR(onProgress = () => {}) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    if (typeof window === 'undefined') throw new Error('OCR needs a browser.');
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      ...ocrOptions(),
      logger: (m) => {
        try { onProgress(m); } catch { /* progress must never break loading */ }
      },
    });
    return worker;
  })().catch((err) => {
    workerPromise = null; // allow a retry after a failed load
    throw err;
  });
  return workerPromise;
}

/** Shape raw tesseract output into { text, confidence, words }. Pure. */
export function summarizeResult(data) {
  const raw = String((data && data.text) || '');
  const text = raw.split('\n').map((line) => line.trim()).join('\n').trim();
  const confidence = data && Number.isFinite(+data.confidence) ? Math.round(+data.confidence) : 0;
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  return { text, confidence, words };
}

/**
 * Recognize text in an image (canvas, ImageData, Blob or URL).
 * @returns {Promise<{ text: string, confidence: number, words: number }>}
 */
export async function recognizeImage(image, onProgress = () => {}) {
  const worker = await loadOCR(onProgress);
  const { data } = await worker.recognize(image);
  return summarizeResult(data);
}
