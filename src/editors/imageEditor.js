// Image Editor - orchestrates canvas, tools, history and export.
// All processing is client-side. Heavy ML libs are loaded on demand.

import { removeBackground } from './bgRemove.js';
import { inpaintMask, opencvSizeMB } from './magicRemove.js';
import { upscaleCanvas, UPSCALE_TIERS, UPSCALE_SCALES, estimateOutput, isHeavyScale, INPUT_CAP, ADV_INPUT_CAP } from './aiUpscale.js';
import { resizeLanczos } from './resample.js';
import { scanBuffer, formatFromName } from '../metadataRemover.js';
import JSZip from 'jszip';
import { extractPalette } from './palette.js';

const EDITOR_MAX_DIM = 2400;
const HISTORY_LIMIT = 25;

let editorCanvas, editorCtx, overlayEl, stageEl, loadingEl, loadingTextEl, controlsEl;
let toolBaseCanvas; // offscreen snapshot taken when a tool opens (for live preview)
let originalImageData = null;
let originalBlob = null; // original upload, kept for the EXIF viewer
let history = [];
let histIndex = -1;
let activeTool = null;
let toolState = {};
let activeCamStream = null; // live webcam preview, if the camera tool is open

/** Stop a running camera preview (tool switch, new upload). Tracks leak otherwise. */
function stopActiveCapture() {
  if (activeCamStream) {
    activeCamStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) { /* ignore */ } });
    activeCamStream = null;
  }
}

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

  // Upload entry points (explicit .click() from user gesture = APK WebView safe;
  // the input must NOT be display:none, see .editor-file-hidden in style.css)
  $('editor-pick').addEventListener('click', () => $('editor-file').click());
  $('editor-file').addEventListener('change', (e) => {
    if (e.target.files[0]) loadImageFile(e.target.files[0]);
    e.target.value = '';
  });

  const empty = $('editor-empty');
  // Tapping anywhere on the empty card (except the button itself, which
  // already triggers the picker) opens the file dialog - same as AI Cleaner.
  empty.addEventListener('click', (e) => {
    if (e.target.closest('input, select, textarea, a')) return;
    if (e.target.closest('#editor-pick')) return; // button handles itself
    $('editor-file').click();
  });
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
  stopActiveCapture();
  originalBlob = file;
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
      originalImageData = snapshot();
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
  return {
    w: editorCanvas.width,
    h: editorCanvas.height,
    data: editorCtx.getImageData(0, 0, editorCanvas.width, editorCanvas.height),
  };
}
/** Restore a snapshot, resizing the canvas first - putImageData alone cannot
 *  undo a tool that changed the canvas dimensions (crop, shape crop, collage). */
function restoreSnap(s) {
  if (editorCanvas.width !== s.w || editorCanvas.height !== s.h) {
    editorCanvas.width = s.w;
    editorCanvas.height = s.h;
  }
  editorCtx.putImageData(s.data, 0, 0);
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
    restoreSnap(history[histIndex]);
    updateHistoryButtons();
  }
}
function redo() {
  if (histIndex < history.length - 1) {
    histIndex++;
    restoreSnap(history[histIndex]);
    updateHistoryButtons();
  }
}
function resetAll() {
  if (originalImageData) {
    restoreSnap(originalImageData);
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
  stopActiveCapture();
  if (!editorCanvas.width) return;
  // snapshot current state as the preview base
  if (toolBaseCanvas) toolBaseCanvas.width = editorCanvas.width, (toolBaseCanvas.height = editorCanvas.height);
  else toolBaseCanvas = document.createElement('canvas');
  toolBaseCanvas.width = editorCanvas.width;
  toolBaseCanvas.height = editorCanvas.height;
  toolBaseCanvas.getContext('2d').drawImage(editorCanvas, 0, 0);
  activeTool = tool;
  clearOverlay();
  ({ filters: openFilters, text: openText, crop: openCrop, resize: openResize, compress: openCompress, bg: openBg, magic: openMagic, aiupscale: openAiUpscale,
    watermark: openWatermark, pixelate: openPixelate, shapecrop: openShapeCrop, meme: openMeme,
    gridsplit: openGridSplit, palette: openPalette, exif: openExif, collage: openCollage,
    camphoto: openCamPhoto }[tool] || closeTool)();
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
const RESIZE_METHODS = [
  { id: 'auto', label: 'Auto (recommended)', desc: 'Smooth bicubic - best all-round, instant.' },
  { id: 'crisp', label: 'Crisp (Lanczos-3)', desc: 'Sharpest detail for up & downscale - slower on big images.' },
  { id: 'pixel', label: 'Pixel-art (nearest)', desc: 'Hard pixels, no smoothing - for sprites & pixel art.' },
];

function openResize() {
  const w0 = editorCanvas.width, h0 = editorCanvas.height;
  const methodCards = RESIZE_METHODS.map((m, i) => `
    <label class="choice-card">
      <input type="radio" name="r-method" value="${m.id}" ${i === 0 ? 'checked' : ''}>
      <span class="choice-body">
        <span class="choice-title">${m.label}</span>
        <span class="choice-desc">${m.desc}</span>
      </span>
    </label>`).join('');
  controlsEl.innerHTML = `
    <h3 class="controls-title">📐 Resize</h3>
    <label class="control-label">Method</label>
    ${methodCards}
    <div class="resize-presets">
      ${[0.5, 1, 2, 4].map((f) => `<button type="button" class="preset-chip" data-f="${f}">${f}×</button>`).join('')}
    </div>
    <label class="control-label">Width (px)</label>
    <input type="number" id="r-w" class="form-input" value="${w0}">
    <label class="control-label">Height (px)</label>
    <input type="number" id="r-h" class="form-input" value="${h0}">
    <label class="control-inline"><input type="checkbox" id="r-lock" checked> Keep aspect ratio</label>
    <p class="editor-hint" id="r-readout"></p>
    <p class="editor-hint">Want real detail? Try <strong>✨ AI Upscale</strong> instead.</p>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  const wIn = $('r-w'), hIn = $('r-h'), lockIn = $('r-lock'), readout = $('r-readout');
  const readoutFmt = () => {
    const w = Math.max(1, +wIn.value || w0), h = Math.max(1, +hIn.value || h0);
    const mp = ((w * h) / 1e6).toFixed(1);
    readout.textContent = `${w} × ${h} px · ${mp} MP` + (w * h > 40e6 ? ' - ⚠ over 40 MP' : '');
  };
  wIn.addEventListener('input', () => { if (lockIn.checked) hIn.value = Math.round((+wIn.value / w0) * h0); readoutFmt(); });
  hIn.addEventListener('input', () => { if (lockIn.checked) wIn.value = Math.round((+hIn.value / h0) * w0); readoutFmt(); });
  controlsEl.querySelectorAll('.preset-chip').forEach((b) => b.addEventListener('click', () => {
    const f = +b.dataset.f;
    wIn.value = Math.round(w0 * f);
    hIn.value = Math.round(h0 * f);
    readoutFmt();
  }));
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => closeTool());
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', async () => {
    const method = controlsEl.querySelector('input[name=r-method]:checked').value;
    const w = Math.max(1, +wIn.value || w0), h = Math.max(1, +hIn.value || h0);
    if (method === 'crisp') {
      setLoading(true, 'Resizing (Lanczos-3)…');
      try {
        const base = toolBaseCanvas.getContext('2d');
        const src = base.getImageData(0, 0, toolBaseCanvas.width, toolBaseCanvas.height).data;
        const dst = resizeLanczos(src, toolBaseCanvas.width, toolBaseCanvas.height, w, h, (pct) => setLoading(true, `Resizing (Lanczos-3)… ${pct}%`));
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        out.getContext('2d').putImageData(new ImageData(dst, w, h), 0, 0);
        editorCanvas.width = w; editorCanvas.height = h;
        editorCtx.drawImage(out, 0, 0);
      } finally { setLoading(false); }
    } else {
      editorCanvas.width = w; editorCanvas.height = h;
      if (method === 'pixel') {
        editorCtx.imageSmoothingEnabled = false;
        editorCtx.imageSmoothingQuality = 'low';
      } else {
        editorCtx.imageSmoothingEnabled = true;
        editorCtx.imageSmoothingQuality = 'high';
      }
      editorCtx.drawImage(toolBaseCanvas, 0, 0, w, h);
    }
    pushHistory(); closeTool();
    toast(`Resized to ${w} × ${h}`);
  });
  readoutFmt();
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

// ---------- Magic Remove (OpenCV inpaint) ----------
function openMagic() {
  // The mask lives in its own canvas so Cancel is a single clearRect and the
  // painted region can be read back as raw alpha for cv.inpaint.
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = editorCanvas.width;
  maskCanvas.height = editorCanvas.height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

  const view = document.createElement('canvas');
  view.className = 'magic-mask-view';
  overlayEl.appendChild(view);
  overlayEl.style.cursor = 'crosshair';

  const s = { size: 28, radius: 5, grow: 2, method: 'telea' };
  const paint = () => {
    const m = canvasMetrics();
    view.style.left = m.leftInStage + 'px';
    view.style.top = m.topInStage + 'px';
    view.style.width = m.rect.width + 'px';
    view.style.height = m.rect.height + 'px';
    view.width = editorCanvas.width;
    view.height = editorCanvas.height;
    view.getContext('2d').drawImage(maskCanvas, 0, 0);
  };
  paint();

  let painting = false;
  let last = null;
  const toCanvas = (e) => {
    const m = canvasMetrics();
    return {
      x: ((e.clientX - m.rect.left) / m.rect.width) * editorCanvas.width,
      y: ((e.clientY - m.rect.top) / m.rect.height) * editorCanvas.height,
    };
  };
  const stroke = (from, to) => {
    maskCtx.strokeStyle = 'rgba(255, 64, 96, 0.55)';
    maskCtx.lineWidth = s.size;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    maskCtx.beginPath();
    maskCtx.moveTo(from.x, from.y);
    maskCtx.lineTo(to.x, to.y);
    maskCtx.stroke();
  };
  // Pointer capture can reject (synthetic events, an already-released pointer).
  // Losing capture only means the stroke ends early - it must never abort painting.
  const capture = (e) => { try { overlayEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } };
  overlayEl.addEventListener('pointerdown', (e) => {
    painting = true;
    last = toCanvas(e);
    stroke(last, last);
    capture(e);
    paint();
    updateNote();
    e.preventDefault();
  });
  overlayEl.addEventListener('pointermove', (e) => {
    if (!painting) return;
    const p = toCanvas(e);
    stroke(last, p);
    last = p;
    paint();
  });
  const endStroke = () => {
    if (!painting) return;
    painting = false;
    updateNote();
  };
  overlayEl.addEventListener('pointerup', endStroke);
  overlayEl.addEventListener('pointercancel', endStroke);
  overlayEl.addEventListener('pointerleave', endStroke);

  controlsEl.innerHTML = `
    <h3 class="controls-title">🩹 Magic Remove</h3>
    <p class="editor-hint">Paint over the object to remove. Red = the area that gets filled in from its surroundings.</p>
    ${slider('size', 'Brush size', 4, 120, 28, 'px')}
    <div class="editor-actions">
      <button type="button" class="btn-secondary" id="mg-clear">Clear mask</button>
      <button type="button" class="btn-secondary" data-act="cancel">Cancel</button>
    </div>
    ${slider('radius', 'Fill radius', 1, 25, 5, 'px')}
    ${slider('grow', 'Grow mask', 0, 25, 2, 'px')}
    <label class="control-label">Method</label>
    <div class="seg-row">
      <button type="button" class="seg-btn active" data-mg-m="telea">Telea (sharp)</button>
      <button type="button" class="seg-btn" data-mg-m="ns">Navier-Stokes (smooth)</button>
    </div>
    <p class="editor-hint" id="mg-note"></p>
    <div class="editor-actions">
      <button class="btn-primary" id="mg-go">Remove painted area</button>
    </div>
    <p class="field-hint">Diffusion fill, not AI generation: it repairs small objects, wires, scratches and
      blemishes cleanly. Large areas smear - that is a limit of the algorithm, not a bug. Everything stays on
      your device. First run downloads the ~${opencvSizeMB()} MB OpenCV engine once.</p>`;

  const note = $('mg-note');
  const updateNote = () => {
    const m = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    let n = 0;
    for (let i = 3; i < m.length; i += 4) if (m[i]) n++;
    const pct = ((n / (maskCanvas.width * maskCanvas.height)) * 100).toFixed(1);
    const big = parseFloat(pct) > 12;
    note.innerHTML = n
      ? `Marked <b>${pct}%</b> of the image.${big ? ' <b>That is a lot - expect smearing. Try a tighter brush.</b>' : ''}`
      : 'Nothing painted yet.';
  };
  updateNote();

  controlsEl.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => {
      s[inp.dataset.k] = +inp.value;
      inp.nextElementSibling.textContent = inp.value + (inp.dataset.u || '');
    });
  });
  controlsEl.querySelectorAll('[data-mg-m]').forEach((b) => {
    b.addEventListener('click', () => {
      s.method = b.dataset.mgM;
      controlsEl.querySelectorAll('[data-mg-m]').forEach((x) => x.classList.toggle('active', x === b));
    });
  });
  $('mg-clear').addEventListener('click', () => {
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    paint();
    updateNote();
  });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => {
    editorCtx.drawImage(toolBaseCanvas, 0, 0);
    closeTool();
  });

  $('mg-go').addEventListener('click', async () => {
    const px = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    const mask = new Uint8ClampedArray(maskCanvas.width * maskCanvas.height);
    for (let i = 0, q = 0; q < mask.length; i += 4, q++) mask[q] = px[i + 3];
    if (!mask.some((v) => v)) { toast('Paint over the object first'); return; }
    setLoading(true, 'Preparing the OpenCV engine…');
    try {
      const img = snapshot().data;
      const res = await inpaintMask(img, mask, {
        radius: s.radius,
        grow: s.grow,
        method: s.method,
        onProgress: (f) => setLoading(true, f < 0.35 ? 'Loading the OpenCV engine…' : 'Filling the area…'),
      });
      editorCtx.putImageData(img, 0, 0);
      pushHistory();
      toast(`Filled ${(res.coverage * 100).toFixed(1)}% of the image (${s.method})`);
    } catch (err) {
      console.error('Magic Remove failed:', err);
      toast('Magic Remove failed: ' + (err && err.message ? err.message : err));
    } finally {
      setLoading(false);
    }
  });
}

// ---------- Background removal ----------
function openBg() {
  controlsEl.innerHTML = `
    <h3 class="controls-title">🪄 Background Removal</h3>
    <label class="control-label">Model</label>
    <select id="bg-model" class="form-select">
      <option value="fast" selected>Fast (~40 MB) - free</option>
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

// ---------- AI Upscale ----------
const AIUPSCALE_REMEMBER_KEY = 'fileforge-aiupscale-remember';

function openAiUpscale() {
  const remember = localStorage.getItem(AIUPSCALE_REMEMBER_KEY) === '1';
  const modelCards = Object.entries(UPSCALE_TIERS).map(([id, m], i) => `
    <label class="choice-card">
      <input type="radio" name="au-model" value="${id}" ${i === 0 ? 'checked' : ''}>
      <span class="choice-body">
        <span class="choice-title">${m.label} <span class="choice-tag">${m.sizeMB} MB</span></span>
        <span class="choice-desc">${m.bestFor} · ~${m.time}</span>
      </span>
    </label>`).join('');
  const scaleChips = UPSCALE_SCALES.map((s, i) => `
    <button type="button" class="preset-chip scale-chip${i === 1 ? ' active' : ''}" data-scale="${s.value}">${s.label}<span class="chip-note">${s.note}</span></button>`).join('');
  controlsEl.innerHTML = `
    <h3 class="controls-title">✨ AI Upscale</h3>
    <p class="info-banner">Models stream to your browser on first use and are cached - nothing is uploaded to any server.</p>
    <label class="control-label">Model</label>
    ${modelCards}
    <label class="control-label">Scale</label>
    <div class="resize-presets scale-row">${scaleChips}</div>
    <details class="au-advanced">
      <summary>Advanced</summary>
      <label class="control-inline"><input type="checkbox" id="au-large"> Allow 2048px input (much slower, heavy on memory)</label>
    </details>
    <p class="editor-hint" id="au-readout"></p>
    <div class="au-warn hidden" id="au-warn"></div>
    <label class="control-inline"><input type="checkbox" id="au-remember" ${remember ? 'checked' : ''}> Remember my choice (skip warnings)</label>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" id="au-go">Upscale</button>
    </div>
    <p class="license-note">Models: Real-ESRGAN (BSD-3-Clause) &amp; anime (MIT) - credit <a href="https://github.com/xinntao/Real-ESRGAN" target="_blank" rel="noopener">Xinntao</a>.</p>`;
  const modelSel = () => controlsEl.querySelector('input[name=au-model]:checked').value;
  const scaleSel = () => +controlsEl.querySelector('.scale-chip.active').dataset.scale;
  const capSel = () => ($('au-large') && $('au-large').checked ? ADV_INPUT_CAP : INPUT_CAP);
  const update = () => {
    const model = modelSel();
    const scale = scaleSel();
    const est = estimateOutput(editorCanvas.width, editorCanvas.height, scale, capSel());
    const outMp = ((est.outW * est.outH) / 1e6).toFixed(1);
    $('au-readout').textContent = `Output ≈ ${est.outW} × ${est.outH} px · ${outMp} MP (input capped at ${Math.min(Math.max(editorCanvas.width, editorCanvas.height), capSel())}px)`;
    const warn = [];
    const m = UPSCALE_TIERS[model];
    if (m.heavy) warn.push(`<strong>${m.label}</strong>: first use streams <strong>${m.sizeMB} MB</strong> to your browser (${m.time}) and processing can take several minutes - results may be sharper than lighter models.`);
    if (isHeavyScale(scale)) warn.push(`<strong>${scale}×</strong>: runs the AI twice - double processing time. The result is <em>larger</em>, not 8× more real detail, and may fail on phones (use 4× if it does).`);
    const wEl = $('au-warn');
    if (warn.length) {
      wEl.innerHTML = '⚠ ' + warn.join('<br>⚠ ') + (remember ? '' : `<label class="control-inline au-accept"><input type="checkbox" id="au-accept"> I understand the download/time trade-off</label>`);
      wEl.classList.remove('hidden');
    } else {
      wEl.classList.add('hidden');
      wEl.innerHTML = '';
    }
  };
  controlsEl.querySelectorAll('.scale-chip').forEach((c) => c.addEventListener('click', () => {
    controlsEl.querySelectorAll('.scale-chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    update();
  }));
  controlsEl.querySelectorAll('input[name=au-model]').forEach((r) => r.addEventListener('change', update));
  $('au-large').addEventListener('change', update);
  $('au-remember').addEventListener('change', update);
  $('au-go').addEventListener('click', async () => {
    localStorage.setItem(AIUPSCALE_REMEMBER_KEY, $('au-remember').checked ? '1' : '0');
    const warn = $('au-warn');
    if (!warn.classList.contains('hidden') && !$('au-remember').checked && !$('au-accept').checked) {
      toast('Please tick "I understand" to continue');
      return;
    }
    const model = modelSel();
    const scale = scaleSel();
    setLoading(true, 'Starting…');
    try {
      const out = await upscaleCanvas(editorCanvas, {
        tier: model,
        scale,
        cap: capSel(),
        onStatus: (t) => setLoading(true, t),
        onProgress: () => {},
      });
      editorCanvas.width = out.width;
      editorCanvas.height = out.height;
      editorCtx.drawImage(out, 0, 0);
      pushHistory();
      closeTool();
      toast(`AI upscaled ${scale}× → ${out.width} × ${out.height}`);
    } catch (err) {
      toast('AI upscale failed: ' + (err && err.message ? err.message : err));
      console.error('AI upscale failed:', err);
    } finally {
      setLoading(false);
    }
  });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => closeTool());
  update();
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
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Watermark ----------
function openWatermark() {
  const s = { text: '© FileForge', pos: 'br', size: 36, opacity: 60, color: '#ffffff' };
  const POS = { tl: 'Top left', tc: 'Top center', tr: 'Top right', ml: 'Middle left', mc: 'Center', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom center', br: 'Bottom right' };
  controlsEl.innerHTML = `
    <h3 class="controls-title">💧 Watermark</h3>
    <label class="control-label">Text</label>
    <input type="text" id="wm-text" class="form-input" value="© FileForge" maxlength="60" />
    <label class="control-label">Position</label>
    <select id="wm-pos" class="form-select">${Object.entries(POS).map(([v, l]) => `<option value="${v}"${v === 'br' ? ' selected' : ''}>${l}</option>`).join('')}</select>
    ${slider('size', 'Size', 12, 200, 36, 'px')}
    ${slider('opacity', 'Opacity', 5, 100, 60, '%')}
    <label class="control-label">Color</label>
    <input type="color" id="wm-color" value="#ffffff">
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  const preview = () => {
    const W = editorCanvas.width, H = editorCanvas.height;
    editorCtx.clearRect(0, 0, W, H);
    editorCtx.drawImage(toolBaseCanvas, 0, 0);
    if (!s.text.trim()) return;
    const pad = Math.max(10, Math.round(Math.min(W, H) * 0.03));
    editorCtx.save();
    editorCtx.globalAlpha = s.opacity / 100;
    editorCtx.font = `600 ${s.size}px Inter, system-ui, sans-serif`;
    editorCtx.fillStyle = s.color;
    editorCtx.shadowColor = 'rgba(0,0,0,0.65)';
    editorCtx.shadowBlur = Math.max(2, Math.round(s.size / 10));
    const tw = editorCtx.measureText(s.text).width;
    let x = pad, y = pad + s.size;
    if (s.pos[1] === 'c') x = (W - tw) / 2;
    if (s.pos[1] === 'r') x = W - pad - tw;
    if (s.pos[0] === 'm') y = H / 2 + s.size / 2;
    if (s.pos[0] === 'b') y = H - pad;
    editorCtx.fillText(s.text, x, y);
    editorCtx.restore();
  };
  $('wm-text').addEventListener('input', (e) => { s.text = e.target.value; preview(); });
  $('wm-pos').addEventListener('change', (e) => { s.pos = e.target.value; preview(); });
  $('wm-color').addEventListener('input', (e) => { s.color = e.target.value; preview(); });
  controlsEl.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => {
      s[inp.dataset.k] = +inp.value;
      inp.nextElementSibling.textContent = inp.value + (inp.dataset.u || '');
      preview();
    });
  });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => { editorCtx.drawImage(toolBaseCanvas, 0, 0); closeTool(); });
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', () => { pushHistory(); closeTool(); });
  preview();
}

// ---------- Pixelate regions ----------
function openPixelate() {
  const boxes = [];
  const s = { blocks: 10 };
  let drag = null;
  const toFrac = (e) => {
    const m = canvasMetrics();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - m.rect.left) / m.rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - m.rect.top) / m.rect.height)),
    };
  };
  const preview = () => {
    const W = editorCanvas.width, H = editorCanvas.height;
    editorCtx.clearRect(0, 0, W, H);
    editorCtx.drawImage(toolBaseCanvas, 0, 0);
    for (const b of boxes) {
      const sx = Math.round(b.x * W), sy = Math.round(b.y * H);
      const sw = Math.max(2, Math.round(b.w * W)), sh = Math.max(2, Math.round(b.h * H));
      const tw = Math.max(1, Math.round(sw / s.blocks)), th = Math.max(1, Math.round(sh / s.blocks));
      const tiny = document.createElement('canvas');
      tiny.width = tw; tiny.height = th;
      tiny.getContext('2d').drawImage(toolBaseCanvas, sx, sy, sw, sh, 0, 0, tw, th);
      editorCtx.imageSmoothingEnabled = false;
      editorCtx.drawImage(tiny, 0, 0, tw, th, sx, sy, sw, sh);
      editorCtx.imageSmoothingEnabled = true;
    }
  };
  const paintBoxes = () => {
    overlayEl.querySelectorAll('.px-box').forEach((d) => d.remove());
    const m = canvasMetrics();
    const draw = (b, temp) => {
      const d = document.createElement('div');
      d.className = 'px-box' + (temp ? ' px-temp' : '');
      d.style.left = m.leftInStage + b.x * m.rect.width + 'px';
      d.style.top = m.topInStage + b.y * m.rect.height + 'px';
      d.style.width = Math.max(2, b.w * m.rect.width) + 'px';
      d.style.height = Math.max(2, b.h * m.rect.height) + 'px';
      overlayEl.appendChild(d);
    };
    boxes.forEach((b) => draw(b, false));
    if (drag) draw(drag, true);
    const list = $('px-list');
    list.innerHTML = boxes.length
      ? boxes.map((b, i) => `<div class="audio-result"><span class="ar-name">Region ${i + 1}</span><span class="ar-actions"><button type="button" class="btn-secondary btn-mini" data-px-rm="${i}">✕</button></span></div>`).join('')
      : '<p class="editor-hint">No regions yet - drag on the image.</p>';
    list.querySelectorAll('[data-px-rm]').forEach((btn) => {
      btn.addEventListener('click', () => { boxes.splice(+btn.dataset.pxRm, 1); paintBoxes(); preview(); });
    });
  };
  overlayEl.style.cursor = 'crosshair';
  overlayEl.addEventListener('pointerdown', (e) => {
    const p = toFrac(e);
    drag = { x: p.x, y: p.y, w: 0, h: 0 };
    try { overlayEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    paintBoxes();
    e.preventDefault();
  });
  overlayEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toFrac(e);
    drag.w = Math.max(0, p.x - drag.x);
    drag.h = Math.max(0, p.y - drag.y);
    paintBoxes();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.w >= 0.02 && drag.h >= 0.02) boxes.push({ x: drag.x, y: drag.y, w: drag.w, h: drag.h });
    drag = null;
    paintBoxes();
    preview();
  };
  overlayEl.addEventListener('pointerup', endDrag);
  overlayEl.addEventListener('pointercancel', endDrag);
  overlayEl.addEventListener('pointerleave', endDrag);
  controlsEl.innerHTML = `
    <h3 class="controls-title">🧱 Pixelate Faces & Plates</h3>
    ${slider('blocks', 'Blockiness', 4, 30, 10, '')}
    <div id="px-list"></div>
    <div class="editor-actions">
      <button type="button" class="btn-secondary" id="px-clear">Clear regions</button>
    </div>
    <p class="editor-hint">Drag boxes over faces or number plates. Runs fully on-device.</p>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  controlsEl.querySelector('input[type=range]').addEventListener('input', (e) => {
    s.blocks = +e.target.value;
    e.target.nextElementSibling.textContent = e.target.value;
    preview();
  });
  $('px-clear').addEventListener('click', () => { boxes.length = 0; paintBoxes(); preview(); });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => { editorCtx.drawImage(toolBaseCanvas, 0, 0); closeTool(); });
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', () => { pushHistory(); closeTool(); });
  paintBoxes();
  preview();
}

// ---------- Shape crop (circle / rounded) ----------
function rrPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function openShapeCrop() {
  const s = { shape: 'circle', radius: 60 };
  const preview = () => {
    const W = editorCanvas.width, H = editorCanvas.height;
    editorCtx.clearRect(0, 0, W, H);
    editorCtx.drawImage(toolBaseCanvas, 0, 0);
    editorCtx.save();
    editorCtx.globalCompositeOperation = 'destination-in';
    if (s.shape === 'circle') {
      const side = Math.min(W, H);
      editorCtx.beginPath();
      editorCtx.arc(W / 2, H / 2, side / 2, 0, Math.PI * 2);
      editorCtx.fill();
    } else {
      rrPath(editorCtx, 0, 0, W, H, s.radius);
      editorCtx.fill();
    }
    editorCtx.restore();
  };
  controlsEl.innerHTML = `
    <h3 class="controls-title">⭕ Shape Crop</h3>
    <div class="seg-row">
      <button type="button" class="seg-btn active" data-shape="circle">Circle</button>
      <button type="button" class="seg-btn" data-shape="rounded">Rounded rect</button>
    </div>
    ${slider('radius', 'Corner radius', 8, 300, 60, 'px')}
    <p class="editor-hint">Circle trims the canvas to a centered square. Rounded keeps the size. Export PNG to keep the transparent corners.</p>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  controlsEl.querySelectorAll('[data-shape]').forEach((b) => {
    b.addEventListener('click', () => {
      s.shape = b.dataset.shape;
      controlsEl.querySelectorAll('[data-shape]').forEach((x) => x.classList.toggle('active', x === b));
      preview();
    });
  });
  controlsEl.querySelector('input[type=range]').addEventListener('input', (e) => {
    s.radius = +e.target.value;
    e.target.nextElementSibling.textContent = e.target.value + 'px';
    preview();
  });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => { editorCtx.drawImage(toolBaseCanvas, 0, 0); closeTool(); });
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', () => {
    const W = toolBaseCanvas.width, H = toolBaseCanvas.height;
    const out = document.createElement('canvas');
    const octx = out.getContext('2d');
    if (s.shape === 'circle') {
      const side = Math.min(W, H);
      out.width = side; out.height = side;
      const sx = Math.round((W - side) / 2), sy = Math.round((H - side) / 2);
      octx.save();
      octx.beginPath();
      octx.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2);
      octx.clip();
      octx.drawImage(toolBaseCanvas, sx, sy, side, side, 0, 0, side, side);
      octx.restore();
    } else {
      out.width = W; out.height = H;
      octx.save();
      rrPath(octx, 0, 0, W, H, s.radius);
      octx.clip();
      octx.drawImage(toolBaseCanvas, 0, 0);
      octx.restore();
    }
    editorCanvas.width = out.width;
    editorCanvas.height = out.height;
    editorCtx.drawImage(out, 0, 0);
    pushHistory();
    closeTool();
  });
  preview();
}

// ---------- Meme text ----------
function openMeme() {
  const s = { top: 'TOP TEXT', bottom: 'BOTTOM TEXT', size: 64 };
  controlsEl.innerHTML = `
    <h3 class="controls-title">😂 Meme Text</h3>
    <label class="control-label">Top</label>
    <input type="text" id="meme-top" class="form-input" value="TOP TEXT" maxlength="80" />
    <label class="control-label">Bottom</label>
    <input type="text" id="meme-bottom" class="form-input" value="BOTTOM TEXT" maxlength="80" />
    ${slider('size', 'Size', 24, 160, 64, 'px')}
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  const preview = () => {
    const W = editorCanvas.width, H = editorCanvas.height;
    editorCtx.clearRect(0, 0, W, H);
    editorCtx.drawImage(toolBaseCanvas, 0, 0);
    editorCtx.save();
    editorCtx.font = `bold ${s.size}px Impact, 'Arial Black', sans-serif`;
    editorCtx.textAlign = 'center';
    editorCtx.lineJoin = 'round';
    editorCtx.lineWidth = Math.max(2, Math.round(s.size / 10));
    editorCtx.strokeStyle = '#000';
    editorCtx.fillStyle = '#fff';
    if (s.top.trim()) {
      const t = s.top.toUpperCase();
      editorCtx.strokeText(t, W / 2, s.size * 1.1);
      editorCtx.fillText(t, W / 2, s.size * 1.1);
    }
    if (s.bottom.trim()) {
      const t = s.bottom.toUpperCase();
      editorCtx.strokeText(t, W / 2, H - s.size * 0.35);
      editorCtx.fillText(t, W / 2, H - s.size * 0.35);
    }
    editorCtx.restore();
  };
  $('meme-top').addEventListener('input', (e) => { s.top = e.target.value; preview(); });
  $('meme-bottom').addEventListener('input', (e) => { s.bottom = e.target.value; preview(); });
  controlsEl.querySelector('input[type=range]').addEventListener('input', (e) => {
    s.size = +e.target.value;
    e.target.nextElementSibling.textContent = e.target.value + 'px';
    preview();
  });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => { editorCtx.drawImage(toolBaseCanvas, 0, 0); closeTool(); });
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', () => { pushHistory(); closeTool(); });
  preview();
}

// ---------- Instagram grid split ----------
function openGridSplit() {
  const s = { cols: 3, rows: 3 };
  const count = () => s.cols * s.rows;
  const geom = (c, r) => {
    const W = toolBaseCanvas.width, H = toolBaseCanvas.height;
    const x0 = Math.round((c * W) / s.cols), x1 = Math.round(((c + 1) * W) / s.cols);
    const y0 = Math.round((r * H) / s.rows), y1 = Math.round(((r + 1) * H) / s.rows);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const tileCanvas = (n) => {
    const c = (n - 1) % s.cols, r = Math.floor((n - 1) / s.cols);
    const g = geom(c, r);
    const t = document.createElement('canvas');
    t.width = g.w; t.height = g.h;
    t.getContext('2d').drawImage(toolBaseCanvas, g.x, g.y, g.w, g.h, 0, 0, g.w, g.h);
    return t;
  };
  const saveBlob = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
  const tileBlob = (n) => new Promise((res) => tileCanvas(n).toBlob(res, 'image/png'));
  const paintGrid = () => {
    overlayEl.querySelectorAll('.gs-line').forEach((d) => d.remove());
    let view = overlayEl.querySelector('.grid-split-view');
    if (!view) {
      view = document.createElement('div');
      view.className = 'grid-split-view';
      overlayEl.appendChild(view);
    }
    const m = canvasMetrics();
    view.style.left = m.leftInStage + 'px';
    view.style.top = m.topInStage + 'px';
    view.style.width = m.rect.width + 'px';
    view.style.height = m.rect.height + 'px';
    for (let c = 1; c < s.cols; c++) {
      const d = document.createElement('div');
      d.className = 'gs-line';
      d.style.left = (c / s.cols * 100) + '%';
      d.style.top = '0';
      d.style.width = '2px';
      d.style.height = '100%';
      view.appendChild(d);
    }
    for (let r = 1; r < s.rows; r++) {
      const d = document.createElement('div');
      d.className = 'gs-line';
      d.style.top = (r / s.rows * 100) + '%';
      d.style.left = '0';
      d.style.height = '2px';
      d.style.width = '100%';
      view.appendChild(d);
    }
    $('gs-count').textContent = `${count()} tiles`;
  };
  controlsEl.innerHTML = `
    <h3 class="controls-title">🔲 Grid Split</h3>
    <label class="control-label">Columns</label>
    <select id="gs-cols" class="form-select">
      <option value="2">2</option>
      <option value="3" selected>3 (Instagram)</option>
      <option value="4">4</option>
    </select>
    <label class="control-label">Rows</label>
    <select id="gs-rows" class="form-select">
      <option value="1">1</option>
      <option value="2">2</option>
      <option value="3" selected>3</option>
      <option value="4">4</option>
    </select>
    <p class="editor-hint" id="gs-count"></p>
    <label class="control-label" for="gs-tile">Single tile (1 = top left)</label>
    <input type="number" id="gs-tile" class="form-input" min="1" value="1" />
    <div class="editor-actions">
      <button type="button" class="btn-secondary" id="gs-one">Download tile</button>
      <button type="button" class="btn-primary" id="gs-all">Download all (.zip)</button>
    </div>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="close">Close</button>
    </div>`;
  const sync = () => {
    s.cols = +$('gs-cols').value;
    s.rows = +$('gs-rows').value;
    $('gs-tile').max = count();
    paintGrid();
  };
  $('gs-cols').addEventListener('change', sync);
  $('gs-rows').addEventListener('change', sync);
  $('gs-one').addEventListener('click', async () => {
    const n = Math.max(1, Math.min(count(), +$('gs-tile').value || 1));
    saveBlob(await tileBlob(n), `fileforge-tile-${n}.png`);
    toast(`Tile ${n} of ${count()} downloaded`);
  });
  $('gs-all').addEventListener('click', async () => {
    setLoading(true, 'Zipping tiles…');
    try {
      const zip = new JSZip();
      for (let n = 1; n <= count(); n++) zip.file(`tile-${n}.png`, await tileBlob(n));
      saveBlob(await zip.generateAsync({ type: 'blob' }), `fileforge-grid-${count()}-tiles.zip`);
      toast(`${count()} tiles saved to ZIP`);
    } catch (err) {
      toast('ZIP failed: ' + (err && err.message ? err.message : err));
    } finally {
      setLoading(false);
    }
  });
  controlsEl.querySelector('[data-act=close]').addEventListener('click', closeTool);
  sync();
}

// ---------- Color palette ----------
function openPalette() {
  const img = editorCtx.getImageData(0, 0, editorCanvas.width, editorCanvas.height);
  const pal = extractPalette(img, 6);
  controlsEl.innerHTML = `
    <h3 class="controls-title">🎨 Palette</h3>
    ${pal.length ? pal.map((p) => `
      <button type="button" class="pal-swatch" data-hex="${p.hex}">
        <span class="pal-dot" style="background:${p.hex}"></span>
        <span><b>${p.hex}</b><br><span class="field-hint">${Math.round(p.fraction * 100)}% of pixels</span></span>
      </button>`).join('') : '<p class="editor-hint">No opaque pixels found.</p>'}
    <p class="editor-hint">Tap a color to copy its hex code.</p>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="close">Close</button>
    </div>`;
  controlsEl.querySelectorAll('.pal-swatch').forEach((b) => {
    b.addEventListener('click', () => {
      const hex = b.dataset.hex;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(hex).then(() => toast('Copied ' + hex), () => toast(hex));
      } else {
        toast(hex);
      }
    });
  });
  controlsEl.querySelector('[data-act=close]').addEventListener('click', closeTool);
}

// ---------- Photo details (EXIF viewer) ----------
async function openExif() {
  controlsEl.innerHTML = `
    <h3 class="controls-title">🔍 Photo Details</h3>
    <div id="ex-view"><p class="editor-hint">Reading…</p></div>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="close">Close</button>
    </div>`;
  controlsEl.querySelector('[data-act=close]').addEventListener('click', closeTool);
  const view = $('ex-view');
  try {
    if (!originalBlob) {
      view.innerHTML = '<p class="editor-hint">No original file available for this image.</p>';
      return;
    }
    const buf = new Uint8Array(await originalBlob.arrayBuffer());
    const fmt = formatFromName(originalBlob.name || '', originalBlob.type || '');
    if (fmt !== 'png' && fmt !== 'jpeg' && fmt !== 'webp') {
      view.innerHTML = `<p class="editor-hint">Metadata reading supports PNG, JPEG and WebP (this is ${escapeHtml(fmt)}).</p>`;
      return;
    }
    const rep = scanBuffer(buf, fmt);
    const ex = rep.exif || {};
    const rows = [
      ['File', `${originalBlob.name || 'image'} (${fmt.toUpperCase()}, ${editorCanvas.width}×${editorCanvas.height}px)`],
      ['Camera', [ex.make, ex.model].filter(Boolean).join(' ')],
      ['Software', ex.software],
      ['Taken', ex.datetime],
      ['Description', ex.imageDesc],
      ['Comment', ex.userComment ? String(ex.userComment).slice(0, 140) : ''],
      ['GPS', ex.gps ? 'Present - location is embedded in this file' : ''],
    ].filter((row) => row[1]);
    const tags = rows.filter(([k]) => k !== 'File');
    view.innerHTML = `<dl class="exif-list">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>`
      + (tags.length ? '' : '<p class="editor-hint">No EXIF tags in this file - nothing else to show. (Screenshots, edited copies and most PNGs carry none.)</p>');
  } catch (err) {
    view.innerHTML = `<p class="editor-hint">Could not read metadata: ${escapeHtml((err && err.message) || String(err))}</p>`;
  }
}

// ---------- Photo collage ----------
function openCollage() {
  const st = (toolState.collage = toolState.collage || { imgs: [], layout: 'grid2', seeded: false });
  if (!st.seeded) {
    st.seeded = true;
    const c = document.createElement('canvas');
    c.width = toolBaseCanvas.width;
    c.height = toolBaseCanvas.height;
    c.getContext('2d').drawImage(toolBaseCanvas, 0, 0);
    st.imgs.push(c);
  }
  const LAYOUTS = { grid2: '2 side by side', stack2: '2 stacked', grid4: '2×2 grid' };
  controlsEl.innerHTML = `
    <h3 class="controls-title">🖼️ Collage</h3>
    <div class="seg-row">
      ${Object.entries(LAYOUTS).map(([v, l]) => `<button type="button" class="seg-btn${v === st.layout ? ' active' : ''}" data-cg-l="${v}">${l}</button>`).join('')}
    </div>
    <div class="editor-actions">
      <button type="button" class="btn-secondary" id="cg-addbtn">+ Add photos (max 4)</button>
      <input type="file" id="cg-add" accept="image/*" multiple class="editor-file-hidden" tabindex="-1" aria-hidden="true" />
    </div>
    <div id="cg-thumbs"></div>
    <p class="editor-hint">Each cell cover-fills its photo. The canvas becomes the collage on Apply.</p>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="apply">Apply</button>
    </div>`;
  const grid = () => (st.layout === 'grid4' ? [2, 2] : st.layout === 'stack2' ? [1, 2] : [2, 1]);
  const renderThumbs = () => {
    const th = $('cg-thumbs');
    th.innerHTML = st.imgs.map((img, i) => `<span class="cg-thumb"><img src="${img.toDataURL()}" alt="photo ${i + 1}" /><button type="button" class="btn-secondary btn-mini" data-cg-rm="${i}">✕</button></span>`).join('');
    th.querySelectorAll('[data-cg-rm]').forEach((b) => {
      b.addEventListener('click', () => { st.imgs.splice(+b.dataset.cgRm, 1); render(); });
    });
  };
  const render = () => {
    const [cols, rows] = grid();
    const cell = 800;
    editorCanvas.width = cols * cell;
    editorCanvas.height = rows * cell;
    editorCtx.fillStyle = '#14141a';
    editorCtx.fillRect(0, 0, editorCanvas.width, editorCanvas.height);
    for (let i = 0; i < cols * rows; i++) {
      const img = st.imgs[i];
      if (!img) continue;
      const cx = (i % cols) * cell, cy = Math.floor(i / cols) * cell;
      const sc = Math.max(cell / img.width, cell / img.height);
      const dw = img.width * sc, dh = img.height * sc;
      editorCtx.drawImage(img, cx + (cell - dw) / 2, cy + (cell - dh) / 2, dw, dh);
    }
    renderThumbs();
  };
  controlsEl.querySelectorAll('[data-cg-l]').forEach((b) => {
    b.addEventListener('click', () => {
      st.layout = b.dataset.cgL;
      controlsEl.querySelectorAll('[data-cg-l]').forEach((x) => x.classList.toggle('active', x === b));
      render();
    });
  });
  $('cg-addbtn').addEventListener('click', () => $('cg-add').click());
  $('cg-add').addEventListener('change', async (e) => {
    for (const f of [...e.target.files]) {
      if (st.imgs.length >= 4) { toast('Collage holds 4 photos max'); break; }
      if (!f.type.startsWith('image/')) continue;
      try {
        const bmp = await createImageBitmap(f);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        if (bmp.close) bmp.close();
        st.imgs.push(c);
      } catch {
        toast('Could not read ' + f.name);
      }
    }
    e.target.value = '';
    render();
  });
  controlsEl.querySelector('[data-act=cancel]').addEventListener('click', () => {
    editorCanvas.width = toolBaseCanvas.width;
    editorCanvas.height = toolBaseCanvas.height;
    editorCtx.drawImage(toolBaseCanvas, 0, 0);
    closeTool();
  });
  controlsEl.querySelector('[data-act=apply]').addEventListener('click', () => { pushHistory(); closeTool(); });
  render();
}

// ---------- Camera snapshot ----------
function openCamPhoto() {
  controlsEl.innerHTML = `
    <h3 class="controls-title">📷 Camera Snapshot</h3>
    <video id="cam-live" muted playsinline style="width:100%;border-radius:10px;background:#000" hidden></video>
    <label class="control-label" for="cam-facing">Camera</label>
    <select id="cam-facing" class="form-select">
      <option value="user">Front / selfie</option>
      <option value="environment">Back / document</option>
    </select>
    <div class="editor-actions">
      <button type="button" class="btn-secondary" id="cam-start">Start camera</button>
      <button type="button" class="btn-primary" id="cam-shot" disabled>Capture photo</button>
    </div>
    <p class="editor-hint" id="cam-status">Your camera never leaves this device - frames are captured locally.</p>
    <div class="editor-actions">
      <button class="btn-secondary" data-act="close">Close</button>
    </div>`;
  const video = $('cam-live');
  const status = $('cam-status');
  const startBtn = $('cam-start'), shotBtn = $('cam-shot');
  const stopCam = () => {
    stopActiveCapture();
    video.srcObject = null;
    video.hidden = true;
    shotBtn.disabled = true;
    startBtn.disabled = false;
  };
  startBtn.addEventListener('click', async () => {
    stopCam();
    status.textContent = 'Requesting camera…';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: $('cam-facing').value }, audio: false });
      activeCamStream = stream;
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      status.textContent = 'Live - frame the shot, then Capture.';
      startBtn.disabled = true;
      shotBtn.disabled = false;
    } catch (err) {
      status.textContent = 'Camera unavailable: ' + (err && err.message ? err.message : err);
    }
  });
  shotBtn.addEventListener('click', () => {
    if (!video.videoWidth) { toast('No frame yet - wait a second and retry.'); return; }
    const sc = Math.min(1, EDITOR_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
    editorCanvas.width = Math.round(video.videoWidth * sc);
    editorCanvas.height = Math.round(video.videoHeight * sc);
    editorCtx.drawImage(video, 0, 0, editorCanvas.width, editorCanvas.height);
    const snap = snapshot();
    history = [snap];
    histIndex = 0;
    originalImageData = snap;
    updateHistoryButtons();
    editorCanvas.toBlob((b) => { if (b) originalBlob = new File([b], 'camera-shot.png', { type: 'image/png' }); }, 'image/png');
    stopCam();
    status.textContent = 'Captured! Download it with the button below the canvas.';
    toast('Photo captured into the editor');
  });
  controlsEl.querySelector('[data-act=close]').addEventListener('click', () => { stopCam(); closeTool(); });
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
