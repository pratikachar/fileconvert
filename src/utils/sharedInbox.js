/**
 * Shared-file inbox (Web Share Target intake). Reads what the service worker
 * stashed at POST /_share, then routes each file to the tab that owns it:
 * images -> image editor, audio/video -> audio toolbox, PDFs -> PDF tools,
 * anything else -> file converter. Pure + DOM-free except routing callbacks.
 */

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fileforge-share', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('inbox', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Take-all + clear. Returns [{ name, type, blob }]. */
export async function takeInbox() {
  const db = await idbOpen();
  try {
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('inbox', 'readonly');
      const q = tx.objectStore('inbox').getAll();
      q.onsuccess = () => resolve(q.result || []);
      q.onerror = () => reject(q.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('inbox', 'readwrite');
      tx.objectStore('inbox').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return rows;
  } finally {
    db.close();
  }
}

const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();
const IMG = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const AUDVID = ['mp3', 'wav', 'ogg', 'oga', 'aac', 'm4a', 'flac', 'opus', 'wma', 'aiff', 'weba',
  'mp4', 'm4v', 'mov', 'mkv', 'avi', 'webm', 'flv', '3gp', 'ts', 'ogv'];

/**
 * Route shared rows to tabs. Callbacks keep this module UI-free and testable:
 * { toEditor(file), toAudio(files), toPdf(files), toConverter(file), toast(msg), gotoTab(id) }
 */
export function routeShared(rows, hooks) {
  const files = rows.map((r) => new File([r.blob], r.name || 'shared-file', { type: r.type || r.blob.type }));
  if (!files.length) return [];
  const imgs = files.filter((f) => IMG.includes(extOf(f.name)) || f.type.startsWith('image/'));
  const rest = files.filter((f) => !imgs.includes(f));
  const pdfs = rest.filter((f) => extOf(f.name) === 'pdf');
  const av = rest.filter((f) => !pdfs.includes(f) && (AUDVID.includes(extOf(f.name)) || /^(audio|video)\//.test(f.type)));
  const other = rest.filter((f) => !pdfs.includes(f) && !av.includes(f));
  const counts = [];
  if (imgs.length && hooks.toEditor) {
    // editor takes one image at a time - first wins, rest go to the converter tray
    hooks.toEditor(imgs[0]);
    counts.push(`${imgs.length} image${imgs.length === 1 ? '' : 's'} → editor`);
    other.push(...imgs.slice(1));
  }
  if (av.length && hooks.toAudio) {
    hooks.toAudio(av);
    counts.push(`${av.length} audio/video → toolbox`);
  }
  if (pdfs.length && hooks.toPdf) {
    hooks.toPdf(pdfs);
    counts.push(`${pdfs.length} PDF${pdfs.length === 1 ? '' : 's'} → PDF tools`);
  }
  if (other.length && hooks.toConverter) {
    hooks.toConverter(other[0]);
    counts.push(`${other[0].name} → converter`);
    if (other.length > 1 && hooks.toast) hooks.toast(`+${other.length - 1} more file(s) need manual opening.`);
  }
  if (hooks.gotoTab) {
    if (imgs.length) hooks.gotoTab('editor');
    else if (av.length) hooks.gotoTab('audio');
    else if (pdfs.length) hooks.gotoTab('pdf');
    else hooks.gotoTab('converter');
  }
  return counts;
}
