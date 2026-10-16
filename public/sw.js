// FileForge service worker - network-only passthrough.
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
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Web Share Target: another app shared files to us via POST /_share.
  // Stash them in IndexedDB and bounce to the app, which picks them up.
  if (event.request.method === 'POST' && url.pathname === '/_share') {
    event.respondWith(
      (async () => {
        try {
          const form = await event.request.formData();
          const files = form.getAll('files').filter((v) => v instanceof File);
          if (files.length) await idbPutAll(files);
        } catch {
          // fall through to the app anyway - it will report an empty inbox
        }
        return Response.redirect('/?shared=1', 303);
      })()
    );
    return;
  }
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});

// Minimal IndexedDB (mirrors src/utils/sharedInbox.js - kept dependency-free
// because classic service workers cannot import app modules).
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fileforge-share', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('inbox', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutAll(files) {
  const db = await idbOpen();
  try {
    await Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const tx = db.transaction('inbox', 'readwrite');
      tx.objectStore('inbox').put({ name: file.name, type: file.type, blob: file, time: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    })));
  } finally {
    db.close();
  }
}
