// aiUpscale.js - Real-ESRGAN super-resolution in the browser via onnxruntime-web.
// Models stream through a same-origin proxy on first use (COEP-safe) and are then
// cached by the browser. 2x/8x are derived from the 4x model (downscale / double-pass).
//
// All four tiers are BSD-3-Clause / MIT. Keep the model URLs in one table so any
// host change is a one-line fix.

import { resizeLanczos } from './resample.js';

export const UPSCALE_TIERS = {
  fast: {
    label: 'Fast',
    urls: [
      '/jsd-data/gh/ntsc-rs-fan/RealESRGAN-AnimeVideo-v3-x4-ONNX@main/RealESR-AnimeVideo-v3_x4.onnx',
      '/esrgan-data/resolve/main/tidus2102/Real-ESRGAN/RealESR-AnimeVideo-v3_x4.onnx?download=true',
    ],
    sizeMB: 2.4,
    time: '~30 s',
    bestFor: 'Everything - anime & casual photos',
    note: 'Lightest model, quickest first use.',
    heavy: false,
  },
  balanced: {
    label: 'Balanced',
    urls: [
      '/jsd-data/gh/NovareOrbis/nova-ai-models@main/realesr-general-x4v3.onnx',
      '/esrgan-data/resolve/main/Heliosoph/realesrgan-onnx/realesr-general-x4v3.onnx?download=true',
    ],
    sizeMB: 4.9,
    time: '~1 min',
    bestFor: 'Photos - slightly sharper than Fast',
    note: 'Small but tuned for general/photo content.',
    heavy: false,
  },
  anime: {
    label: 'Anime',
    urls: [
      '/esrgan-data/resolve/main/deepghs/imgutils-models/real_esrgan/RealESRGAN_x4plus_anime_6B.onnx?download=true',
    ],
    sizeMB: 17.9,
    time: '2–4 min',
    bestFor: 'Drawings, manga & illustration',
    note: 'Specialized model for anime/art content.',
    heavy: true,
  },
  best: {
    label: 'Best',
    urls: [
      '/esrgan-data/resolve/main/SceneWorks/real-esrgan-onnx/real_esrgan_x4.onnx?download=true',
      '/ghraw-data/soichi11208/Real-ESRGAN-WASM/main/models/RealESRGAN_x4.onnx',
    ],
    sizeMB: 64,
    time: '3–6 min',
    bestFor: 'Photos & general - maximum detail',
    note: 'Heaviest first download - wait once, cached after.',
    heavy: true,
  },
};

export const UPSCALE_SCALES = [
  { value: 2, label: '2×', note: 'Sharpest from 4× output' },
  { value: 4, label: '4×', note: 'Full AI detail' },
  { value: 8, label: '8×', note: 'Double processing time - larger, not 8× more detail' },
];

export const INPUT_CAP = 1024;
export const ADV_INPUT_CAP = 2048;
export const MAX_OUT_DIM = 8192;

const TILE = 512; // model input tile (px)
const PAD = 16; // overlap pad (px) - seams are averaged
const HEAVY_TIERS = new Set(['anime', 'best']);

const sessions = new Map(); // tier -> InferenceSession (reused across runs)
let ortPromise = null;
let wasmConfigured = false;

export function isHeavyTier(tier) {
  return HEAVY_TIERS.has(tier);
}

export function isHeavyScale(scale) {
  return scale >= 8;
}

export function estimateOutput(srcW, srcH, scale, cap) {
  const maxIn = Math.max(srcW, srcH);
  const inW = Math.min(srcW, Math.round((srcW / maxIn) * Math.min(maxIn, cap)));
  const inH = Math.min(srcH, Math.round((srcH / maxIn) * Math.min(maxIn, cap)));
  const outW = Math.min(MAX_OUT_DIM, inW * scale);
  const outH = Math.min(MAX_OUT_DIM, inH * scale);
  return { inW, inH, outW, outH };
}

function loadOrt() {
  if (!ortPromise) {
    ortPromise = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      if (!wasmConfigured) {
        wasmConfigured = true;
        // Wasm binaries are copied to /ort/ at dev/build time (public/ort, gitignored).
        ort.env.wasm.wasmPaths = '/ort/';
        ort.env.wasm.numThreads = Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1));
      }
      return ort;
    })();
  }
  return ortPromise;
}

async function fetchModel(urls, onStatus) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const len = Number(res.headers.get('Content-Length')) || 0;
      if (!res.body) return await res.arrayBuffer();
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      let lastPct = -1;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (len && onStatus) {
          const pct = Math.min(99, Math.floor((received / len) * 100));
          if (pct !== lastPct) {
            lastPct = pct;
            onStatus(`Downloading model… ${pct}%`);
          }
        }
      }
      const buf = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.length;
      }
      return buf.buffer;
    } catch (e) {
      lastErr = e;
      console.warn('AI upscale: model source failed, trying next', url, e);
    }
  }
  throw lastErr || new Error('Model download failed');
}

async function loadSession(tier, onStatus) {
  if (sessions.has(tier)) return sessions.get(tier);
  const ort = await loadOrt();
  onStatus && onStatus('Downloading model… 0%');
  const model = await fetchModel(UPSCALE_TIERS[tier].urls, onStatus);
  onStatus && onStatus('Preparing model…');
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  sessions.set(tier, session);
  return session;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function resizeCanvas(canvas, ratio, onProgress) {
  const dw = Math.max(1, Math.round(canvas.width * ratio));
  const dh = Math.max(1, Math.round(canvas.height * ratio));
  if (dw === canvas.width && dh === canvas.height) return canvas;
  const src = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const dst = resizeLanczos(src, canvas.width, canvas.height, dw, dh, onProgress);
  const out = document.createElement('canvas');
  out.width = dw;
  out.height = dh;
  out.getContext('2d').putImageData(new ImageData(dst, dw, dh), 0, 0);
  return out;
}

// Run the 4x model over the whole canvas using overlapping tiles; seams averaged.
async function runModel(session, ort, srcCanvas, onStatus) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const ctx = srcCanvas.getContext('2d');
  const srcImg = ctx.getImageData(0, 0, w, h).data;
  const outW = w * 4;
  const outH = h * 4;
  const accum = new Float32Array(outW * outH * 3);
  const counts = new Float32Array(outW * outH);

  const stride = TILE - 2 * PAD;
  const cols = Math.max(1, Math.ceil(w / stride));
  const rows = Math.max(1, Math.ceil(h / stride));
  const total = cols * rows;
  let done = 0;
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  for (let ty = 0; ty < rows; ty++) {
    const y0 = Math.min(ty * stride, Math.max(0, h - TILE));
    const y1 = Math.min(y0 + TILE, h);
    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.min(tx * stride, Math.max(0, w - TILE));
      const x1 = Math.min(x0 + TILE, w);
      const rw = x1 - x0;
      const rh = y1 - y0;
      const tw = rw + 2 * PAD;
      const th = rh + 2 * PAD;
      const plane = th * tw;
      const tensor = new Float32Array(3 * plane);
      let o = 0;
      for (let py = 0; py < th; py++) {
        const sy = clamp(y0 - PAD + py, 0, h - 1);
        for (let px = 0; px < tw; px++) {
          const sx = clamp(x0 - PAD + px, 0, w - 1);
          const si = (sy * w + sx) * 4;
          const r = srcImg[si];
          const g = srcImg[si + 1];
          const b = srcImg[si + 2];
          const a = srcImg[si + 3] / 255;
          tensor[o] = (r * a + 255 * (1 - a)) / 255;
          tensor[plane + o] = (g * a + 255 * (1 - a)) / 255;
          tensor[2 * plane + o] = (b * a + 255 * (1 - a)) / 255;
          o++;
        }
      }
      const feeds = {};
      feeds[inputName] = new ort.Tensor('float32', tensor, [1, 3, th, tw]);
      const result = await session.run(feeds);
      const outData = result[outputName].data;
      const ow = tw * 4;
      const oh = th * 4;
      const grow = PAD * 4;
      for (let yy = 0; yy < rh * 4; yy++) {
        const gRowBase = (grow + yy) * ow + grow;
        const dRowBase = ((y0 * 4 + yy) * outW + x0 * 4);
        for (let xx = 0; xx < rw * 4; xx++) {
          const srcIdx = gRowBase + xx;
          const dstIdx = (dRowBase + xx) * 3;
          accum[dstIdx] += outData[srcIdx];
          accum[dstIdx + 1] += outData[oh * ow + srcIdx];
          accum[dstIdx + 2] += outData[2 * oh * ow + srcIdx];
          counts[dRowBase + xx] += 1;
        }
      }
      done++;
      onStatus && onStatus(`Processing… ${Math.floor((done / total) * 100)}%`);
    }
  }

  const outPix = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0; i < outW * outH; i++) {
    const c = counts[i] || 1;
    outPix[i * 4] = clamp((accum[i * 3] / c) * 255, 0, 255);
    outPix[i * 4 + 1] = clamp((accum[i * 3 + 1] / c) * 255, 0, 255);
    outPix[i * 4 + 2] = clamp((accum[i * 3 + 2] / c) * 255, 0, 255);
    outPix[i * 4 + 3] = 255;
  }
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  outCanvas.getContext('2d').putImageData(new ImageData(outPix, outW, outH), 0, 0);
  return outCanvas;
}

// Main entry point. scale in {2,4,8}. onStatus(text) for text, onProgress(pct) for bars.
export async function upscaleCanvas(srcCanvas, { tier, scale, cap = INPUT_CAP, onStatus, onProgress }) {
  let work = srcCanvas;
  const maxDim = Math.max(work.width, work.height);
  if (maxDim > cap) {
    onStatus && onStatus(`Input ${maxDim}px → ${cap}px first…`);
    work = resizeCanvas(work, cap / maxDim, onProgress);
  }
  const session = await loadSession(tier, onStatus);
  const ort = await loadOrt();
  let remaining = scale;
  let pass = 0;
  while (remaining > 1.01) {
    pass++;
    const inW = work.width;
    const inH = work.height;
    const desiredOut = Math.min(MAX_OUT_DIM, inW * 4);
    const feed = Math.min(inW, desiredOut / 4);
    let input = work;
    if (feed < inW) {
      onStatus && onStatus(`Pass ${pass}: preparing…`);
      input = resizeCanvas(work, feed / inW, onProgress);
    }
    const result = await runModel(session, ort, input, (msg) => onStatus && onStatus(`Pass ${pass}: ${msg}`));
    work = result;
    remaining /= result.width / inW;
  }
  if (remaining < 1) {
    onStatus && onStatus('Final downscale…');
    work = resizeCanvas(work, remaining, onProgress);
  }
  return work;
}

export function releaseSessions() {
  for (const s of sessions.values()) {
    try {
      s.release && s.release();
    } catch {}
  }
  sessions.clear();
}