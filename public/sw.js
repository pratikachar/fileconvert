// FileForge service worker — network-only passthrough.
//
// Caching is intentionally DISABLED. The previous cache-first / stale-while-revalidate
// worker cached '/' and '/index.html' at install time and served them as a fallback,
// so after a deploy a stale index.html referencing old (404) JS bundles could be served
// on first load -> no tabs / no CSS until a reload. Since the app's features
// (FFmpeg.wasm, bg-removal models) fetch from CDNs anyway, a cached app shell buys little.
// Keeping a fetch handler keeps the PWA installable.

const CACHE = 'fileforge-v4';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
