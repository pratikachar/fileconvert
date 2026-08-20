import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      // Proxy @imgly background-removal model+wasm so the browser fetches it same-origin
      // (staticimgly.com sends no ACAO, which fails under COEP require-corp).
      '/imgly-data': {
        target: 'https://staticimgly.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/imgly-data/, '/@imgly/background-removal-data'),
      },
      // Proxy AI upscale ONNX models so the browser fetches them same-origin (COEP-safe).
      // Client requests /esrgan-data/resolve/main/<repo>/<file> -> https://huggingface.co/resolve/main/<repo>/<file>
      '/esrgan-data': {
        target: 'https://huggingface.co',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/esrgan-data/, ''),
      },
      // Fallback mirror for AI upscale models (GitHub via jsDelivr CDN, no anti-bot throttling).
      // Client requests /jsd-data/gh/<user>/<repo>@<ref>/<file> -> https://cdn.jsdelivr.net/gh/<user>/<repo>@<ref>/<file>
      '/jsd-data': {
        target: 'https://cdn.jsdelivr.net',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/jsd-data/, ''),
      },
      // Fallback for large AI upscale models (>20 MB jsDelivr limit) via raw GitHub.
      // Client requests /ghraw-data/<user>/<repo>/<ref>/<file> -> https://raw.githubusercontent.com/<user>/<repo>/<ref>/<file>
      '/ghraw-data': {
        target: 'https://raw.githubusercontent.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ghraw-data/, ''),
      },
    },
  },
  plugins: [
    {
      name: 'ort-wasm-strip-import-query',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          // onnxruntime-web dynamically imports the .mjs wrapper with a
          // Vite `?import` query (e.g. /ort/ort-wasm-simd-threaded.mjs?import).
          // Vite refuses to transform /public files (500). Strip the query so
          // the static file is served as-is; static hosts ignore it in prod.
          if (req.url && req.url.startsWith('/ort/') && req.url.includes('?import')) {
            req.url = req.url.replace('?import', '');
          }
          next();
        });
      },
    },
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@imgly/background-removal', 'onnxruntime-web'],
  },
});
