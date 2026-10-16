/**
 * PDF Tools tab - merge, split/extract, images-to-PDF, rotate.
 * pdf-lib is lazy-imported (first PDF interaction) so the ~600 KB only
 * downloads when the tab is actually used. Pure logic in pdftools.js.
 */
import JSZip from 'jszip';

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
];

const state = {
  files: [],
  seq: 0,
  resSeq: 0,
  tool: 'merge',
  results: [],
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
        row.pages = await PT.pdfPageCount(new Uint8Array(await file.arrayBuffer()));
      } catch {
        row.pages = null;
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
    } else if (t.id === 'split' || t.id === 'rotate') {
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
