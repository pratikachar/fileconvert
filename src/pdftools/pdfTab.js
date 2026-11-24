/**
 * PDF Tools tab - merge, split/extract, images-to-PDF, rotate.
 * pdf-lib is lazy-imported (first PDF interaction) so the ~600 KB only
 * downloads when the tab is actually used. Pure logic in pdftools.js.
 */
import JSZip from 'jszip';
import { revealPanel } from '../utils/scrollPanel.js';

// pdf-lib (~600 KB) stays out of the main bundle: this module never imports
// pdftools.js statically. ensurePdfLib() dynamic-imports it on first need
// (warmed when the tab opens), so the engine downloads only on demand.
let pdfToolsMod = null;

/** Load the PDF engine on first need (also warmed when the tab opens). */
async function ensurePdfLib(onProgress = () => {}) {
  if (!pdfToolsMod) {
    onProgress('Loading the PDF engine…');
    pdfToolsMod = await import('./pdftools.js');
  }
  return pdfToolsMod;
}

const $ = (id) => document.getElementById(id);
const PDF_WARN_BYTES = 150 * 1024 * 1024;
const PDF_HARD_BYTES = 500 * 1024 * 1024;

export const PDF_TOOLS = [
  { id: 'merge', label: '🔗 Merge PDFs', short: '🔗 Merge' },
  { id: 'split', label: '✂️ Split / Extract', short: '✂️ Split' },
  { id: 'images', label: '🖼️ Images → PDF', short: '🖼️ Images' },
  { id: 'rotate', label: '🔄 Rotate Pages', short: '🔄 Rotate' },
  { id: 'watermark', label: '💧 Watermark', short: '💧 Mark' },
];

/**
 * The 3x3 position grid shown in the panel. pdftools.js owns the geometry;
 * this mirror only carries the labels and is asserted equal in the Node tests,
 * so the buttons can render before pdf-lib has finished downloading.
 */
export const WM_POS = [
  { id: 'tl', icon: '↖', label: 'Top left' },
  { id: 'tc', icon: '↑', label: 'Top' },
  { id: 'tr', icon: '↗', label: 'Top right' },
  { id: 'ml', icon: '←', label: 'Left' },
  { id: 'mc', icon: '•', label: 'Centre' },
  { id: 'mr', icon: '→', label: 'Right' },
  { id: 'bl', icon: '↙', label: 'Bottom left' },
  { id: 'bc', icon: '↓', label: 'Bottom' },
  { id: 'br', icon: '↘', label: 'Bottom right' },
];

/** Panel defaults (mirrors pdftools.watermarkDefaults(), asserted in tests). */
export const WM_DEFAULTS = {
  mode: 'text',
  text: 'WATERMARK',
  fontKey: 'Helvetica-Bold',
  sizePt: 48,
  color: '#808080',
  imagePct: 35,
  opacity: 18,
  angle: 45,
  marginPct: 6,
  count: 'one',
  position: 'mc',
  across: 3,
  down: 4,
};

/** Font ids -> CSS, for the preview only (the PDF uses the real font). */
const WM_FONT_CSS = {
  'Helvetica-Bold': { family: 'Helvetica, Arial, sans-serif', weight: 700 },
  Helvetica: { family: 'Helvetica, Arial, sans-serif', weight: 400 },
  'Times-Bold': { family: 'Times, "Times New Roman", serif', weight: 700 },
  'Times-Roman': { family: 'Times, "Times New Roman", serif', weight: 400 },
  'Courier-Bold': { family: '"Courier New", Courier, monospace', weight: 700 },
};

const PDF_WM_MAX_SIDE = 1600;

const state = {
  files: [],
  seq: 0,
  resSeq: 0,
  tool: 'merge',
  results: [],
  /** Remembered watermark settings, so switching tools never loses them. */
  wm: { ...WM_DEFAULTS },
  wmPages: 'all',
  wmFileId: null,
  wmImage: null,
};

function toast(msg) {
  let t = $('app-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'app-toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function extOf(name) {
  return (String(name).split('.').pop() || '').toLowerCase();
}

async function addFiles(list) {
  let added = 0;
  for (const file of list) {
    const ext = extOf(file.name);
    const kind = ext === 'pdf' ? 'pdf' : ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? 'image' : null;
    if (!kind) {
      toast(`Unsupported: ${file.name} (PDF, PNG, JPG, WEBP only)`);
      continue;
    }
    if (file.size > PDF_HARD_BYTES) {
      toast(`Skipped ${file.name}: over 500 MB is too big for in-browser work.`);
      continue;
    }
    if (file.size > PDF_WARN_BYTES) toast(`Large file loaded (${file.name}) - give it a moment.`);
    const row = {
      id: ++state.seq, file, name: file.name, ext, size: file.size, kind,
      pages: null, url: URL.createObjectURL(file),
    };
    state.files.push(row);
    added++;
    if (kind === 'pdf') {
      try {
        const PT = await ensurePdfLib();
        const info = await PT.pdfPageInfo(new Uint8Array(await file.arrayBuffer()));
        row.pageInfo = info;
        row.pages = info.pages;
      } catch {
        row.pages = null;
        row.pageInfo = null;
        toast(`${file.name}: not a readable PDF (encrypted or broken?).`);
      }
    }
    renderFileList();
    renderPdfTools();
    renderPdfPanel();
  }
  if (added) {
    $('pdf-upload-zone').classList.add('hidden');
    $('pdf-workspace').classList.remove('hidden');
  }
}

function pdfs() {
  return state.files.filter((f) => f.kind === 'pdf');
}

function images() {
  return state.files.filter((f) => f.kind === 'image');
}

export function setupPdfTab() {
  const zone = $('pdf-upload-zone');
  const input = $('pdf-file-input');
  zone.addEventListener('click', (e) => {
    if (e.target.closest('input, select, textarea, button, a')) return;
    input.click();
  });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    addFiles(Array.from(e.dataTransfer.files || []));
  });
  input.addEventListener('change', () => {
    addFiles(Array.from(input.files || []));
    input.value = '';
  });
  $('pdf-add-more').addEventListener('click', () => input.click());
  $('pdf-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.audio-tool-btn');
    if (!btn || btn.disabled) return;
    state.tool = btn.dataset.tool;
    renderPdfTools();
    renderPdfPanel();
    revealPanel($('pdf-panel'));
  });
  // Shorter rail labels on phones (rail only - the open panel is untouched).
  if (window.matchMedia) {
    window.matchMedia('(max-width: 640px)').addEventListener('change', () => renderPdfTools());
  }
  $('pdf-clear-results').addEventListener('click', clearResults);
  document.getElementById('tab-btn-pdf').addEventListener('click', () => {
    ensurePdfLib().catch(() => {});
  }, { once: true });
  window.__pdfAddFiles = addFiles;
  window.__pdfResults = () => state.results.map((r) => ({ name: r.name, size: r.size, url: r.url }));
  renderPdfTools();
  renderPdfPanel();
  renderResults();
}

function renderFileList() {
  const list = $('pdf-file-list');
  $('pdf-file-count').textContent = String(state.files.length);
  list.innerHTML = state.files.length ? state.files.map((f, i) =>
    `<div class="audio-result">
      <span class="ar-name">${i + 1}. ${escapeHtml(f.name)}</span>
      <span class="ar-meta">${f.kind === 'pdf' ? (f.pages != null ? `${f.pages} pages` : 'unreadable') : 'image'} · ${formatBytes(f.size)}</span>
      <span class="ar-actions">
        <button type="button" class="btn-secondary btn-mini" data-pdf-mv="up" data-i="${i}"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="btn-secondary btn-mini" data-pdf-mv="down" data-i="${i}"${i === state.files.length - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="btn-secondary btn-mini" data-pdf-mv="rm" data-i="${i}">✕</button>
      </span>
    </div>`).join('')
    : '<p class="audio-empty-note">No files yet.</p>';
  list.querySelectorAll('[data-pdf-mv]').forEach((b) => {
    b.addEventListener('click', () => {
      const i = +b.dataset.i;
      const mv = b.dataset.pdfMv;
      if (mv === 'up' && i > 0) [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]];
      else if (mv === 'down' && i < state.files.length - 1) [state.files[i + 1], state.files[i]] = [state.files[i], state.files[i + 1]];
      else if (mv === 'rm') {
        const [gone] = state.files.splice(i, 1);
        if (gone) URL.revokeObjectURL(gone.url);
      }
      if (!state.files.length) {
        $('pdf-workspace').classList.add('hidden');
        $('pdf-upload-zone').classList.remove('hidden');
      }
      renderFileList();
      renderPdfTools();
      renderPdfPanel();
    });
  });
}

function renderPdfTools() {
  const nPdf = pdfs().length;
  const nImg = images().length;
  const narrow = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  $('pdf-toolbar').innerHTML = PDF_TOOLS.map((t) => {
    let disabled = false;
    let why = '';
    if (t.id === 'merge') {
      disabled = nPdf < 2;
      why = 'Load at least 2 PDFs to merge them.';
    } else if (t.id === 'split' || t.id === 'rotate' || t.id === 'watermark') {
      disabled = nPdf < 1;
      why = 'Load a PDF first.';
    } else if (t.id === 'images') {
      disabled = nImg < 1;
      why = 'Load at least 1 image (PNG/JPG/WEBP).';
    }
    return `<button type="button" class="audio-tool-btn${state.tool === t.id ? ' active' : ''}" data-tool="${t.id}"${disabled ? ' disabled' : ''}${why && disabled ? ` title="${escapeHtml(why)}"` : ''}>${narrow && t.short ? t.short : t.label}</button>`;
  }).join('');
}

function fileOptions(list, selId) {
  return list.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}${f.pages != null ? ` (${f.pages}p)` : ''}</option>`).join('');
}

function setBusy(msg) {
  const run = $('pdf-run');
  if (run) run.disabled = true;
  $('pdf-status').textContent = msg;
}

function setIdle() {
  const run = $('pdf-run');
  if (run) run.disabled = false;
}

function renderPdfPanel() {
  const el = $('pdf-panel');
  const t = state.tool;

  if (t === 'merge') {
    const list = pdfs();
    el.innerHTML = `
      <p class="field-hint">Joins ${list.length} PDFs top-to-bottom into one file. Reorder with ↑ ↓ above.</p>
      <div class="editor-actions">
        <button type="button" class="btn-primary" id="pdf-run">Merge ${list.length} PDFs</button>
      </div>
      <p class="field-hint" id="pdf-status"></p>`;
    $('pdf-run').addEventListener('click', async () => {
      setBusy('Merging…');
      try {
        const PT = await ensurePdfLib(setBusy);
        const bufs = [];
        for (const f of pdfs()) bufs.push(new Uint8Array(await f.file.arrayBuffer()));
        const out = await PT.mergePdfs(bufs);
        addResult(`merged-${bufs.length}-pdfs.pdf`, out, 'application/pdf');
        $('pdf-status').textContent = 'Done!';
      } catch (err) {
        $('pdf-status').textContent = '';
        toast('Merge failed: ' + (err && err.message ? err.message : err));
      } finally {
        setIdle();
      }
    });
    return;
  }

  if (t === 'split') {
    const list = pdfs();
    el.innerHTML = `
      <label class="control-label" for="pdf-split-file">PDF</label>
      <select id="pdf-split-file" class="form-select">${fileOptions(list)}</select>
      <label class="control-label" for="pdf-split-range">Pages (e.g. 1-3,5 - "all" for everything)</label>
      <input type="text" id="pdf-split-range" class="form-input" value="1-3" />
      <div class="editor-actions">
        <button type="button" class="btn-primary btn-mini" id="pdf-run">Extract range</button>
        <button type="button" class="btn-secondary btn-mini" id="pdf-split-all">Split every page (.zip)</button>
      </div>
      <p class="field-hint" id="pdf-status">Split-all caps at 20 pages per run. (mirrors MAX_SPLIT_PAGES in pdftools.js)</p>`;
    const chosen = () => state.files.find((f) => f.id === +$('pdf-split-file').value);
    $('pdf-run').addEventListener('click', async () => {
      const f = chosen();
      if (!f) return;
      const PT = await ensurePdfLib();
      const spec = PT.parsePageSpec($('pdf-split-range').value, f.pages);
      if (!spec.ok) { toast(spec.error); return; }
      setBusy('Extracting…');
      try {
        await ensurePdfLib(setBusy);
        const out = await PT.extractPages(new Uint8Array(await f.file.arrayBuffer()), spec.pages);
        const base = f.name.replace(/\.pdf$/i, '');
        addResult(`${base}-pages-${$('pdf-split-range').value.replace(/[^0-9a-z,-]/gi, '')}.pdf`, out, 'application/pdf');
        $('pdf-status').textContent = 'Done!';
      } catch (err) {
        $('pdf-status').textContent = '';
        toast('Extract failed: ' + (err && err.message ? err.message : err));
      } finally {
        setIdle();
      }
    });
    $('pdf-split-all').addEventListener('click', async () => {
      const f = chosen();
      if (!f || f.pages == null) { toast('That PDF is unreadable.'); return; }
      const PT = await ensurePdfLib();
      if (f.pages > PT.MAX_SPLIT_PAGES) {
        toast(`That file has ${f.pages} pages - split-all caps at ${PT.MAX_SPLIT_PAGES} per run. Use a range instead.`);
        return;
      }
      setBusy('Splitting…');
      try {
        const PT = await ensurePdfLib(setBusy);
        const zip = new JSZip();
        const bytes = new Uint8Array(await f.file.arrayBuffer());
        const base = f.name.replace(/\.pdf$/i, '');
        for (let i = 0; i < f.pages; i++) {
          const one = await PT.extractPages(bytes, [i]);
          zip.file(`${base}-p${i + 1}.pdf`, one);
          $('pdf-status').textContent = `Page ${i + 1}/${f.pages}…`;
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${base}-split.zip`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
        $('pdf-status').textContent = 'Done!';
        toast(`${f.pages} pages saved to ZIP`);
      } catch (err) {
        $('pdf-status').textContent = '';
        toast('Split failed: ' + (err && err.message ? err.message : err));
      } finally {
        setIdle();
      }
    });
    return;
  }

  if (t === 'images') {
    el.innerHTML = `
      <p class="field-hint">Turns your ${images().length} loaded image(s) into one PDF, in file-list order.</p>
      <label class="control-label" for="pdf-img-mode">Page size</label>
      <select id="pdf-img-mode" class="form-select">
        <option value="fit" selected>Fit each photo (page = photo size)</option>
        <option value="a4">A4 sheets (photo centered)</option>
      </select>
      <div class="editor-actions">
        <button type="button" class="btn-primary" id="pdf-run">Build PDF</button>
      </div>
      <p class="field-hint" id="pdf-status"></p>`;
    $('pdf-run').addEventListener('click', async () => {
      setBusy('Building…');
      try {
        const PT = await ensurePdfLib(setBusy);
        const mode = $('pdf-img-mode').value;
        const imgs = [];
        for (const f of images()) {
          const bytes = new Uint8Array(await f.file.arrayBuffer());
          imgs.push({ bytes, mime: f.ext === 'png' ? 'image/png' : 'image/jpeg' });
        }
        const out = await PT.imagesToPdf(imgs, mode);
        addResult(`photos-${imgs.length}.pdf`, out, 'application/pdf');
        $('pdf-status').textContent = 'Done!';
      } catch (err) {
        $('pdf-status').textContent = '';
        toast('PDF build failed: ' + (err && err.message ? err.message : err));
      } finally {
        setIdle();
      }
    });
    return;
  }

  if (t === 'rotate') {
    const list = pdfs();
    el.innerHTML = `
      <label class="control-label" for="pdf-rot-file">PDF</label>
      <select id="pdf-rot-file" class="form-select">${fileOptions(list)}</select>
      <label class="control-label" for="pdf-rot-range">Pages ("all" or e.g. 1-3,5)</label>
      <input type="text" id="pdf-rot-range" class="form-input" value="all" />
      <label class="control-label" for="pdf-rot-angle">Turn</label>
      <select id="pdf-rot-angle" class="form-select">
        <option value="90" selected>90° clockwise</option>
        <option value="180">180°</option>
        <option value="270">270° (90° counter-clockwise)</option>
      </select>
      <div class="editor-actions">
        <button type="button" class="btn-primary" id="pdf-run">Rotate</button>
      </div>
      <p class="field-hint" id="pdf-status"></p>`;
    $('pdf-run').addEventListener('click', async () => {
      const f = state.files.find((x) => x.id === +$('pdf-rot-file').value);
      if (!f) return;
      const PT = await ensurePdfLib();
      const spec = PT.parsePageSpec($('pdf-rot-range').value, f.pages);
      if (!spec.ok) { toast(spec.error); return; }
      setBusy('Rotating…');
      try {
        await ensurePdfLib(setBusy);
        const out = await PT.rotatePages(new Uint8Array(await f.file.arrayBuffer()), spec.pages, +$('pdf-rot-angle').value);
        const base = f.name.replace(/\.pdf$/i, '');
        addResult(`${base}-rotated.pdf`, out, 'application/pdf');
        $('pdf-status').textContent = 'Done!';
      } catch (err) {
        $('pdf-status').textContent = '';
        toast('Rotate failed: ' + (err && err.message ? err.message : err));
      } finally {
        setIdle();
      }
    });
    return;
  }

  if (t === 'watermark') {
    renderWatermarkPanel(el);
  }
}

/* ---------------- watermark panel ---------------- */

function wmFile() {
  const list = pdfs();
  const hit = list.find((f) => f.id === state.wmFileId);
  return hit || list[0] || null;
}

function wmPageSize() {
  const f = wmFile();
  const info = f && f.pageInfo;
  const fallback = { pages: 0, width: 595.28, height: 841.89, rotation: 0 };
  return info || fallback;
}

/** Visible (reader-facing) page box, so 90/270 pages preview upright. */
function wmVisibleBox() {
  const pi = wmPageSize();
  const r = (((Number(pi.rotation) || 0) % 360) + 360) % 360;
  return r === 90 || r === 270
    ? { width: pi.height, height: pi.width, rotation: r }
    : { width: pi.width, height: pi.height, rotation: r };
}

function wmMetaText(f) {
  if (!f) return 'Load a PDF to watermark it.';
  const pi = f.pageInfo;
  if (!pi) return f.pages != null ? `${f.pages} page(s)` : 'Unreadable PDF.';
  const bits = [`${pi.pages} page${pi.pages === 1 ? '' : 's'}`, `${Math.round(pi.width)}×${Math.round(pi.height)} pt`];
  if (pi.rotation) bits.push(`page turned ${pi.rotation}°`);
  return bits.join(' · ');
}

function wmOptionsFromPanel() {
  const o = { ...state.wm };
  const text = $('pdf-wm-text');
  const size = $('pdf-wm-size');
  const across = $('pdf-wm-across');
  const down = $('pdf-wm-down');
  if (text) o.text = text.value;
  if (size) o.sizePt = Number(size.value);
  if (across) o.across = Number(across.value);
  if (down) o.down = Number(down.value);
  return o;
}

const wmSeg = (attr, value, current, label) =>
  `<button type="button" class="seg-btn${value === current ? ' active' : ''}" ${attr}="${value}">${label}</button>`;

function renderWatermarkPanel(el) {
  const list = pdfs();
  if (state.wmFileId == null || !list.some((f) => f.id === state.wmFileId)) {
    state.wmFileId = list[0] ? list[0].id : null;
  }
  const f = wmFile();
  const o = state.wm;
  const img = state.wmImage;
  const loadedImgs = images();
  const options = list.map((x) =>
    `<option value="${x.id}"${x.id === state.wmFileId ? ' selected' : ''}>${escapeHtml(x.name)}${x.pages != null ? ` (${x.pages}p)` : ''}</option>`).join('');

  el.innerHTML = `
    <label class="control-label" for="pdf-wm-file">PDF</label>
    <select id="pdf-wm-file" class="form-select">${options}</select>
    <label class="control-label" for="pdf-wm-range">Pages ("all" or e.g. 1-3,5)</label>
    <input type="text" id="pdf-wm-range" class="form-input" value="${escapeHtml(state.wmPages || 'all')}" />
    <p class="field-hint" id="pdf-wm-meta">${escapeHtml(wmMetaText(f))}</p>

    <label class="control-label">Watermark type</label>
    <div class="seg-row">
      ${wmSeg('data-wm-mode', 'text', o.mode, '🔤 Text')}
      ${wmSeg('data-wm-mode', 'image', o.mode, '🖼️ Image')}
    </div>

    <div id="pdf-wm-text-box" class="${o.mode === 'text' ? '' : 'hidden'}">
      <label class="control-label" for="pdf-wm-text">Text</label>
      <input type="text" id="pdf-wm-text" class="form-input" maxlength="120"
        value="${escapeHtml(o.text)}" placeholder="WATERMARK" />
      <div class="wm-two-col">
        <div>
          <label class="control-label" for="pdf-wm-font">Font</label>
          <select id="pdf-wm-font" class="form-select">
            <option value="Helvetica-Bold"${o.fontKey === 'Helvetica-Bold' ? ' selected' : ''}>Bold sans</option>
            <option value="Helvetica"${o.fontKey === 'Helvetica' ? ' selected' : ''}>Sans</option>
            <option value="Times-Bold"${o.fontKey === 'Times-Bold' ? ' selected' : ''}>Bold serif</option>
            <option value="Times-Roman"${o.fontKey === 'Times-Roman' ? ' selected' : ''}>Serif</option>
            <option value="Courier-Bold"${o.fontKey === 'Courier-Bold' ? ' selected' : ''}>Bold typewriter</option>
          </select>
        </div>
        <div>
          <label class="control-label" for="pdf-wm-size">Size (pt)</label>
          <input type="number" id="pdf-wm-size" class="form-input" min="4" max="400" step="1" value="${o.sizePt}" />
        </div>
      </div>
      <label class="control-label">Colour</label>
      <div class="wm-color-row">
        <input type="color" id="pdf-wm-color" value="${escapeHtml(o.color)}" />
        <span class="wm-hex" id="pdf-wm-color-v">${escapeHtml(o.color)}</span>
      </div>
    </div>

    <div id="pdf-wm-image-box" class="${o.mode === 'image' ? '' : 'hidden'}">
      <label class="control-label">Watermark image</label>
      <div class="wm-img-row">
        ${img ? `<img class="wm-img-thumb" src="${img.url}" alt="" />` : '<span class="wm-img-none">No image yet</span>'}
        <span class="wm-img-meta">${img ? `${escapeHtml(img.name)} · ${img.width}×${img.height}` : 'PNG, JPG or WEBP'}</span>
      </div>
      <div class="editor-actions">
        <button type="button" class="btn-secondary btn-mini" id="pdf-wm-pick">Choose image…</button>
      </div>
      ${loadedImgs.length ? `
        <label class="control-label" for="pdf-wm-loaded">…or use a loaded image</label>
        <select id="pdf-wm-loaded" class="form-select">
          <option value="">Pick one of your files</option>
          ${loadedImgs.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('')}
        </select>` : ''}
      <label class="control-label" for="pdf-wm-imgpct">Image width — <span class="range-val" id="pdf-wm-imgpct-v">${o.imagePct}% of the page</span></label>
      <input type="range" id="pdf-wm-imgpct" min="2" max="100" step="1" value="${o.imagePct}" />
    </div>

    <label class="control-label">How many</label>
    <div class="seg-row">
      ${wmSeg('data-wm-count', 'one', o.count, 'One per page')}
      ${wmSeg('data-wm-count', 'tile', o.count, 'Tile grid')}
    </div>
    <div id="pdf-wm-tile-row" class="wm-two-col${o.count === 'tile' ? '' : ' hidden'}">
      <div>
        <label class="control-label" for="pdf-wm-across">Marks across</label>
        <input type="number" id="pdf-wm-across" class="form-input" min="1" max="8" step="1" value="${o.across}" />
      </div>
      <div>
        <label class="control-label" for="pdf-wm-down">Marks down</label>
        <input type="number" id="pdf-wm-down" class="form-input" min="1" max="12" step="1" value="${o.down}" />
      </div>
    </div>

    <label class="control-label">Position</label>
    <div class="wm-pos-grid" id="pdf-wm-pos">
      ${WM_POS.map((p) => `<button type="button" class="wm-pos-btn${p.id === o.position ? ' active' : ''}"
        data-wm-pos="${p.id}" title="${p.label}" aria-label="${p.label}">${p.icon}</button>`).join('')}
    </div>

    <label class="control-label" for="pdf-wm-angle">Angle — <span class="range-val" id="pdf-wm-angle-v">${o.angle}°</span></label>
    <input type="range" id="pdf-wm-angle" min="-90" max="90" step="1" value="${o.angle}" />
    <label class="control-label" for="pdf-wm-opacity">Opacity — <span class="range-val" id="pdf-wm-opacity-v">${o.opacity}%</span></label>
    <input type="range" id="pdf-wm-opacity" min="2" max="100" step="1" value="${o.opacity}" />
    <label class="control-label" for="pdf-wm-margin">Margin — <span class="range-val" id="pdf-wm-margin-v">${o.marginPct}%</span></label>
    <input type="range" id="pdf-wm-margin" min="0" max="40" step="1" value="${o.marginPct}" />

    <label class="control-label">Quick presets</label>
    <div class="wm-preset-row">
      ${WATERMARK_PRESET_CHIPS.map((p) => `<button type="button" class="btn-secondary btn-mini" data-wm-preset="${p.id}">${p.label}</button>`).join('')}
    </div>

    <label class="control-label">Preview (page 1)</label>
    <div class="wm-preview-wrap">
      <div class="wm-page" id="pdf-wm-page"><div class="wm-layer" id="pdf-wm-layer"></div></div>
    </div>
    <p class="field-hint" id="pdf-wm-note"></p>

    <div class="editor-actions">
      <button type="button" class="btn-primary" id="pdf-run">${wmRunLabel()}</button>
    </div>
    <p class="field-hint" id="pdf-status"></p>`;

  // ---- wiring -------------------------------------------------------------
  $('pdf-wm-file').addEventListener('change', () => {
    state.wmFileId = +$('pdf-wm-file').value;
    renderPdfPanel();
  });
  $('pdf-wm-range').addEventListener('input', () => {
    state.wmPages = $('pdf-wm-range').value;
    const run = $('pdf-run');
    if (run) run.textContent = wmRunLabel();
  });

  el.querySelectorAll('[data-wm-mode]').forEach((b) => b.addEventListener('click', () => {
    state.wm.mode = b.dataset.wmMode === 'image' ? 'image' : 'text';
    renderPdfPanel();
  }));
  el.querySelectorAll('[data-wm-count]').forEach((b) => b.addEventListener('click', () => {
    state.wm.count = b.dataset.wmCount === 'tile' ? 'tile' : 'one';
    renderPdfPanel();
  }));
  el.querySelectorAll('[data-wm-pos]').forEach((b) => b.addEventListener('click', () => {
    state.wm.position = b.dataset.wmPos;
    el.querySelectorAll('[data-wm-pos]').forEach((x) => x.classList.toggle('active', x === b));
    updateWmPreview();
  }));
  el.querySelectorAll('[data-wm-preset]').forEach((b) => b.addEventListener('click', () => {
    const preset = WATERMARK_PRESET_CHIPS.find((p) => p.id === b.dataset.wmPreset);
    if (!preset) return;
    state.wm.text = preset.text;
    state.wm.mode = 'text';
    renderPdfPanel();
  }));

  // Text inputs: keep state, refresh the preview only (no re-render = no lost focus).
  const bindText = (id, key, transform = (v) => v) => {
    const input = $(id);
    if (!input) return;
    input.addEventListener('input', () => {
      state.wm[key] = transform(input.value);
      updateWmPreview();
    });
  };
  bindText('pdf-wm-text', 'text');
  bindText('pdf-wm-size', 'sizePt', (v) => Number(v));
  bindText('pdf-wm-across', 'across', (v) => Number(v));
  bindText('pdf-wm-down', 'down', (v) => Number(v));
  const fontSel = $('pdf-wm-font');
  if (fontSel) fontSel.addEventListener('change', () => { state.wm.fontKey = fontSel.value; updateWmPreview(); });
  const colorInput = $('pdf-wm-color');
  if (colorInput) colorInput.addEventListener('input', () => {
    state.wm.color = colorInput.value;
    const label = $('pdf-wm-color-v');
    if (label) label.textContent = colorInput.value;
    updateWmPreview();
  });

  const bindRange = (id, key, suffix, fmt = (v) => `${v}${suffix}`) => {
    const input = $(id);
    if (!input) return;
    input.addEventListener('input', () => {
      state.wm[key] = Number(input.value);
      const label = $(`${id}-v`);
      if (label) label.textContent = fmt(Number(input.value));
      updateWmPreview();
    });
  };
  bindRange('pdf-wm-angle', 'angle', '°');
  bindRange('pdf-wm-opacity', 'opacity', '%');
  bindRange('pdf-wm-margin', 'marginPct', '%');
  bindRange('pdf-wm-imgpct', 'imagePct', '%', (v) => `${v}% of the page`);

  // Image source
  const pickBtn = $('pdf-wm-pick');
  if (pickBtn) pickBtn.addEventListener('click', () => pickWmImage());
  const loadedSel = $('pdf-wm-loaded');
  if (loadedSel) loadedSel.addEventListener('change', async () => {
    const row = state.files.find((x) => x.id === +loadedSel.value);
    if (!row) return;
    await useImageFile(row.file);
  });

  $('pdf-run').addEventListener('click', runWatermark);
  updateWmPreview();
}

const WATERMARK_PRESET_CHIPS = [
  { id: 'recommended', label: 'Recommended', text: 'WATERMARK' },
  { id: 'confidential', label: 'Confidential', text: 'CONFIDENTIAL' },
  { id: 'draft', label: 'Draft', text: 'DRAFT' },
  { id: 'donotcopy', label: 'Do not copy', text: 'DO NOT COPY' },
];

function wmRunLabel() {
  const spec = String(state.wmPages || 'all').trim().toLowerCase();
  return !spec || spec === 'all' ? 'Watermark every page' : 'Watermark these pages';
}

/** Live, page-shaped preview. Uses the engine's own placement maths. */
function updateWmPreview() {
  const pageEl = $('pdf-wm-page');
  const layer = $('pdf-wm-layer');
  if (!pageEl || !layer) return;
  const PT = pdfToolsMod;
  if (!PT) return;

  const box = wmVisibleBox();
  const scale = Math.min(260 / box.width, 210 / box.height);
  const pxW = Math.max(60, Math.round(box.width * scale));
  pageEl.style.width = `${pxW}px`;
  pageEl.style.height = `${Math.max(60, Math.round(box.height * scale))}px`;

  const o = wmOptionsFromPanel();
  const norm = PT.normalizeWatermarkOptions(o, { hasImage: !!(state.wmImage && state.wmImage.bytes) });
  const opts = norm.ok ? norm.opts : { ...WM_DEFAULTS, ...o };
  const centres = PT.watermarkCentres({
    pageWidth: box.width,
    pageHeight: box.height,
    count: opts.count,
    position: opts.position,
    marginPct: opts.marginPct,
    across: opts.across,
    down: opts.down,
  });

  const cssFont = WM_FONT_CSS[opts.fontKey] || WM_FONT_CSS['Helvetica-Bold'];
  const nodes = centres.map(() => {
    if (opts.mode === 'image' && state.wmImage) {
      const img = document.createElement('img');
      img.className = 'wm-mark';
      img.src = state.wmImage.url;
      img.alt = '';
      return img;
    }
    const span = document.createElement('span');
    span.className = 'wm-mark';
    span.textContent = opts.text || 'WATERMARK';
    return span;
  });
  layer.replaceChildren(...nodes);

  nodes.forEach((node) => {
    if (node.tagName === 'IMG') {
      node.style.width = `${(opts.imagePct / 100) * pxW}px`;
      node.style.height = 'auto';
    } else {
      node.style.fontFamily = cssFont.family;
      node.style.fontWeight = String(cssFont.weight);
      node.style.fontSize = `${opts.sizePt * scale}px`;
      node.style.color = opts.color;
    }
    node.style.opacity = String(opts.opacity / 100);
    node.style.transform = `rotate(${-opts.angle}deg)`;
  });

  // Position after layout so a rotated mark stays centred on its anchor.
  nodes.forEach((node, i) => {
    const c = centres[i];
    const w = node.offsetWidth || 0;
    const h = node.offsetHeight || 0;
    node.style.left = `${c.x * scale - w / 2}px`;
    node.style.top = `${(box.height - c.y) * scale - h / 2}px`;
  });

  const note = $('pdf-wm-note');
  if (note) {
    const tooWide = opts.count === 'one' && nodes.length && nodes[0].offsetWidth > pxW;
    if (!norm.ok) {
      note.textContent = norm.error;
      note.classList.add('tt-err');
    } else if (tooWide) {
      note.textContent = 'That text is wider than the page - lower the size, or switch to the tile grid.';
      note.classList.add('tt-err');
    } else {
      const pages = wmPageSize().pages;
      note.classList.remove('tt-err');
      note.textContent = `Approximate preview of page 1${pages > 1 ? ` of ${pages}` : ''} - the PDF gets the exact size, angle and opacity.`;
    }
  }
}

/** Rasterise any picked image to PNG (pdf-lib only embeds PNG/JPEG) and cap it. */
async function fileToPngForPdf(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.max(bitmap.width, bitmap.height, 1);
  const scale = Math.min(1, PDF_WM_MAX_SIDE / side);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not read that image.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', width: w, height: h };
}

async function useImageFile(file) {
  if (!file) return;
  try {
    const png = await fileToPngForPdf(file);
    if (state.wmImage && state.wmImage.url) URL.revokeObjectURL(state.wmImage.url);
    state.wmImage = {
      ...png,
      name: file.name,
      url: URL.createObjectURL(new Blob([png.bytes], { type: 'image/png' })),
    };
    state.wm.mode = 'image';
    renderPdfPanel();
    toast(`${file.name} is the watermark image.`);
  } catch (err) {
    toast('Could not use that image: ' + (err && err.message ? err.message : err));
  }
}

function pickWmImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.remove();
    if (file) useImageFile(file);
  });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

/**
 * Lettering for scripts the standard-14 fonts cannot encode (Hindi, Chinese,
 * emoji...). Drawn on canvas at high density, then treated as an image mark
 * whose width matches the chosen point size on this page.
 */
async function textToPngForPdf(text, opts, visibleWidth) {
  const cssFont = WM_FONT_CSS[opts.fontKey] || WM_FONT_CSS['Helvetica-Bold'];
  const probe = document.createElement('canvas').getContext('2d');
  const probePx = 64;
  probe.font = `${cssFont.weight} ${probePx}px ${cssFont.family}`;
  const perPt = Math.max(0.01, probe.measureText(text).width / probePx);
  const pxPerPt = Math.min(8, 3200 / Math.max(1, perPt * opts.sizePt));
  const sizePx = Math.max(6, Math.round(opts.sizePt * pxPerPt));

  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  ctx.font = `${cssFont.weight} ${sizePx}px ${cssFont.family}`;
  const metrics = ctx.measureText(text);
  const pad = Math.ceil(sizePx * 0.1);
  const w = Math.ceil(metrics.width + pad * 2);
  const h = Math.ceil((metrics.actualBoundingBoxAscent || sizePx) + (metrics.actualBoundingBoxDescent || 0) + pad * 2);
  canvas.width = w;
  canvas.height = h;
  ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.font = `${cssFont.weight} ${sizePx}px ${cssFont.family}`;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, pad, pad + (metrics.actualBoundingBoxAscent || sizePx));

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not render that text.');
  const widthPt = w / pxPerPt;
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mime: 'image/png',
    imagePct: Math.min(100, (widthPt / visibleWidth) * 100),
    widthPt,
  };
}

async function runWatermark() {
  const f = wmFile();
  if (!f) return;
  const PT = await ensurePdfLib();
  const spec = PT.parsePageSpec($('pdf-wm-range').value, f.pages);
  if (!spec.ok) { toast(spec.error); return; }

  const o = wmOptionsFromPanel();
  state.wm = { ...o };
  const wanted = PT.normalizeWatermarkOptions(o, { hasImage: !!(state.wmImage && state.wmImage.bytes) });
  if (!wanted.ok) { toast(wanted.error); return; }

  setBusy('Reading the PDF…');
  try {
    const bytes = new Uint8Array(await f.file.arrayBuffer());
    let opts = { ...wanted.opts, pages: spec.pages };
    let note = '';
    if (opts.mode === 'image') {
      opts.imageBytes = state.wmImage.bytes;
      opts.imageMime = 'image/png';
    } else if (!(await PT.canEncodeStandardText(opts.text, opts.fontKey))) {
      const vis = wmVisibleBox();
      const png = await textToPngForPdf(opts.text, opts, vis.width);
      opts = { ...opts, mode: 'image', imageBytes: png.bytes, imageMime: 'image/png', imagePct: png.imagePct };
      note = ' Non-Latin text is drawn as an image so any script or emoji works.';
    }

    setBusy(`Stamping ${spec.pages.length} page${spec.pages.length === 1 ? '' : 's'}…`);
    const out = await PT.applyWatermark(bytes, opts, {
      onProgress: (done, total) => setBusy(`Stamping page ${done}/${total}…`),
    });
    const base = f.name.replace(/\.pdf$/i, '');
    addResult(`${base}-watermarked.pdf`, out, 'application/pdf');
    const status = $('pdf-status');
    if (status) status.textContent = `Watermarked ${spec.pages.length} page${spec.pages.length === 1 ? '' : 's'}.${note}`;
    toast(`Watermarked ${spec.pages.length} page${spec.pages.length === 1 ? '' : 's'}.`);
  } catch (err) {
    const status = $('pdf-status');
    if (status) status.textContent = '';
    toast('Watermark failed: ' + (err && err.message ? err.message : err));
  } finally {
    setIdle();
  }
}

function addResult(name, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  state.results.push({
    id: ++state.resSeq, name, mime, blob,
    url: URL.createObjectURL(blob), size: blob.size,
  });
  renderResults();
}

function renderResults() {
  const wrap = $('pdf-results');
  if (!state.results.length) {
    wrap.innerHTML = '<p class="audio-empty-note">No results yet.</p>';
    return;
  }
  wrap.innerHTML = state.results.map((r) => `
    <div class="audio-result">
      <span class="af-icon">📄</span>
      <span class="ar-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
      <span class="ar-meta">${formatBytes(r.size)}</span>
      <span class="ar-actions">
        <button type="button" class="btn-primary btn-mini" data-pdf-dl="${r.id}">⬇</button>
      </span>
    </div>`).join('');
  wrap.querySelectorAll('[data-pdf-dl]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = state.results.find((x) => x.id === +b.dataset.pdfDl);
      if (!r) return;
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    });
  });
}

function clearResults() {
  for (const r of state.results) URL.revokeObjectURL(r.url);
  state.results = [];
  renderResults();
}
