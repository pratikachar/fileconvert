// Image Editor — orchestrates canvas, tools, history and export.
// All processing is client-side. Heavy ML libs are loaded on demand.

import { removeBackground } from './bgRemove.js';

const EDITOR_MAX_DIM = 2400;
const HISTORY_LIMIT = 25;

let editorCanvas, editorCtx, overlayEl, stageEl, loadingEl, loadingTextEl, controlsEl;
let toolBaseCanvas; // offscreen snapshot taken when a tool opens (for live preview)
let originalImageData = null;
let history = [];
let histIndex = -1;
let activeTool = null;
let toolState = {};

function toast(msg) {
  let t = document.getElementById('app-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'app-toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function $(id) { return document.getElementById(id); }

export function setupImageEditor() {
  editorCanvas = $('editor-canvas');
  editorCtx = editorCanvas.getContext('2d', { willReadFrequently: true });
  overlayEl = $('editor-overlay');
  stageEl = $('editor-stage');
  loadingEl = $('editor-loading');
  loadingTextEl = $('editor-loading-text');
  controlsEl = $('editor-controls');

  // Upload entry points
  $('editor-pick').addEventListener('click', () => $('editor-file').click());
  $('editor-file').addEventListener('change', (e) => {
    if (e.target.files[0]) loadImageFile(e.target.files[0]);
    e.target.value = '';
  });

  const empty = $('editor-empty');
  empty.addEventListener('dragover', (e) => { e.preventDefault(); empty.classList.add('dragover'); });
  empty.addEventListener('dragleave', () => empty.classList.remove('dragover'));
  empty.addEventListener('drop', (e) => {
    e.preventDefault();
    empty.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) loadImageFile(f);
  });

  // Toolbar
  $('editor-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tool-btn');
    if (!btn) return;
    openTool(btn.dataset.tool);
  });

  // History / reset
  $('editor-undo').addEventListener('click', undo);
  $('editor-redo').addEventListener('click', redo);
  $('editor-reset').addEventListener('click', resetAll);

  // Export
  $('editor-download').addEventListener('click', exportDownload);
  $('editor-copy').addEventListener('click', exportCopy);
  $('editor-share').addEventListener('click', exportShare);

  // Paste-to-upload (when editor tab is active)
  window.addEventListener('paste', (e) => {
    if ($('tab-content-editor').classList.contains('hidden')) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadImageFile(item.getAsFile());
  });
}

// ---------- Image loading ----------
function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, EDITOR_MAX_DIM / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      editorCanvas.width = width;
      editorCanvas.height = height;
      editorCtx.drawImage(img, 0, 0, width, height);
      originalImageData = editorCtx.getImageData(0, 0, width, height);
      history = [originalImageData];
      histIndex = 0;
      $('editor-empty').classList.add('hidden');
      $('editor-workspace').classList.remove('hidden');
      clearOverlay();
      closeTool();
      updateHistoryButtons();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// ---------- History ----------
function snapshot() {
  return editorCtx.getImageData(0, 0, editorCanvas.width, editorCanvas.height);
}
function pushHistory() {
  history = history.slice(0, histIndex + 1);
  history.push(snapshot());
  if (history.length > HISTORY_LIMIT) history.shift();
  histIndex = history.length - 1;
  updateHistoryButtons();
}
function undo() {
  if (histIndex > 0) {
    histIndex--;
    editorCtx.putImageData(history[histIndex], 0, 0);
    updateHistoryButtons();
  }
}
function redo() {
  if (histIndex < history.length - 1) {
    histIndex++;
    editorCtx.putImageData(history[histIndex], 0, 0);
    updateHistoryButtons();
  }
}
function resetAll() {
  if (originalImageData) {
    editorCtx.putImageData(originalImageData, 0, 0);
    history = [originalImageData];
    histIndex = 0;
    updateHistoryButtons();
    toast('Reset to original');
  }
}
function updateHistoryButtons() {
  $('editor-undo').disabled = histIndex <= 0;
  $('editor-redo').disabled = histIndex >= history.length - 1;
}

// ---------- Overlay helpers ----------
function clearOverlay() {
  // Clone to drop any listeners attached via addEventListener on a previous tool.
  const fresh = overlayEl.cloneNode(false);
  overlayEl.replaceWith(fresh);
  overlayEl = fresh;
  fresh.className = 'editor-overlay';
  fresh.style.cursor = 'default';
}
function canvasMetrics() {
  const rect = editorCanvas.getBoundingClientRect();
  const stageRect = stageEl.getBoundingClientRect();
  return {
    rect,
    stageRect,
    scale: editorCanvas.width / rect.width, // canvas px per displayed px
    leftInStage: rect.left - stageRect.left,
    topInStage: rect.top - stageRect.top,
  };
}
function clientToDisplay(e) {
  const { rect } = canvasMetrics();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ---------- Tool switching ----------
function closeTool() {
  activeTool = null;
  toolState = {};
  clearOverlay();
  controlsEl.innerHTML = '<p class="editor-hint">Pick a tool above to start editing.</p>';
}
function openTool(tool) {
  if (!editorCanvas.width) return;
  // snapshot current state as the preview base
  if (toolBaseCanvas) toolBaseCanvas.width = editorCanvas.width, (toolBaseCanvas.height = editorCanvas.height);
  else toolBaseCanvas = document.createElement('canvas');
  toolBaseCanvas.width = editorCanvas.width;
  toolBaseCanvas.height = editorCanvas.height;
  toolBaseCanvas.getContext('2d').drawImage(editorCanvas, 0, 0);
  activeTool = tool;
  clearOverlay();
  ({ filters: openFilters, text: openText, crop: openCrop, resize: openResize, compress: openCompress, bg: openBg }[tool] || closeTool)();
}

// ---------- Filters / Adjust ----------
function openFilters() {
  const s = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, blur: 0 };
  controlsEl.innerHTML = `
    <h3 class="controls-title">🎚️ Filters & Adjust</h3>
    ${slider('brightness', 'Brightness', 0, 200, 100, '%')}
    ${slider('contrast', 'Contrast', 0, 200, 100, '%')}
    ${slider('saturate', 'Saturation', 0, 200, 100, '%')}
    ${slider('grayscale', 'Grayscale', 0, 100, 0, '%')}
    ${slider('sepia', 'Sepia', 0, 100, 0, '%')}
    ${slider('blur', 'Blur', 0, 20, 0, 'px')}
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  const preview = () => {
    const fs = `brightness(${s.brightness}%) contrast(${s.contrast}%) saturate(${s.saturate}%) grayscale(${s.grayscale}%) sepia(${s.sepia}%) blur(${s.blur}px)`;
    editorCtx.filter = fs;
    editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    editorCtx.drawImage(toolBaseCanvas, 0, 0);
    editorCtx.filter = 'none';
  };
  controlsEl.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => {
      s[inp.dataset.k] = +inp.value;
      inp.nextElementSibling.textContent = inp.value + (inp.dataset.u || '');
      preview();
    });
  });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => { editorCtx.drawImage(toolBaseCanvas, 0, 0); closeTool(); });
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', () => { pushHistory(); closeTool(); });
}
function slider(k, label, min, max, val, u) {
  return `<label class="control-label">${label}</label>
    <input type="range" data-k="${k}" data-u="${u}" min="${min}" max="${max}" value="${val}">
    <span class="range-val">${val}${u}</span>`;
}

// ---------- Text ----------
const TEXT_EMOJIS = ['😀','😂','😍','😎','🤔','😢','😡','🤩','🥳','😴','👍','👎','👏','🙏','🤝','💪','🔥','⭐','❤️','💯','✅','❌','🎉','🎂','🚀','🌈','🌹','🍀','☀️','😺','🐶','🦋','⚽','🎵','📷','💡','⏰','💰'];
function openText() {
  const t = { text: '', font: 'Inter, sans-serif', size: 48, color: '#ffffff', bold: false, italic: false, x: 0.5, y: 0.5 };
  const div = document.createElement('div');
  div.className = 'text-overlay';
  div.style.position = 'absolute';
  div.style.cursor = 'move';
  overlayEl.appendChild(div);
  const render = () => {
    const m = canvasMetrics();
    const dsize = t.size / m.scale;
    div.textContent = t.text;
    div.style.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${dsize}px ${t.font}`;
    div.style.color = t.color;
    div.style.left = m.leftInStage + t.x * m.rect.width + 'px';
    div.style.top = m.topInStage + t.y * m.rect.height + 'px';
  };
  // Only the draggable overlay shows the text while editing; the canvas is left untouched
  // so Cancel removes the text completely and no doubled/overlapped glyphs can appear.
  const drawText = () => {
    editorCtx.drawImage(toolBaseCanvas, 0, 0);
    if (!t.text) return;
    editorCtx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.font}`;
    editorCtx.fillStyle = t.color;
    editorCtx.textBaseline = 'top';
    editorCtx.fillText(t.text, t.x * editorCanvas.width, t.y * editorCanvas.height);
  };
  let dragging = false, ox = 0, oy = 0;
  div.addEventListener('pointerdown', (e) => {
    dragging = true;
    const m = canvasMetrics();
    ox = e.clientX - (m.rect.left + t.x * m.rect.width);
    oy = e.clientY - (m.rect.top + t.y * m.rect.height);
    div.setPointerCapture(e.pointerId);
  });
  div.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const m = canvasMetrics();
    t.x = (e.clientX - ox - m.rect.left) / m.rect.width;
    t.y = (e.clientY - oy - m.rect.top) / m.rect.height;
    render();
  });
  div.addEventListener('pointerup', () => { dragging = false; });

  controlsEl.innerHTML = `
    <h3 class="controls-title">🔤 Add Text</h3>
    <label class="control-label">Text</label>
    <input type="text" id="t-text" class="form-input" placeholder="Type something…" value="">
    <button type="button" class="btn-secondary" id="t-emoji-toggle">😀 Emoji</button>
    <div id="t-emoji-picker" hidden></div>
    <label class="control-label">Font</label>
    <select id="t-font" class="form-select">
      <option value="Inter, sans-serif">Inter</option>
      <option value="Georgia, serif">Georgia</option>
      <option value="'Courier New', monospace">Courier</option>
      <option value="Impact, sans-serif">Impact</option>
      <option value="'Comic Sans MS', cursive">Comic Sans</option>
    </select>
    ${slider('size', 'Size', 10, 200, 48, 'px')}
    <label class="control-label">Color</label>
    <input type="color" id="t-color" value="${t.color}">
    <label class="control-inline"><input type="checkbox" id="t-bold"> Bold</label>
    <label class="control-inline"><input type="checkbox" id="t-italic"> Italic</label>
    <p class="editor-hint">Drag the text on the image to position it.</p>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  $('t-text').addEventListener('input', (e) => { t.text = e.target.value; render(); });
  $('t-font').addEventListener('change', (e) => { t.font = e.target.value; render(); });
  $('t-color').addEventListener('input', (e) => { t.color = e.target.value; render(); });
  $('t-bold').addEventListener('change', (e) => { t.bold = e.target.checked; render(); });
  $('t-italic').addEventListener('change', (e) => { t.italic = e.target.checked; render(); });
  controlsEl.querySelector('input[data-k=size]').addEventListener('input', (e) => {
    t.size = +e.target.value; e.target.nextElementSibling.textContent = e.target.value + 'px'; render();
  });
  $('t-emoji-toggle').addEventListener('click', () => {
    $('t-emoji-picker').hidden = !$('t-emoji-picker').hidden;
  });
  TEXT_EMOJIS.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-btn';
    b.textContent = em;
    b.addEventListener('click', () => {
      const inp = $('t-text');
      const pos = inp.selectionStart ?? inp.value.length;
      inp.value = inp.value.slice(0, pos) + em + inp.value.slice(pos);
      inp.focus();
      t.text = inp.value;
      render();
    });
    $('t-emoji-picker').appendChild(b);
  });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => { editorCtx.drawImage(toolBaseCanvas, 0, 0); closeTool(); });
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', () => {
    if (!t.text.trim()) { toast('Type some text or pick an emoji first'); return; }
    drawText();
    pushHistory(); closeTool();
  });
  render();
}

// ---------- Crop ----------
function openCrop() {
  const box = document.createElement('div');
  box.className = 'crop-box';
  overlayEl.appendChild(box);
  const m0 = canvasMetrics();
  let sel = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  const paint = () => {
    const m = canvasMetrics();
    box.style.left = m.leftInStage + sel.x * m.rect.width + 'px';
    box.style.top = m.topInStage + sel.y * m.rect.height + 'px';
    box.style.width = sel.w * m.rect.width + 'px';
    box.style.height = sel.h * m.rect.height + 'px';
  };
  paint();
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    const m = canvasMetrics();
    const px = (e.clientX - m.rect.left) / m.rect.width;
    const py = (e.clientY - m.rect.top) / m.rect.height;
    const hx = px < sel.x + sel.w / 2;
    const hy = py < sel.y + sel.h / 2;
    drag = { mode: hx ? 'w' : 'e', vmode: hy ? 'n' : 's', sx: px, sy: py, s: { ...sel } };
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const m = canvasMetrics();
    const px = Math.max(0, Math.min(1, (e.clientX - m.rect.left) / m.rect.width));
    const py = Math.max(0, Math.min(1, (e.clientY - m.rect.top) / m.rect.height));
    const s = drag.s;
    if (drag.mode === 'w') { sel.x = Math.min(px, s.x + s.w - 0.02); sel.w = s.x + s.w - sel.x; }
    else { sel.w = Math.max(0.02, px - s.x); }
    if (drag.vmode === 'n') { sel.y = Math.min(py, s.y + s.h - 0.02); sel.h = s.y + s.h - sel.y; }
    else { sel.h = Math.max(0.02, py - s.y); }
    paint();
  });
  box.addEventListener('pointerup', () => { drag = null; });
  overlayEl.style.cursor = 'crosshair';

  controlsEl.innerHTML = `
    <h3 class="controls-title">✂️ Crop</h3>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply Crop</button>
    </div>`;
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => { editorCtx.drawImage(toolBaseCanvas, 0, 0); closeTool(); });
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', () => {
    const m = canvasMetrics();
    const sx = Math.round(sel.x * editorCanvas.width);
    const sy = Math.round(sel.y * editorCanvas.height);
    const sw = Math.round(sel.w * editorCanvas.width);
    const sh = Math.round(sel.h * editorCanvas.height);
    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    out.getContext('2d').drawImage(editorCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    editorCanvas.width = sw; editorCanvas.height = sh;
    editorCtx.drawImage(out, 0, 0);
    pushHistory(); closeTool();
  });
}

// ---------- Resize ----------
function openResize() {
  const lock = true;
  const w0 = editorCanvas.width, h0 = editorCanvas.height;
  controlsEl.innerHTML = `
    <h3 class="controls-title">📐 Resize</h3>
    <label class="control-label">Width (px)</label>
    <input type="number" id="r-w" class="form-input" value="${w0}">
    <label class="control-label">Height (px)</label>
    <input type="number" id="r-h" class="form-input" value="${h0}">
    <label class="control-inline"><input type="checkbox" id="r-lock" ${lock ? 'checked' : ''}> Keep aspect ratio</label>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  const wIn = $('r-w'), hIn = $('r-h'), lockIn = $('r-lock');
  wIn.addEventListener('input', () => {
    if (lockIn.checked) hIn.value = Math.round((+wIn.value / w0) * h0);
  });
  hIn.addEventListener('input', () => {
    if (lockIn.checked) wIn.value = Math.round((+hIn.value / h0) * w0);
  });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => closeTool());
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', () => {
    const w = Math.max(1, +wIn.value || w0), h = Math.max(1, +hIn.value || h0);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(editorCanvas, 0, 0, w, h);
    editorCanvas.width = w; editorCanvas.height = h;
    editorCtx.drawImage(out, 0, 0);
    pushHistory(); closeTool();
  });
}

// ---------- Compress ----------
function openCompress() {
  controlsEl.innerHTML = `
    <h3 class="controls-title">🗜️ Compress</h3>
    <label class="control-label">Quality</label>
    <input type="range" id="c-q" min="10" max="100" value="80">
    <span class="range-val" id="c-qv">80%</span>
    <label class="control-label">Target size (KB, optional)</label>
    <input type="number" id="c-kb" class="form-input" placeholder="e.g. 200">
    <p class="editor-hint">PNG is lossless; for real size reduction choose JPG or WEBP below.</p>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  const q = $('c-q'), qv = $('c-qv');
  q.addEventListener('input', () => (qv.textContent = q.value + '%'));
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => closeTool());
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', async () => {
    const fmt = $('editor-out-fmt').value;
    let quality = +q.value / 100;
    const targetKb = +$('c-kb').value;
    setLoading(true, 'Compressing…');
    try {
      let blob = await canvasToBlob(fmt, quality);
      if (targetKb && blob.size > targetKb * 1024) {
        let lo = 0.05, hi = quality;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          blob = await canvasToBlob(fmt === 'image/png' ? 'image/webp' : fmt, mid);
          if (blob.size > targetKb * 1024) hi = mid; else lo = mid;
        }
        if (fmt === 'image/png') $('editor-out-fmt').value = 'image/webp';
      }
      await blobToCanvas(blob);
      pushHistory();
      toast(`Compressed to ${(blob.size / 1024).toFixed(0)} KB`);
    } finally {
      setLoading(false); closeTool();
    }
  });
}

// ---------- Background removal ----------
function openBg() {
  controlsEl.innerHTML = `
    <h3 class="controls-title">🪄 Background Removal</h3>
    <label class="control-label">Model</label>
    <select id="bg-model" class="form-select">
      <option value="fast" selected>Fast (~40 MB) — free</option>
      <option value="balanced">Balanced (~80 MB)</option>
      <option value="best">Best (~160 MB)</option>
    </select>
    <p class="license-note" id="bg-license" hidden>
      Heavier models are free for <strong>non-commercial</strong> use. Commercial use may require an
      <a href="https://img.ly/learn/blog/background-removal-open-source" target="_blank" rel="noopener">@imgly license</a>.
      <label class="control-inline"><input type="checkbox" id="bg-accept"> I'm using this non-commercially</label>
    </p>
    <div class="editor-actions">
      <button class="btn-primary" id="bg-go">Remove Background</button>
    </div>`;
  const modelSel = $('bg-model');
  const licenseNote = $('bg-license');
  modelSel.addEventListener('change', () => {
    licenseNote.hidden = modelSel.value === 'fast';
  });
  $('bg-go').addEventListener('click', async () => {
    if (!licenseNote.hidden && !$('bg-accept').checked) {
      toast('Please confirm non-commercial use');
      return;
    }
    setLoading(true, 'Downloading model…');
    try {
      const srcBlob = await canvasToBlob('image/png', 1);
      const blob = await removeBackground(srcBlob, {
        quality: modelSel.value,
        onProgress: (p) => setLoading(true, `Loading model ${p}%`),
      });
      await blobToCanvas(blob);
      pushHistory();
      toast('Background removed');
    } catch (err) {
      toast('BG removal failed: ' + (err && err.message ? err.message : err));
      console.error('BG removal failed:', err);
    } finally {
      setLoading(false);
    }
  });
}

// ---------- Export ----------
function canvasToBlob(type, quality = 0.92) {
  return new Promise((res) => editorCanvas.toBlob((b) => res(b), type, quality));
}
function blobToCanvas(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      editorCanvas.width = img.width; editorCanvas.height = img.height;
      editorCtx.drawImage(img, 0, 0);
      res();
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(blob);
  });
}
async function exportDownload() {
  const fmt = $('editor-out-fmt').value;
  const blob = await canvasToBlob(fmt, fmt === 'image/png' ? 1 : 0.92);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fileforge-edited.${fmt.split('/')[1]}`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Downloaded');
}
async function exportCopy() {
  try {
    const blob = await canvasToBlob('image/png', 1);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied to clipboard');
  } catch {
    toast('Clipboard not supported');
  }
}
async function exportShare() {
  try {
    const blob = await canvasToBlob($('editor-out-fmt').value, 0.92);
    const file = new File([blob], 'fileforge-edited.png', { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'FileForge edit' });
    } else {
      toast('Sharing not supported on this device');
    }
  } catch (e) {
    if (e.name !== 'AbortError') toast('Share cancelled');
  }
}

function setLoading(on, text) {
  loadingEl.classList.toggle('hidden', !on);
  if (text) loadingTextEl.textContent = text;
}
