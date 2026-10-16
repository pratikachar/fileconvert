/**
 * Recent files for the converter tab. File blobs are kept in IndexedDB
 * (local only, never uploaded), metadata only in the list. Blobs over
 * RECENT_MAX_BYTES are skipped so one giant video cannot eat the quota.
 */

const DB = 'fileforge-files';
const STORE = 'recent';
export const RECENT_MAX = 8;
export const RECENT_MAX_BYTES = 10 * 1024 * 1024;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Remember a file. Returns true when stored, false when skipped (too big). */
export async function addRecent(file) {
  if (!file || file.size > RECENT_MAX_BYTES) return false;
  const db = await idbOpen();
  try {
    const entry = {
      name: file.name, type: file.type, size: file.size,
      blob: file, time: Date.now(),
    };
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.add(entry);
    // prune oldest beyond the cap (id order = insertion order)
    const keys = await new Promise((resolve, reject) => {
      const q = store.getAllKeys();
      q.onsuccess = () => resolve(q.result || []);
      q.onerror = () => reject(q.error);
    });
    if (keys.length > RECENT_MAX) {
      keys.slice(0, keys.length - RECENT_MAX).forEach((k) => store.delete(k));
    }
    await txDone(tx);
    return true;
  } finally {
    db.close();
  }
}

/** Newest-first metadata: [{ id, name, type, size, time }]. */
export async function listRecent() {
  const db = await idbOpen();
  try {
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const q = tx.objectStore(STORE).getAll();
      q.onsuccess = () => resolve(q.result || []);
      q.onerror = () => reject(q.error);
    });
    const ids = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const q = tx.objectStore(STORE).getAllKeys();
      q.onsuccess = () => resolve(q.result || []);
      q.onerror = () => reject(q.error);
    });
    return rows
      .map((r, i) => ({ id: ids[i], name: r.name, type: r.type, size: r.size, time: r.time }))
      .reverse();
  } finally {
    db.close();
  }
}

/** Full File for reopening (or null when gone). */
export async function getRecent(id) {
  const db = await idbOpen();
  try {
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const q = tx.objectStore(STORE).get(Number(id));
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => reject(q.error);
    });
    if (!row) return null;
    return new File([row.blob], row.name, { type: row.type });
  } finally {
    db.close();
  }
}

export async function clearRecent() {
  const db = await idbOpen();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}

/** "3 files · 2h ago" style relative time. */
export function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
