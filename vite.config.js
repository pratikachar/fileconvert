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
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@imgly/background-removal', 'onnxruntime-web'],
  },
});
