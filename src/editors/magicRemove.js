/**
 * Magic Remove - OpenCV.js Telea/Navier-Stokes inpainting, 100% in the browser.
 *
 * HISTORY (do not repeat these mistakes):
 *  1. 4.10.0-release.1 of @techstark/opencv-js is a CORE-only build: cv.inpaint
 *     and the INPAINT_* constants do not exist. Verified at runtime. 4.11.0-release.1
 *     ships the photo module and is the pinned version - always assert
 *     `typeof cv.inpaint === 'function'` before promising the feature.
 *  2. The bundle's UMD factory returns a *promise*, so a script tag alone leaves
 *     `window.cv` unresolved. Await it, then poll until the bindings exist.
 *  3. cv.inpaint takes an 8-bit 1- or 3-channel image. Canvas getImageData() is
 *     RGBA (4 channels) and throws, so convert RGBA -> RGB first and write the
 *     result back into the original RGBA buffer to preserve alpha.
 *  4. Do not point at a CDN. Under COEP require-corp a cross-origin script needs
 *     CORP headers, and this file is 11 MB. It is copied from node_modules into
 *     public/cv/ by scripts/copy-opencv-wasm.mjs and loaded same-origin on demand.
 *
 * HONEST SCOPE: this is diffusion fill, not a generative model. It repairs small
 * objects, thin scratches, wires and blemishes convincingly. Large areas smear -
 * that is a property of the algorithm, not a bug, and the UI says so.
 */

const CV_URL = '/cv/opencv.js';
const CV_TIMEOUT_MS = 90000;

let cvPromise = null;

/** Load (once) and return the OpenCV.js module, or throw a readable error. */
export function loadOpenCV() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Magic Remove needs a browser.'));
      return;
    }
    const afterLoad = async () => {
      try {
        // The UMD factory hands back a promise; awaiting twice covers both
        // "factory promise" and "already resolved object" shapes.
        let mod = window.cv;
        if (mod && typeof mod.then === 'function') mod = await mod;
        if (mod && typeof mod.then === 'function') mod = await mod;
        window.cv = mod;
        const t0 = Date.now();
        while (!mod || !mod.Mat) {
          if (Date.now() - t0 > CV_TIMEOUT_MS) throw new Error('OpenCV bindings never appeared.');
          await new Promise((r) => setTimeout(r, 100));
        }
        if (typeof mod.inpaint !== 'function') {
          throw new Error('This OpenCV build has no cv.inpaint (photo module missing).');
        }
        resolve(mod);
      } catch (err) {
        cvPromise = null; // allow a retry after a failed load
        reject(err);
      }
    };
    const existing = document.querySelector(`script[data-cv="1"]`);
    if (existing) {
      if (window.cv) afterLoad();
      else existing.addEventListener('load', afterLoad, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = CV_URL;
    s.dataset.cv = '1';
    s.onload = afterLoad;
    s.onerror = () => {
      cvPromise = null;
      reject(new Error('Could not load the OpenCV engine (public/cv/opencv.js). Run the copy script.'));
    };
    document.head.appendChild(s);
  });
  return cvPromise;
}

/** Byte size of the engine, for honest UI copy about the one-time download. */
export function opencvSizeMB() {
  return 10.9;
}

/**
 * Turn a painted mask (Uint8ClampedArray, non-zero = "remove this") into the
 * single-channel CV_8UC1 Mat OpenCV wants. Pure, so it is Node-testable.
 */
export function maskToArray(mask, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 255 : 0;
  return out;
}

/** Fraction of the image the user marked - drives the "too big" warning. */
export function maskCoverage(mask, width, height) {
  if (!mask || !width || !height) return 0;
  let n = 0;
  const total = width * height;
  for (let i = 0; i < total; i++) if (mask[i]) n++;
  return n / total;
}

/**
 * Inpaint the masked region.
 *
 * @param {ImageData} imageData  source pixels (edited in place with the result)
 * @param {Uint8ClampedArray} mask  non-zero = fill this area
 * @param {object} [opts]
 * @param {number} [opts.radius=5]        Telea neighbourhood radius (1-25)
 * @param {number} [opts.grow=2]          mask dilation in px before filling (0-25)
 * @param {string} [opts.method='telea']  'telea' | 'ns'
 * @param {function} [opts.onProgress]    optional (0..1) progress callback
 * @returns {Promise<{changed:number, coverage:number, method:string}>}
 */
export async function inpaintMask(imageData, mask, opts = {}) {
  const { radius = 5, grow = 2, method = 'telea', onProgress = () => {} } = opts;
  const cv = await loadOpenCV();
  const { width, height, data } = imageData;
  const coverage = maskCoverage(mask, width, height);
  if (coverage <= 0) throw new Error('Paint over the object you want removed first.');

  const r = Math.max(1, Math.min(25, Number(radius) || 5));
  const g = Math.max(0, Math.min(25, Number(grow) || 0));
  const flag = method === 'ns' ? cv.INPAINT_NS : cv.INPAINT_TELEA;

  onProgress(0.1);
  let src = null;
  let rgb = null;
  let maskMat = null;
  let dst = null;
  let kernel = null;
  try {
    src = cv.matFromImageData(imageData);
    // RGBA -> RGB: cv.inpaint rejects 4-channel input.
    rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

    maskMat = new cv.Mat(height, width, cv.CV_8UC1);
    maskMat.data.set(maskToArray(mask, width, height));

    if (g > 0) {
      const size = new cv.Size(g * 2 + 1, g * 2 + 1);
      kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, size);
      cv.dilate(maskMat, maskMat, kernel);
    }
    onProgress(0.4);

    dst = new cv.Mat();
    cv.inpaint(rgb, maskMat, dst, r, flag);
    onProgress(0.9);

    // Write the filled RGB back into the original RGBA buffer (alpha untouched).
    const out = new Uint8ClampedArray(dst.data.length);
    out.set(dst.data);
    let changed = 0;
    for (let p = 0, q = 0; p < out.length; p += 3, q += 4) {
      const dr = Math.abs(data[q] - out[p]);
      const dg = Math.abs(data[q + 1] - out[p + 1]);
      const db = Math.abs(data[q + 2] - out[p + 2]);
      if (dr + dg + db > 12) changed++;
      data[q] = out[p];
      data[q + 1] = out[p + 1];
      data[q + 2] = out[p + 2];
    }
    onProgress(1);
    return { changed, coverage, method: method === 'ns' ? 'ns' : 'telea' };
  } finally {
    // Free the wasm heap explicitly: leaking Mats here OOMs after a few runs.
    [src, rgb, maskMat, dst, kernel].forEach((m) => {
      if (m && typeof m.delete === 'function') m.delete();
    });
  }
}