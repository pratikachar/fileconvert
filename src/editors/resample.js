// resample.js — high-quality browser resampling primitives (pure JS, no DOM).
// Powers the Image Editor Resize "Crisp" (Lanczos-3) method and the AI Upscale
// mid/down-scale passes. The vertical pass is processed in bands so memory stays
// bounded even for very large outputs.

export function lanczos3(x) {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= 3) return 0;
  const p = Math.PI * x;
  const sinc1 = Math.sin(p) / p;
  const sinc2 = Math.sin(p / 3) / (p / 3);
  return sinc1 * sinc2;
}

// Precompute normalized filter weights for one axis.
// scale = srcSize / dstSize (source px per destination px).
function buildWeights(dstSize, srcSize) {
  const scale = srcSize / dstSize;
  const inv = 1 / Math.max(1, scale);
  const support = 3 * Math.max(1, scale);
  const rows = new Array(dstSize);
  for (let t = 0; t < dstSize; t++) {
    const center = (t + 0.5) * scale - 0.5;
    let s = Math.ceil(center - support);
    let e = Math.floor(center + support);
    if (s < 0) s = 0;
    if (e > srcSize - 1) e = srcSize - 1;
    const w = new Float32Array(e - s + 1);
    let sum = 0;
    for (let i = s; i <= e; i++) {
      const v = lanczos3((center - i) * inv);
      w[i - s] = v;
      sum += v;
    }
    if (sum === 0) sum = 1;
    for (let k = 0; k < w.length; k++) w[k] /= sum;
    rows[t] = { start: s, w };
  }
  return rows;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Nearest-neighbor resize. src/out are RGBA Uint8ClampedArray.
export function resizeNearest(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const syi = Math.min(sh - 1, Math.floor((y + 0.5) * sy));
    const srow = syi * sw * 4;
    const drow = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const sxi = Math.min(sw - 1, Math.floor((x + 0.5) * sx));
      const si = srow + sxi * 4;
      const di = drow + x * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

// Separable Lanczos-3 resize. onProgress(pct) 0..100 fires during the vertical pass.
export function resizeLanczos(src, sw, sh, dw, dh, onProgress) {
  const colW = buildWeights(dw, sw);
  const rowW = buildWeights(dh, sh);
  const out = new Uint8ClampedArray(dw * dh * 4);
  const BAND = 512;
  let lastPct = -1;
  for (let y0 = 0; y0 < dh; y0 += BAND) {
    const y1 = Math.min(dh, y0 + BAND);
    let sStart = Infinity;
    let sEnd = -Infinity;
    for (let y = y0; y < y1; y++) {
      const { start, w } = rowW[y];
      if (start < sStart) sStart = start;
      const end = start + w.length - 1;
      if (end > sEnd) sEnd = end;
    }
    const bandRows = sEnd - sStart + 1;
    const tmp = new Float32Array(dw * bandRows * 4);
    // Horizontal pass over source rows sStart..sEnd.
    for (let yy = 0; yy < bandRows; yy++) {
      const srow = (sStart + yy) * sw * 4;
      const trow = yy * dw * 4;
      for (let x = 0; x < dw; x++) {
        const { start, w } = colW[x];
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = 0; k < w.length; k++) {
          const si = srow + (start + k) * 4;
          const ww = w[k];
          r += src[si] * ww;
          g += src[si + 1] * ww;
          b += src[si + 2] * ww;
          a += src[si + 3] * ww;
        }
        const di = trow + x * 4;
        tmp[di] = r;
        tmp[di + 1] = g;
        tmp[di + 2] = b;
        tmp[di + 3] = a;
      }
    }
    // Vertical pass rows y0..y1.
    for (let y = y0; y < y1; y++) {
      const { start, w } = rowW[y];
      const yy0 = start - sStart;
      const drow = y * dw * 4;
      for (let x = 0; x < dw; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = 0; k < w.length; k++) {
          const ti = ((yy0 + k) * dw + x) * 4;
          const ww = w[k];
          r += tmp[ti] * ww;
          g += tmp[ti + 1] * ww;
          b += tmp[ti + 2] * ww;
          a += tmp[ti + 3] * ww;
        }
        const di = drow + x * 4;
        out[di] = clamp255(r);
        out[di + 1] = clamp255(g);
        out[di + 2] = clamp255(b);
        out[di + 3] = clamp255(a);
      }
    }
    if (onProgress) {
      const pct = Math.floor((y1 / dh) * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        onProgress(pct);
      }
    }
  }
  return out;
}