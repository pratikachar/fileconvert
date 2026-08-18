// Background removal via @imgly/background-removal (client-side, models fetched from IMG.LY CDN).
// Loaded on demand so the initial bundle stays small.
//
// Models stream to the user's browser on first use through the SAME-ORIGIN proxy /imgly-data
// (vite dev proxy / vercel rewrite / netlify redirect -> staticimgly.com). staticimgly sends no
// Access-Control-Allow-Origin, so a direct cross-origin fetch() is blocked by the browser; the
// proxy makes the request same-origin so it always works under COEP. Nothing is committed to the repo.
//
// IMPORTANT: @imgly builds URLs as `new URL(resource, publicPath)`. The URL constructor refuses
// a RELATIVE base ("Failed to construct 'URL': Invalid base URL"), so publicPath MUST be an
// absolute URL. Build it from location.origin so it works in dev and on the deployed site.

const MODEL_MAP = {
  fast: 'isnet_quint8',
  balanced: 'isnet_fp16',
  best: 'isnet',
};

let removeFn = null;

export async function removeBackground(srcBlob, { quality = 'fast', onProgress } = {}) {
  if (!removeFn) {
    const mod = await import('@imgly/background-removal');
    removeFn = mod.default || mod.removeBackground;
  }
  const model = MODEL_MAP[quality] || 'isnet_quint8';
  const publicPath = new URL('/imgly-data/1.7.0/dist/', location.origin).href;
  const blob = await removeFn(srcBlob, {
    model,
    publicPath,
    progress: (key, current, total) => {
      if (onProgress && total) onProgress(Math.round((current / total) * 100), key);
    },
  });
  return blob;
}
