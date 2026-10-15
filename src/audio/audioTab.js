/**
 * Audio Toolbox tab - waveform, transport, 9 FFmpeg tools, results list.
 * Everything runs client-side on the shared FFmpeg singleton.
 */

import { runFFmpeg, fsName, getFFmpeg, resetFFmpegEngine, isFFmpegLoaded, isFFmpegLoading } from '../converters/media.js';
import * as ops from './ops.js';
import {
  computePeaks,
  computePeaksFromPcm,
  drawWaveform,
  timeAtX,
  xAtTime,
  frameSnap,
  formatTime,
  formatBytes,
} from './waveform.js';

const $ = (id) => document.getElementById(id);
const MAX_FILES = 20;
const WEB_AUDIO_SKIP_BYTES = 80 * 1024 * 1024;
const PCM_FALLBACK_RATE = 8000;
const CONFIRM_TIMEOUT = 5000;

const state = {
  files: [],
  activeId: null,
  seq: 0,
  resSeq: 0,
  tool: 'cut',
  sel: { start: 0, end: 0 },
  results: [],
  drag: null,
  confirm: { kind: null, id: null },
  confirmTimer: null,
  /** Output-format memory per mode, so switching tools never loses a pick. */
  audioOutExt: 'mp3',
  videoOutExt: 'mp4',
  vtrimMode: 'video',
};

let canvas = null;
let ctx = null;
let player = null;
let resultPlayer = null;
let rafId = null;
let toastTimer = null;
let runSeq = 0;
let liveRunId = 0;
let elapsedTimer = null;
let elapsedStart = 0;

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
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function activeFile() {
  return state.files.find((f) => f.id === state.activeId) || null;
}

function bucketCount() {
  const w = canvas ? canvas.clientWidth : 600;
  return Math.max(240, Math.min(3200, Math.floor(w * 1.5)));
}

function snapTime(item, t) {
  const max = item.duration || 0;
  const snapped = item.sampleRate ? frameSnap(t, item.sampleRate) : Math.round(t * 100) / 100;
  return Math.max(0, Math.min(max, snapped));
}

function baseName(name) {
  return String(name).replace(/\.[^.]+$/, '') || 'audio';
}

function fmtOutExt() {
  return $('audio-out-ext').value;
}

/** vtrim in video mode is the only tool that writes a container via the shared select. */
function vtrimVideoOut() {
  return state.tool === 'vtrim' && state.vtrimMode === 'video';
}

/**
 * The shared output-format select is reused for audio and video outputs so
 * there is still only one control in the run row. Options follow the active
 * tool/mode, and each mode remembers its own pick.
 */
function updateOutExtOptions() {
  const sel = $('audio-out-ext');
  if (!sel) return;
  const video = vtrimVideoOut();
  const list = video ? ops.VIDEO_OUT_FORMATS : ops.AUDIO_OUT_FORMATS;
  const want = video ? state.videoOutExt : state.audioOutExt;
  const item = activeFile();
  // Default a video output to the source container (the always-safe copy target).
  const def = video && item && item.isVideo ? item.ext : null;
  const remembered = want && list.some((f) => f.ext === want) ? want : null;
  const value = remembered || (def && list.some((f) => f.ext === def) ? def : list[0].ext);
  sel.innerHTML = list.map((f) => `<option value="${f.ext}">${f.label}</option>`).join('');
  sel.value = value;
  if (video) state.videoOutExt = value;
  else state.audioOutExt = value;
  updateBitrateVisibility();
}

function bitrate() {
  return parseInt($('audio-bitrate').value, 10) || 192;
}

function engineNote(msg) {
  const el = $('audio-engine-note');
  if (el) el.textContent = msg;
}

/** Download the ~31 MB core in the background so the first Process/Preview is fast. */
async function preloadAudioEngine() {
  if (isFFmpegLoaded()) {
    engineNote('Engine ready - processing starts instantly.');
    return;
  }
  engineNote('Preparing the audio engine in the background (~31 MB, once per browser)…');
  try {
    await getFFmpeg((frac) => {
      // getFFmpeg reports coarse stages (0/10/30), not bytes - show words, not a fake %.
      engineNote(`Preparing the audio engine… ${frac >= 30 ? 'almost ready' : frac >= 10 ? 'downloading core' : 'starting'}`);
    });
    engineNote('Engine ready - processing starts instantly.');
    if (!document.getElementById('tab-content-audio').classList.contains('hidden')) {
      toast('Audio engine ready.');
    }
  } catch (err) {
    engineNote('');
    console.warn('Engine preload failed (will retry on first use):', err);
  }
}

function startElapsed() {
  stopElapsed();
  elapsedStart = Date.now();
  const el = $('audio-elapsed');
  if (el) el.textContent = '';
  elapsedTimer = setInterval(() => {
    const target = $('audio-elapsed');
    if (target) target.textContent = `${Math.round((Date.now() - elapsedStart) / 1000)}s elapsed`;
  }, 1000);
}

function stopElapsed() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
  const el = $('audio-elapsed');
  if (el) el.textContent = '';
}

/**
 * Give up on the live run: drop the engine (its worker may be hung or
 * poisoned - the next call reloads fresh), hide progress, re-enable the UI,
 * and ignore whatever the abandoned run eventually resolves with.
 */
function cancelAudioRun() {
  if (!liveRunId) return;
  liveRunId = 0;
  resetFFmpegEngine();
  stopElapsed();
  $('audio-progress').classList.add('hidden');
  $('audio-run').disabled = false;
  $('audio-cancel').classList.add('hidden');
  toast('Run cancelled.');
}

// ============================================
// Setup
// ============================================
export function setupAudioTab() {
  const zone = $('audio-upload-zone');
  const input = $('audio-file-input');

  canvas = $('audio-canvas');
  ctx = canvas.getContext('2d');

  zone.addEventListener('click', (e) => {
    if (e.target.closest('input, select, textarea, button, a')) return;
    input.click();
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
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

  $('audio-add-more').addEventListener('click', () => input.click());

  // Multi-file drop anywhere in the workspace, so adding more files never
  // requires going back to the (hidden) upload zone.
  const workspace = $('audio-workspace');
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  workspace.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    workspace.classList.add('drop-active');
  });
  workspace.addEventListener('dragleave', (e) => {
    if (e.target === workspace) workspace.classList.remove('drop-active');
  });
  workspace.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    workspace.classList.remove('drop-active');
    addFiles(Array.from(e.dataTransfer.files || []));
  });
  // Stop the browser from navigating away / opening files dropped outside a zone.
  ['dragover', 'drop'].forEach((t) => {
    window.addEventListener(t, (e) => { if (hasFiles(e)) e.preventDefault(); });
  });

  // Output format / bitrate
  const sel = $('audio-out-ext');
  sel.addEventListener('change', () => {
    if (vtrimVideoOut()) state.videoOutExt = sel.value;
    else state.audioOutExt = sel.value;
    updateBitrateVisibility();
    renderTools();
    renderPanel();
  });
  $('audio-bitrate').innerHTML = ops.BITRATES.map((b) => `<option value="${b}"${b === 192 ? ' selected' : ''}>${b} kbps</option>`).join('');
  $('audio-bitrate').addEventListener('change', renderPanel);
  updateOutExtOptions();

  // Tools
  $('audio-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.audio-tool-btn');
    if (!btn || btn.disabled) return;
    state.tool = btn.dataset.tool;
    updateOutExtOptions();
    renderTools();
    renderPanel();
  });

  $('audio-run').addEventListener('click', runTool);
  $('audio-clear-results').addEventListener('click', clearResults);
  $('audio-cancel').addEventListener('click', cancelAudioRun);

  // Warm up the engine on first tab open so Process/Preview rarely pay the
  // ~31 MB first-load cost at click time. One attempt only, silent unless it fails.
  document.getElementById('tab-btn-audio').addEventListener('click', preloadAudioEngine, { once: true });

  // Tapping anywhere else cancels an armed delete.
  document.addEventListener('pointerdown', (e) => {
    if (!state.confirm.kind) return;
    if (e.target.closest('.af-del, [data-act="remove"], [data-mv="rm"]')) return;
    cancelArmedDelete();
  });

  // Transport
  $('audio-play').addEventListener('click', togglePlay);
  $('audio-preview-sel').addEventListener('click', previewSelection);

  // Waveform interaction
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('dblclick', () => {
    selectFull();
    draw();
    syncCutInputs();
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      resizeCanvas();
      draw();
    }).observe(canvas);
  }
  window.addEventListener('resize', () => {
    resizeCanvas();
    draw();
  });

  window.__audioAddFiles = addFiles;
  // Read-only result accessor so automated checks can inspect real output bytes.
  window.__audioResults = () => state.results.map((r) => ({ name: r.name, mime: r.mime, size: r.size, url: r.url }));

  // Render the disabled tool rail + empty panel before any file is loaded.
  renderTools();
  renderPanel();
  renderResults();
}

function updateBitrateVisibility() {
  const ext = effectiveOutExt();
  // Bitrate only matters when audio is re-encoded: stream-copy runs (video
  // trim, tag rewrite) ignore it, as do the uncompressed formats.
  const copies = vtrimVideoOut() || state.tool === 'tags';
  $('audio-bitrate-group').classList.toggle('hidden', copies || ['wav', 'flac'].includes(ext));
}

/** Output extension actually used (denoise video mode keeps the container). */
function denoiseVideoOut() {
  const el = $('ao-dn-vout');
  return !el || el.value === 'video';
}

function effectiveOutExt() {
  const item = activeFile();
  if (state.tool === 'denoise' && item && item.isVideo && denoiseVideoOut()) return item.ext;
  if (state.tool === 'tags' && item) return item.ext;
  return fmtOutExt();
}

function resizeCanvas() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
  const h = canvas.clientHeight || 140;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
}

// ============================================
// File loading
// ============================================
function addFiles(list) {
  const accepted = [];
  const rejected = [];
  let tooBig = 0;
  let hefty = 0;
  for (const file of list) {
    const ext = ops.extOf(file.name);
    if (!ops.isSupportedInput(ext)) {
      rejected.push(file.name);
      continue;
    }
    // The wasm filesystem transiently holds ~2-3x the file size; huge files
    // hang or OOM the tab with no error. Refuse those, warn on merely big ones.
    if (ops.classifyAudioSize(file.size) === 'refuse') {
      tooBig++;
      continue;
    }
    if (ops.classifyAudioSize(file.size) === 'warn') hefty++;
    if (state.files.length >= MAX_FILES) break;
    accepted.push(file);
  }

  for (const file of accepted) {
    const ext = ops.extOf(file.name);
    state.files.push({
      id: ++state.seq,
      file,
      name: file.name,
      ext,
      size: file.size,
      isVideo: ops.isVideoExt(ext),
      duration: null,
      sampleRate: null,
      peaks: null,
      url: URL.createObjectURL(file),
    });
  }

  if (rejected.length) toast(`Unsupported: ${rejected.slice(0, 3).join(', ')}`);
  if (tooBig) toast(`Skipped ${tooBig} file(s) over 500 MB - too big for in-browser processing. Trim it first.`);
  if (hefty) toast('Large file(s) loaded - processing needs time and memory. The 8s preview is instant.');
  if (state.files.length >= MAX_FILES && accepted.length) toast(`Limit is ${MAX_FILES} files`);
  if (!accepted.length) return;

  $('audio-upload-zone').style.display = 'none';
  $('audio-workspace').classList.remove('hidden');

  renderFileList();
  // Keep the file the user is working on. Switching to the newest file would
  // reset the selection and the tool panel behind their back.
  if (state.activeId == null && state.files.length) {
    const keep = accepted.length ? state.files.find((f) => f.id === state.files[state.files.length - accepted.length].id) : state.files[0];
    setActive(keep.id);
  } else {
    renderTools();
    renderPanel();
  }
}

/**
 * Two-step delete shared by loaded files, the merge list and the results list:
 * first click arms the button, second click removes. Disarms after 5s.
 */
function armDelete(kind, id) {
  if (state.confirm.kind === kind && state.confirm.id === id) {
    clearTimeout(state.confirmTimer);
    state.confirm = { kind: null, id: null };
    if (kind === 'file') removeFile(id);
    else removeResult(id);
    return;
  }
  clearTimeout(state.confirmTimer);
  state.confirm = { kind, id };
  renderConfirmTargets();
  state.confirmTimer = setTimeout(() => {
    state.confirm = { kind: null, id: null };
    renderConfirmTargets();
  }, CONFIRM_TIMEOUT);
}

function cancelArmedDelete() {
  if (!state.confirm.kind) return;
  clearTimeout(state.confirmTimer);
  state.confirm = { kind: null, id: null };
  renderConfirmTargets();
}

/** Re-render whichever lists show an armed delete button. */
function renderConfirmTargets() {
  renderFileList();
  renderResults();
  if (state.tool === 'merge') renderPanel();
}

function removeFile(id) {
  const idx = state.files.findIndex((f) => f.id === id);
  if (idx === -1) return;
  const [gone] = state.files.splice(idx, 1);
  if (gone) URL.revokeObjectURL(gone.url);
  if (gone && gone.id === state.activeId) {
    state.activeId = null;
    const next = state.files[Math.min(idx, state.files.length - 1)];
    if (next) setActive(next.id);
  }

  renderFileList();
  renderTools();

  if (!state.files.length) {
    stopPlayback();
    $('audio-workspace').classList.add('hidden');
    $('audio-upload-zone').style.display = '';
    state.sel = { start: 0, end: 0 };
    return;
  }
  draw();
  renderPanel();
}

function removeResult(id) {
  const idx = state.results.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const [gone] = state.results.splice(idx, 1);
  if (gone) URL.revokeObjectURL(gone.url);
  if (resultPlayer && resultPlayer.dataset.id === String(id)) {
    resultPlayer.pause();
    resultPlayer.removeAttribute('src');
  }
  renderResults();
}

function renderFileList() {
  const list = $('audio-file-list');
  $('audio-file-count').textContent = String(state.files.length);
  if (!state.files.length) {
    list.innerHTML = '<p class="audio-empty-note">No files loaded - drop them here or tap "+ Add files".</p>';
    return;
  }
  list.innerHTML = state.files
    .map((f) => {
      const dur = f.duration ? ` · ${formatTime(f.duration)}` : '';
      const armed = state.confirm.kind === 'file' && state.confirm.id === f.id;
      return `<div class="audio-file-chip${f.id === state.activeId ? ' active' : ''}" data-id="${f.id}" role="button" tabindex="0">
        <span class="af-icon">${f.isVideo ? '🎬' : '🎵'}</span>
        <span class="af-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        <span class="af-meta">${formatBytes(f.size)}${dur}</span>
        <button type="button" class="af-del${armed ? ' armed' : ''}" data-del="${f.id}"
          title="${armed ? 'Click again to delete' : 'Remove this file'}">${armed ? '✓ Delete' : '✕'}</button>
      </div>`;
    })
    .join('');

  list.querySelectorAll('.audio-file-chip').forEach((chip) => {
    const id = parseInt(chip.dataset.id, 10);
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.af-del')) return;
      cancelArmedDelete();
      setActive(id);
    });
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActive(id);
      }
    });
    chip.querySelector('.af-del').addEventListener('click', (e) => {
      e.stopPropagation();
      armDelete('file', id);
    });
  });
}

async function setActive(id) {
  const item = state.files.find((f) => f.id === id);
  if (!item) return;
  if (state.activeId === id) return;

  stopPlayback();
  state.activeId = id;
  selectFull();
  renderFileList();
  updateOutExtOptions();
  renderTools();
  renderPanel();
  draw();

  const meta = $('audio-active-meta');
  meta.textContent = `Decoding waveform…`;
  try {
    await ensurePeaks(item, (frac, msg) => {
      meta.textContent = `${msg || 'Decoding…'} ${Math.round(frac * 100)}%`;
    });
    meta.textContent = `${item.name} · ${item.isVideo ? 'Video' : 'Audio'} · ${formatTime(item.duration)} · ${item.sampleRate ? `${Math.round(item.sampleRate / 1000)} kHz · ` : ''}waveform via ${item.waveSource}`;
    $('audio-wave-note').classList.toggle('hidden', !!item.peaks);
    selectFull();
    renderFileList();
    updateOutExtOptions();
    renderTools();
    renderPanel();
    resizeCanvas();
    draw();
  } catch (err) {
    console.error('Waveform failed:', err);
    $('audio-wave-note').classList.remove('hidden');
    meta.textContent = `${item.name} · waveform unavailable (${err.message})`;
    renderTools();
    renderPanel();
  }
}

async function ensurePeaks(item, onProgress = () => {}) {
  if (item.peaks) return;

  if (item.size <= WEB_AUDIO_SKIP_BYTES) {
    try {
      const buf = await item.file.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ac = new Ctx();
        try {
          const decoded = await ac.decodeAudioData(buf);
          item.duration = decoded.duration;
          item.sampleRate = decoded.sampleRate;
          item.peaks = computePeaks(decoded, bucketCount());
          item.waveSource = 'Web Audio';
          return;
        } finally {
          ac.close();
        }
      }
    } catch (err) {
      console.warn('Web Audio decode failed, falling back to FFmpeg PCM:', err);
    }
  }

  onProgress(0.05, 'Large file - decoding waveform with FFmpeg…');
  const inName = fsName(`in.${item.ext}`);
  const outName = fsName('pcm.raw');
  const [res] = await runFFmpeg({
    args: ['-i', inName, '-f', 's16le', '-ac', '1', '-ar', String(PCM_FALLBACK_RATE), '-y', outName],
    inputs: [{ name: inName, file: item.file }],
    outputs: [{ name: outName }],
    onProgress,
  });

  const bytes = res.bytes.byteOffset % 2 === 0 ? res.bytes : new Uint8Array(res.bytes);
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  item.peaks = computePeaksFromPcm(int16, bucketCount());
  item.duration = int16.length / PCM_FALLBACK_RATE;
  item.sampleRate = null;
  item.waveSource = 'FFmpeg PCM';
}

// ============================================
// Waveform + selection
// ============================================
function selectFull() {
  const item = activeFile();
  state.sel = { start: 0, end: item && item.duration ? item.duration : 0 };
}

function draw() {
  if (!ctx || !canvas) return;
  resizeCanvas();
  const item = activeFile();
  const dpr = window.devicePixelRatio || 1;
  const playT = player ? player.currentTime : 0;
  drawWaveform(ctx, {
    peaks: item ? item.peaks : null,
    width: canvas.width / dpr,
    height: canvas.height / dpr,
    duration: item ? item.duration || 0 : 0,
    playRatio: item && item.duration ? Math.min(1, playT / item.duration) : 0,
    selStart: state.sel.start,
    selEnd: state.sel.end,
    dpr,
  });
  $('audio-time').textContent = `${formatTime(playT)} / ${formatTime(item ? item.duration : 0)}`;
}

function onPointerDown(e) {
  const item = activeFile();
  if (!item || !item.duration) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const t = timeAtX(x, rect.width, item.duration);
  const xs = xAtTime(state.sel.start, rect.width, item.duration);
  const xe = xAtTime(state.sel.end, rect.width, item.duration);
  const EDGE = 10;
  const hasRange = xe - xs > 2;
  // A full-length selection behaves like "no selection yet", otherwise every
  // drag would try to move a file-length region and get clamped to a no-op.
  const fullSel = state.sel.start <= 0.001 && (!item.duration || state.sel.end >= item.duration - 0.001);

  let mode = 'new';
  if (!fullSel && hasRange) {
    if (Math.abs(x - xs) <= EDGE) mode = 'start';
    else if (Math.abs(x - xe) <= EDGE) mode = 'end';
    else if (t > state.sel.start && t < state.sel.end) mode = 'move';
  }

  state.drag = { mode, anchor: t, start0: state.sel.start, end0: state.sel.end };
  canvas.setPointerCapture(e.pointerId);
  if (mode === 'new') {
    state.sel = { start: t, end: t };
  }
  draw();
}

function onPointerMove(e) {
  const drag = state.drag;
  const item = activeFile();
  if (!drag || !item || !item.duration) return;
  const rect = canvas.getBoundingClientRect();
  const t = timeAtX(e.clientX - rect.left, rect.width, item.duration);
  const dur = item.duration;

  if (drag.mode === 'new') {
    state.sel = { start: Math.min(drag.anchor, t), end: Math.max(drag.anchor, t) };
  } else if (drag.mode === 'start') {
    state.sel = { start: Math.min(t, state.sel.end), end: state.sel.end };
  } else if (drag.mode === 'end') {
    state.sel = { start: state.sel.start, end: Math.max(t, state.sel.start) };
  } else {
    const span = drag.end0 - drag.start0;
    let s = drag.start0 + (t - drag.anchor);
    s = Math.max(0, Math.min(dur - span, s));
    state.sel = { start: s, end: s + span };
  }

  if (state.sel.end - state.sel.start < 0.005) {
    state.sel.start = snapTime(item, state.sel.start);
    state.sel.end = Math.max(state.sel.start + 0.005, snapTime(item, state.sel.end));
  }
  draw();
  syncCutInputs();
}

function onPointerUp(e) {
  if (!state.drag) return;
  state.drag = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  if (state.sel.end - state.sel.start < 0.02) selectFull();
  draw();
  syncCutInputs();
}

function syncCutInputs() {
  const s = $('ao-start');
  const en = $('ao-end');
  if (s && document.activeElement !== s) s.value = ops.r3(state.sel.start);
  if (en && document.activeElement !== en) en.value = ops.r3(state.sel.end);
}

// ============================================
// Playback
// ============================================
function ensurePlayer() {
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
    player.addEventListener('ended', () => {
      setPlayIcon(false);
      stopTicker();
    });
  }
  return player;
}

function ticker() {
  const item = activeFile();
  if (player && item && $('audio-loop').checked && item.duration) {
    const { start, end } = state.sel;
    if (end > start && player.currentTime >= end) player.currentTime = start;
  }
  draw();
  rafId = requestAnimationFrame(ticker);
}

function startTicker() {
  stopTicker();
  rafId = requestAnimationFrame(ticker);
}

function stopTicker() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function setPlayIcon(playing) {
  $('audio-play').textContent = playing ? '⏸ Pause' : '▶ Play';
}

function stopPlayback() {
  if (player) {
    player.pause();
    player.removeAttribute('src');
  }
  stopTicker();
  setPlayIcon(false);
}

async function togglePlay() {
  const item = activeFile();
  if (!item) return;
  const p = ensurePlayer();
  if (!p.paused) {
    p.pause();
    setPlayIcon(false);
    stopTicker();
    return;
  }
  if (p.dataset.id !== String(item.id)) {
    p.src = item.url;
    p.dataset.id = String(item.id);
    p.currentTime = 0;
  }
  try {
    await p.play();
    setPlayIcon(true);
    startTicker();
  } catch (err) {
    toast('Preview not available for this format (' + (err.message || err) + ')');
  }
}

async function previewSelection() {
  const item = activeFile();
  if (!item || !item.duration) return;
  const p = ensurePlayer();
  if (p.dataset.id !== String(item.id)) {
    p.src = item.url;
    p.dataset.id = String(item.id);
  }
  p.currentTime = Math.max(0, state.sel.start);
  try {
    await p.play();
    setPlayIcon(true);
    startTicker();
  } catch (err) {
    toast('Preview not available (' + (err.message || err) + ')');
  }
}

// ============================================
// Tools UI
// ============================================
function renderTools() {
  const item = activeFile();
  const audioCount = state.files.filter((f) => !f.isVideo).length;
  const bar = $('audio-toolbar');
  bar.innerHTML = ops.TOOLS.map((t) => {
    let disabled = false;
    let why = '';
    if (t.needsVideo) {
      disabled = !(item && item.isVideo);
      why = 'Load a video file (MP4/MOV/MKV/AVI/WEBM) first.';
    } else if (t.needsFiles) {
      disabled = audioCount < t.needsFiles;
      why = `Load at least ${t.needsFiles} audio files to merge them.`;
    } else if (t.needsTaggable) {
      disabled = !(item && ops.isTaggable(item.ext));
      why = 'Tags work on MP3/M4A/AAC/OGG/OPUS/FLAC. For a video, run Extract Audio first, then tag the result.';
    }
    const title = disabled ? why : '';
    return `<button type="button" class="audio-tool-btn${state.tool === t.id ? ' active' : ''}" data-tool="${t.id}"${disabled ? ' disabled' : ''}${title ? ` title="${escapeHtml(title)}"` : ''}>${t.label}</button>`;
  }).join('');
}

function renderPanel() {
  const el = $('audio-tool-panel');
  const item = activeFile();
  const dur = item && item.duration ? item.duration : 0;
  const maxAttr = dur ? ops.r3(dur) : '0';
  const losslessOk = item ? ops.canLosslessTrim(item.ext, fmtOutExt()) : false;
  const t = state.tool;
  // The denoise video mode disables the shared format select; restore it here
  // so no other tool inherits the disabled state.
  $('audio-out-ext').disabled = false;

  if (t === 'cut') {
    el.innerHTML = `
      <label class="control-label" for="ao-start">Start (seconds)</label>
      <input type="number" id="ao-start" class="form-input" step="0.01" min="0" max="${maxAttr}" value="${ops.r3(state.sel.start)}" />
      <label class="control-label" for="ao-end">End (seconds)</label>
      <input type="number" id="ao-end" class="form-input" step="0.01" min="0" max="${maxAttr}" value="${ops.r3(state.sel.end)}" />
      <label class="control-inline"><input type="checkbox" id="ao-lossless"${losslessOk ? ' checked' : '' }${losslessOk ? '' : ' disabled'}/> Lossless (no re-encode - instant, bit-exact)</label>
      <label class="control-label" for="ao-fadein">Fade in (s)</label>
      <input type="number" id="ao-fadein" class="form-input" step="0.1" min="0" max="30" value="0" />
      <label class="control-label" for="ao-fadeout">Fade out (s)</label>
      <input type="number" id="ao-fadeout" class="form-input" step="0.1" min="0" max="30" value="0" />
      <p class="field-hint">${losslessOk
        ? 'Lossless only works when the output format matches the input (MP3→MP3 etc.). Fades force a re-encode.'
        : 'Re-encode is used when formats differ or fades are set. MP3 can only be cut on frame boundaries (~26 ms).'}</p>`;
    const bind = () => {
      const s = parseFloat($('ao-start').value);
      const e = parseFloat($('ao-end').value);
      if (!Number.isNaN(s) && !Number.isNaN(e) && e > s) {
        state.sel = { start: s, end: e };
        draw();
      }
    };
    $('ao-start').addEventListener('input', bind);
    $('ao-end').addEventListener('input', bind);
    if (!losslessOk) {
      $('ao-lossless').addEventListener('change', () => {
        toast('Lossless needs the same input and output format - picked a re-encode instead.');
      });
    }
    return;
  }

  if (t === 'vtrim') {
    const item2 = activeFile();
    const src = item2 ? item2.ext : '';
    const videoMode = state.vtrimMode === 'video';
    const copyOk = videoMode && ops.canLosslessVideoTrim(src, fmtOutExt());
    el.innerHTML = `
      <label class="control-label">Output</label>
      <div class="seg-row">
        <button type="button" class="seg-btn${videoMode ? ' active' : ''}" data-vmode="video">🎞 Video (lossless cut)</button>
        <button type="button" class="seg-btn${videoMode ? '' : ' active'}" data-vmode="audio">🎵 Audio only</button>
      </div>
      <label class="control-label" for="ao-vstart">Start (seconds)</label>
      <input type="number" id="ao-vstart" class="form-input" step="0.01" min="0" max="${maxAttr}" value="${ops.r3(state.sel.start)}" />
      <label class="control-label" for="ao-vend">End (seconds)</label>
      <input type="number" id="ao-vend" class="form-input" step="0.01" min="0" max="${maxAttr}" value="${ops.r3(state.sel.end)}" />
      <div class="option-button-group">
        <button type="button" class="btn-secondary btn-mini" data-vsel="sel">↔ Use waveform selection</button>
        <button type="button" class="btn-secondary btn-mini" data-vsel="first15">⏱ First 15s</button>
        <button type="button" class="btn-secondary btn-mini" data-vsel="last15">⏱ Last 15s</button>
      </div>
      ${videoMode ? `<label class="control-inline"><input type="checkbox" id="ao-vaudio" checked /> Keep the audio track</label>` : ''}
      <p class="field-hint">${videoMode
        ? (copyOk
          ? `Lossless stream copy into <b>${fmtOutExt().toUpperCase()}</b> - instant, no quality loss. The clip can start up to one keyframe early (GOP length), which is the trade for not re-encoding.`
          : `A <b>${src.toUpperCase()}</b> file cannot be stream-copied into <b>${fmtOutExt().toUpperCase()}</b>. Pick the source container (or MKV, which accepts anything), or switch to Audio only.`)
        : 'Audio only: same trimming and re-encoding rules as the Cut tool. To change the video format, use the File Converter tab.'}</p>`;
    const applyTimes = (s, e2) => {
      state.sel = { start: s, end: e2 };
      draw();
      renderPanel();
    };
    const bindTimes = () => {
      const s = parseFloat($('ao-vstart').value);
      const e2 = parseFloat($('ao-vend').value);
      if (!Number.isNaN(s) && !Number.isNaN(e2) && e2 > s) {
        state.sel = { start: s, end: e2 };
        draw();
      }
    };
    $('ao-vstart').addEventListener('input', bindTimes);
    $('ao-vend').addEventListener('input', bindTimes);
    el.querySelectorAll('[data-vmode]').forEach((b) => {
      b.addEventListener('click', () => {
        state.vtrimMode = b.dataset.vmode;
        updateOutExtOptions();
        renderTools();
        renderPanel();
      });
    });
    el.querySelectorAll('[data-vsel]').forEach((b) => {
      b.addEventListener('click', () => {
        const d = item2 && item2.duration ? item2.duration : 0;
        if (b.dataset.vsel === 'first15') applyTimes(0, Math.min(d || 15, 15));
        else if (b.dataset.vsel === 'last15') applyTimes(Math.max(0, (d || 15) - 15), d || 15);
        else if (state.sel.end > state.sel.start) applyTimes(state.sel.start, state.sel.end);
        else toast('Drag a selection on the waveform first.');
      });
    });
    return;
  }

  if (t === 'merge') {
    const audioOnly = state.files.filter((f) => !f.isVideo);
    const videos = state.files.filter((f) => f.isVideo);
    el.innerHTML = `
      <label class="control-label">Merge order (top to bottom)</label>
      ${state.files.map((f, i) => {
          const armed = state.confirm.kind === 'file' && state.confirm.id === f.id;
          return `<div class="audio-result${armed ? ' armed' : ''}">
          <span class="ar-name">${i + 1}. ${escapeHtml(f.name)}</span>
          <span class="ar-meta">${f.isVideo ? 'video - skipped' : formatBytes(f.size)}</span>
          <span class="ar-actions">
            <button type="button" class="btn-secondary btn-mini" data-mv="up" data-i="${i}"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="btn-secondary btn-mini" data-mv="down" data-i="${i}"${i === state.files.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="btn-secondary btn-mini${armed ? ' armed' : ''}" data-mv="rm" data-i="${i}"
              title="${armed ? 'Click again to remove this file' : 'Remove this file from the list'}">${armed ? '✓ Delete' : '✕'}</button>
          </span>
        </div>`;
        }).join('')}
      <p class="field-hint">Merges ${audioOnly.length} audio file${audioOnly.length === 1 ? '' : 's'} into one track, re-encoded to the chosen format so mixed sources still join cleanly.${videos.length ? ` Video files (${videos.length}) are skipped - use Extract Audio on them first.` : ''}</p>`;
    el.querySelectorAll('[data-mv]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.i, 10);
        const mv = b.dataset.mv;
        if (mv === 'up' && i > 0) [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]];
        else if (mv === 'down' && i < state.files.length - 1) [state.files[i + 1], state.files[i]] = [state.files[i], state.files[i + 1]];
        else if (mv === 'rm') {
          armDelete('file', state.files[i].id);
          return;
        }
        renderFileList();
        renderTools();
        renderPanel();
      });
    });
    return;
  }

  if (t === 'fade') {
    el.innerHTML = `
      <label class="control-label" for="ao-fadein">Fade in (s)</label>
      <input type="number" id="ao-fadein" class="form-input" step="0.1" min="0" max="30" value="2" />
      <label class="control-label" for="ao-fadeout">Fade out (s)</label>
      <input type="number" id="ao-fadeout" class="form-input" step="0.1" min="0" max="30" value="3" />
      <p class="field-hint">Applies to the whole file (${formatTime(dur)}). Re-encodes the audio.</p>`;
    return;
  }

  if (t === 'normalize') {
    el.innerHTML = `
      <label class="control-label" for="ao-mode">Mode</label>
      <select id="ao-mode" class="form-select">
        <option value="loudnorm" selected>Loudness normalize (broadcast target)</option>
        <option value="gain">Simple gain (dB)</option>
      </select>
      <div id="ao-loud-row">
        <label class="control-label" for="ao-lufs">Target loudness (LUFS)</label>
        <input type="number" id="ao-lufs" class="form-input" step="0.5" min="-30" max="-5" value="-14" />
        <label class="control-label" for="ao-ceiling">True peak ceiling (dBTP)</label>
        <input type="number" id="ao-ceiling" class="form-input" step="0.5" min="-9" max="0" value="-1.5" />
      </div>
      <div id="ao-gain-row" class="hidden">
        <label class="control-label" for="ao-gain">Gain (dB)</label>
        <input type="number" id="ao-gain" class="form-input" step="0.5" min="-24" max="24" value="0" />
      </div>
      <p class="field-hint">Loudness normalization evens out perceived volume but can flatten dynamics. Simple gain adds a fixed offset.</p>`;
    const sync = () => {
      const loud = $('ao-mode').value === 'loudnorm';
      $('ao-loud-row').classList.toggle('hidden', !loud);
      $('ao-gain-row').classList.toggle('hidden', loud);
    };
    $('ao-mode').addEventListener('change', sync);
    sync();
    return;
  }

  if (t === 'speed') {
    el.innerHTML = `
      <label class="control-label" for="ao-rate">Speed</label>
      <select id="ao-rate" class="form-select">
        ${[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => `<option value="${r}"${r === 1 ? ' selected' : ''}>${r}×</option>`).join('')}
      </select>
      <label class="control-label" for="ao-pitch">Pitch shift (semitones)</label>
      <select id="ao-pitch" class="form-select">
        ${[-12, -7, -5, -3, -1, 0, 1, 3, 5, 7, 12].map((s) => `<option value="${s}"${s === 0 ? ' selected' : ''}>${s > 0 ? '+' : ''}${s}</option>`).join('')}
      </select>
      <p class="field-hint">Changing speed also changes pitch by default. Add a pitch value only when you want to correct it (e.g. 2× speed + -12 semitones).</p>`;
    return;
  }

  if (t === 'extract') {
    el.innerHTML = `
      <p class="field-hint">Pulls the audio track out of <b>${escapeHtml(item ? item.name : '')}</b> and saves it as your chosen audio format. The video is discarded.</p>`;
    return;
  }

  if (t === 'silence') {
    el.innerHTML = `
      <label class="control-label" for="ao-threshold">Silence threshold (dB)</label>
      <input type="number" id="ao-threshold" class="form-input" step="1" min="-90" max="0" value="-45" />
      <label class="control-label" for="ao-minsil">Minimum silence length (s)</label>
      <input type="number" id="ao-minsil" class="form-input" step="0.1" min="0.05" max="10" value="0.4" />
      <label class="control-label" for="ao-pad">Keep padding (s)</label>
      <input type="number" id="ao-pad" class="form-input" step="0.05" min="0" max="2" value="0.15" />
      <p class="field-hint">Trims leading and trailing silence (voice memo clean-up) and keeps a little padding so words are not clipped. Silences in the middle of the track are left alone.</p>`;
    return;
  }

  if (t === 'reverse') {
    el.innerHTML = `<p class="field-hint">Reverses the whole audio. The browser engine holds the track in memory, so very long files may run out of memory.</p>`;
    return;
  }

  if (t === 'denoise') {
    const presets = Object.entries(ops.DENOISE_PRESETS)
      .map(([id, p]) => `<option value="${id}"${id === 'standard' ? ' selected' : ''}>${p.label} - ${p.desc}</option>`)
      .join('');
    const selLen = state.sel.end - state.sel.start;
    const profOk = !!(item && item.duration && selLen >= 0.5 && selLen < item.duration * 0.5);
    el.innerHTML = `
      <label class="control-label" for="ao-dn-preset">Cleanup strength</label>
      <select id="ao-dn-preset" class="form-select">${presets}</select>
      <label class="control-inline"><input type="checkbox" id="ao-dn-profile"${profOk ? '' : ' disabled'} />
        Use the waveform selection as the noise profile${profOk ? ` (${ops.r3(state.sel.start)}s - ${ops.r3(state.sel.end)}s)` : ' (drag a short noise-only part first)'}</label>
      <p class="field-hint">Pick a stretch with ONLY background noise in it (room tone, no speech or music) - like a noise profile. Whole-file selections are rejected.</p>
      ${item && item.isVideo ? `
      <label class="control-label" for="ao-dn-vout">For this video, output</label>
      <select id="ao-dn-vout" class="form-select">
        <option value="video" selected>Same video with cleaned audio (.${item.ext})</option>
        <option value="audio">Audio only (uses the format below)</option>
      </select>` : ''}
      <details class="au-advanced">
        <summary>Advanced</summary>
        <label class="control-label" for="ao-dn-nr">Strength (<span class="range-val" id="ao-dn-nrv">12 dB</span>)</label>
        <input type="range" id="ao-dn-nr" min="1" max="30" step="1" value="12" />
        <label class="control-label" for="ao-dn-nf">Noise floor (dB)</label>
        <input type="number" id="ao-dn-nf" class="form-input" step="1" min="-50" max="-15" value="-25" />
        <label class="control-label" for="ao-dn-rf">Residual floor (dB)</label>
        <input type="number" id="ao-dn-rf" class="form-input" step="1" min="-80" max="-20" value="-50" />
        <label class="control-label" for="ao-dn-nt">Noise type</label>
        <select id="ao-dn-nt" class="form-select">
          <option value="white" selected>White (hiss, fan, room tone)</option>
          <option value="vinyl">Vinyl crackle</option>
          <option value="shellac">Shellac crackle</option>
        </select>
        <label class="control-inline"><input type="checkbox" id="ao-dn-tn" /> Track changing noise (can weaken cleanup on short files)</label>
        <label class="control-label" for="ao-dn-hp">Cut rumble below</label>
        <select id="ao-dn-hp" class="form-select">
          ${ops.HIGHPASS_CHOICES.map((f) => `<option value="${f}"${f === 80 ? ' selected' : ''}>${f === 0 ? 'Off' : f + ' Hz'}</option>`).join('')}
        </select>
        <label class="control-label" for="ao-dn-lp">Cut harsh highs above</label>
        <select id="ao-dn-lp" class="form-select">
          ${ops.LOWPASS_CHOICES.map((f) => `<option value="${f}"${f === 0 ? ' selected' : ''}>${f === 0 ? 'Off' : (f / 1000) + ' kHz'}</option>`).join('')}
        </select>
        <label class="control-inline"><input type="checkbox" id="ao-dn-norm" /> Normalize loudness after cleanup</label>
      </details>
      <label class="control-inline"><input type="checkbox" id="ao-dn-hear" /> Hear the removed noise instead (runs an 8s preview)</label>
      <div class="editor-actions">
        <button type="button" class="btn-secondary" id="ao-dn-preview">▶ Preview 8s</button>
      </div>
      ${dur && dur > ops.LONG_DENOISE_WARN_SECS ? `<p class="au-warn">⚠ ${Math.round(dur / 60)} min of audio - expect a few minutes of processing on phones. Try the 8s preview first.</p>` : ''}
      <p class="field-hint">Best on steady noise (hiss, hum, fan). Crowd babble and music bleed will not clean well.</p>`;
    const applyPreset = () => {
      const p = ops.DENOISE_PRESETS[$('ao-dn-preset').value] || ops.DENOISE_PRESETS.standard;
      $('ao-dn-nr').value = p.nr;
      $('ao-dn-nrv').textContent = `${p.nr} dB`;
      $('ao-dn-nf').value = p.nf;
      $('ao-dn-rf').value = p.rf;
      $('ao-dn-nt').value = p.nt;
      $('ao-dn-tn').checked = p.tn;
      $('ao-dn-hp').value = p.highpass;
      $('ao-dn-lp').value = p.lowpass;
    };
    $('ao-dn-preset').addEventListener('change', applyPreset);
    const markCustom = () => { $('ao-dn-preset').value = 'custom'; };
    ['ao-dn-nf', 'ao-dn-rf', 'ao-dn-nt', 'ao-dn-tn', 'ao-dn-hp', 'ao-dn-lp'].forEach((id) => {
      $(id).addEventListener('change', markCustom);
    });
    $('ao-dn-nr').addEventListener('input', () => {
      $('ao-dn-nrv').textContent = `${$('ao-dn-nr').value} dB`;
      markCustom();
    });
    if ($('ao-dn-vout')) {
      const syncFmt = () => {
        $('audio-out-ext').disabled = $('ao-dn-vout').value === 'video';
        updateBitrateVisibility();
      };
      $('ao-dn-vout').addEventListener('change', syncFmt);
      syncFmt();
    }
    $('ao-dn-preview').addEventListener('click', previewDenoise);
    return;
  }

  if (t === 'tags') {
    el.innerHTML = `
      <p class="field-hint">Rewrites ID3 tags without touching the audio data (stream copy). Output keeps the input format (<b>${item ? item.ext.toUpperCase() : ''}</b>).</p>
      <label class="control-label" for="ao-title">Title</label>
      <input type="text" id="ao-title" class="form-input" placeholder="Song title" />
      <label class="control-label" for="ao-artist">Artist</label>
      <input type="text" id="ao-artist" class="form-input" placeholder="Artist" />
      <label class="control-label" for="ao-album">Album</label>
      <input type="text" id="ao-album" class="form-input" placeholder="Album" />
      <label class="control-label" for="ao-genre">Genre</label>
      <input type="text" id="ao-genre" class="form-input" placeholder="Genre" />
      <label class="control-label" for="ao-year">Year</label>
      <input type="text" id="ao-year" class="form-input" placeholder="2026" />
      <label class="control-label" for="ao-comment">Comment</label>
      <input type="text" id="ao-comment" class="form-input" placeholder="Optional note" />`;
    return;
  }
}

function num(id, fallback = 0) {
  const el = $(id);
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isNaN(v) ? fallback : v;
}

function readPanel() {
  const t = state.tool;
  if (t === 'cut') {
    return {
      start: num('ao-start', state.sel.start),
      end: num('ao-end', state.sel.end),
      fadeIn: num('ao-fadein', 0),
      fadeOut: num('ao-fadeout', 0),
      lossless: !!(($('ao-lossless') || {}).checked),
    };
  }
  if (t === 'vtrim') {
    return {
      start: num('ao-vstart', state.sel.start),
      end: num('ao-vend', state.sel.end),
      keepAudio: !!(($('ao-vaudio') || {}).checked),
      videoMode: state.vtrimMode === 'video',
    };
  }
  if (t === 'fade') return { fadeIn: num('ao-fadein', 2), fadeOut: num('ao-fadeout', 3) };
  if (t === 'normalize') {
    const mode = ($('ao-mode') || {}).value || 'loudnorm';
    return { mode, targetLufs: num('ao-lufs', -14), ceiling: num('ao-ceiling', -1.5), gainDb: num('ao-gain', 0) };
  }
  if (t === 'speed') return { rate: num('ao-rate', 1), semitones: num('ao-pitch', 0) };
  if (t === 'silence') return { thresholdDb: num('ao-threshold', -45), minSilence: num('ao-minsil', 0.4), keepPad: num('ao-pad', 0.15) };
  if (t === 'denoise') {
    return {
      preset: ($('ao-dn-preset') || {}).value || 'standard',
      nr: num('ao-dn-nr', 12), nf: num('ao-dn-nf', -25), rf: num('ao-dn-rf', -50),
      tn: !!(($('ao-dn-tn') || {}).checked),
      nt: ($('ao-dn-nt') || {}).value || 'white',
      highpass: num('ao-dn-hp', 80), lowpass: num('ao-dn-lp', 0),
      profile: !!(($('ao-dn-profile') || {}).checked),
      normalize: !!(($('ao-dn-norm') || {}).checked),
      hear: !!(($('ao-dn-hear') || {}).checked),
      videoOut: denoiseVideoOut(),
    };
  }
  if (t === 'tags') {
    return {
      tags: {
        title: ($('ao-title') || {}).value || '',
        artist: ($('ao-artist') || {}).value || '',
        album: ($('ao-album') || {}).value || '',
        genre: ($('ao-genre') || {}).value || '',
        year: ($('ao-year') || {}).value || '',
        comment: ($('ao-comment') || {}).value || '',
      },
    };
  }
  return {};
}

// ============================================
// Run
// ============================================
/** Returns an error string when a video trim cannot run as configured, else null. */
function vtrimGuardrail(item, o, outExt) {
  if (!item.isVideo) return 'Trim Video needs a video file (MP4/MOV/MKV/AVI/WEBM).';
  if (!(o.end > o.start)) return 'Pick an end time after the start time.';
  if (item.duration && o.start >= item.duration) return `Start time is past the end of the clip (${formatTime(item.duration)}).`;
  if (o.videoMode && !ops.canLosslessVideoTrim(item.ext, outExt)) {
    return `A ${item.ext.toUpperCase()} file cannot be stream-copied into ${outExt.toUpperCase()}. Choose the source container (or MKV), or switch to Audio only.`;
  }
  return null;
}

/** Returns an error string when the denoise settings cannot run, else null. */
function denoiseGuardrail(item, o) {
  if (!o.profile) return null;
  if (!item.duration) return 'Waveform unavailable - type exact times or pick a preset without the noise profile.';
  const len = state.sel.end - state.sel.start;
  if (!(len >= 0.5)) return 'Drag a noise-only stretch on the waveform first (at least half a second).';
  if (len >= item.duration * 0.5) return 'That selection covers most of the file - pick a short noise-only stretch instead.';
  return null;
}

/**
 * Video-out denoising as two passes. The pinned core traps when `-c:v copy`
 * meets `-af` in one command, so pass 1 denoises the audio alone (proven
 * extract-style path) and pass 2 muxes with pure stream copy (no filters,
 * no re-encode). Returns { res, mime, outName } like a single runFFmpeg call.
 */
async function runDenoiseVideo(item, o, { previewFrom = null, previewLen = null, listenRemoved = false, onProgress = () => {} } = {}) {
  const br = bitrate();
  const audioExt = ops.VIDEO_CONTAINER_AUDIO[item.ext] || 'aac';
  const tmpExt = ops.intermediateAudioExt(item.ext);
  const inName = fsName(`in.${item.ext}`);
  const tmpName = fsName(`dn_tmp.${tmpExt}`);
  const outName = fsName(`out.${item.ext}`);
  const mime = ops.VIDEO_MIME_TYPES[item.ext] || 'video/mp4';
  const chainOpts = {
    highpass: o.highpass, lowpass: o.lowpass,
    nr: o.nr, nf: o.nf, rf: o.rf, tn: o.tn, nt: o.nt,
    listenRemoved,
    profileStart: o.profile ? state.sel.start : null,
    profileEnd: o.profile ? state.sel.end : null,
    normalize: o.normalize, outExt: audioExt, bitrate: br, isVideo: true,
  };
  if (previewFrom != null && previewLen != null) {
    chainOpts.previewFrom = previewFrom;
    chainOpts.previewLen = previewLen;
  }
  const [tmp] = await runFFmpeg({
    args: ops.buildDenoise({ inName, outName: tmpName, ...chainOpts }),
    inputs: [{ name: inName, file: item.file }],
    outputs: [{ name: tmpName, type: 'audio/' + tmpExt }],
    onProgress: (f, m) => onProgress(f * 0.7, (m ? m + ' · ' : '') + 'Cleaning audio (1/2)'),
  });
  const [res] = await runFFmpeg({
    args: ops.buildRemux({ videoIn: inName, audioIn: tmpName, outName }),
    inputs: [{ name: inName, file: item.file }, { name: tmpName, data: tmp.bytes }],
    outputs: [{ name: outName, type: mime }],
    onProgress: (f, m) => onProgress(0.7 + f * 0.3, 'Muxing video (2/2)'),
  });
  return { res, mime, outName };
}

/** Runs the current denoise settings on a short window so users can hear it first. */
async function previewDenoise() {
  const item = activeFile();
  if (!item) return;
  const o = readPanel();
  if (o.profile) {
    const problem = denoiseGuardrail(item, o);
    if (problem) { toast(problem); return; }
  }
  const useProfile = o.profile && !!item.duration;
  let from = 0;
  let len = Math.min(item.duration || ops.DENOISE_PREVIEW_SECS, ops.DENOISE_PREVIEW_SECS);
  if (useProfile) {
    from = Math.max(0, state.sel.start - 2);
    len = Math.min((item.duration || from + 10) - from, (state.sel.end - state.sel.start) + 4, 12);
  }
  const videoMode = item.isVideo && o.videoOut;
  const ext = videoMode ? item.ext : fmtOutExt();
  const br = bitrate();
  const audioMeta = ops.AUDIO_OUT_FORMATS.find((f) => f.ext === ext);
  const mime = audioMeta ? audioMeta.mime : (ops.VIDEO_MIME_TYPES[ext] || 'application/octet-stream');

  const progress = $('audio-progress');
  const bar = $('audio-progress-bar');
  const text = $('audio-progress-text');
  progress.classList.remove('hidden');
  bar.style.width = '0%';
  text.textContent = 'Rendering preview…';
  $('audio-run').disabled = true;
  $('audio-cancel').classList.remove('hidden');
  const myRun = ++runSeq;
  liveRunId = myRun;
  startElapsed();

  try {
    const inName = fsName(`in.${item.ext}`);
    const outName = fsName(`preview.${ext}`);
    let res;
    if (videoMode) {
      ({ res } = await runDenoiseVideo(item, o, {
        previewFrom: from, previewLen: len, listenRemoved: o.hear,
        onProgress: (frac, msg) => {
          bar.style.width = `${Math.max(0, Math.min(100, Math.round(frac * 100)))}%`;
          text.textContent = msg || 'Rendering preview…';
        },
      }));
    } else {
      const args = ops.buildDenoise({
        inName, outName, highpass: o.highpass, lowpass: o.lowpass,
        nr: o.nr, nf: o.nf, rf: o.rf, tn: o.tn, nt: o.nt,
        listenRemoved: o.hear,
        profileStart: useProfile ? state.sel.start : null,
        profileEnd: useProfile ? state.sel.end : null,
        normalize: o.normalize, outExt: ext, bitrate: br,
        isVideo: item.isVideo,
        previewFrom: from, previewLen: len,
      });
      const [r] = await runFFmpeg({
        args,
        inputs: [{ name: inName, file: item.file }],
        outputs: [{ name: outName, type: mime }],
        onProgress: (frac, msg) => {
          bar.style.width = `${Math.max(0, Math.min(100, Math.round(frac * 100)))}%`;
          text.textContent = msg || 'Rendering preview…';
        },
      });
      res = r;
    }
    if (liveRunId !== myRun) return; // cancelled while finishing: discard result, stay quiet
    addResult(`${baseName(item.name)}-denoise-preview.${ext}`, res.bytes, mime);
    text.textContent = 'Done!';
    bar.style.width = '100%';
    toast(o.hear ? 'That is the removed noise - Process cleans the whole file.' : 'Preview rendered - Process runs the whole file.');
  } catch (err) {
    if (liveRunId !== myRun) return; // cancelled - cancelAudioRun already reported
    console.error('Denoise preview failed:', err);
    toast((err && err.message ? err.message : String(err)).slice(0, 200));
    progress.classList.add('hidden');
  } finally {
    stopElapsed();
    $('audio-cancel').classList.add('hidden');
    $('audio-run').disabled = false;
    if (liveRunId === myRun) liveRunId = 0;
  }
}

async function runTool() {
  const item = activeFile();
  if (!item) return;

  const o = readPanel();
  const outExt = effectiveOutExt();
  const br = bitrate();
  const audioMeta = ops.AUDIO_OUT_FORMATS.find((f) => f.ext === outExt);
  const mime = audioMeta ? audioMeta.mime : (ops.VIDEO_MIME_TYPES[outExt] || 'application/octet-stream');
  const base = baseName(item.name);

  const progress = $('audio-progress');
  const bar = $('audio-progress-bar');
  const text = $('audio-progress-text');
  const runBtn = $('audio-run');
  progress.classList.remove('hidden');
  bar.style.width = '0%';
  text.textContent = 'Preparing…';
  runBtn.disabled = true;
  $('audio-cancel').classList.remove('hidden');
  const myRun = ++runSeq;
  liveRunId = myRun;
  startElapsed();

  /** Refuse a run before touching FFmpeg: toast, restore the UI, stay idle. */
  const bailRun = (msg) => {
    toast(msg);
    progress.classList.add('hidden');
    stopElapsed();
    $('audio-cancel').classList.add('hidden');
    runBtn.disabled = false;
    liveRunId = 0;
  };

  try {
    let args = [];
    let inputs = [];
    let outName = '';
    let downloadName = `${base}-${state.tool}.${outExt}`;
    let precomputedRes = null;

    if (state.tool === 'merge') {
      const mergeItems = state.files.filter((f) => !f.isVideo);
      const names = mergeItems.map((f, i) => fsName(`m${i}.${f.ext}`));
      inputs = mergeItems.map((f, i) => ({ name: names[i], file: f.file }));
      inputs.push({ name: 'list.txt', data: ops.concatList(names) });
      outName = fsName(`merged.${outExt}`);
      args = ops.buildConcat({ outName, outExt, bitrate: br });
      downloadName = `merged-${mergeItems.length}-tracks.${outExt}`;
    } else {
      const inName = fsName(`in.${item.ext}`);
      inputs = [{ name: inName, file: item.file }];
      outName = fsName(`out.${outExt}`);

      if (state.tool === 'cut') {
        args = ops.buildTrim({ inName, outName, start: o.start, end: o.end, outExt, bitrate: br, fadeIn: o.fadeIn, fadeOut: o.fadeOut, lossless: o.lossless, audioOnly: item.isVideo });
      } else if (state.tool === 'vtrim') {
        const guard = vtrimGuardrail(item, o, outExt);
        if (guard) { bailRun(guard); return; }
        downloadName = `${base}-trimmed.${outExt}`;
        if (o.videoMode) {
          args = ops.buildVideoTrim({
            inName, outName, start: o.start, end: o.end,
            keepVideo: true, keepAudio: o.keepAudio,
          });
        } else {
          // Audio-only mode reuses the proven audio cutter path.
          args = ops.buildTrim({
            inName, outName, start: o.start, end: o.end, outExt, bitrate: br,
            fadeIn: 0, fadeOut: 0, lossless: false, audioOnly: true,
          });
        }
      } else if (state.tool === 'fade') {
        args = ops.buildFade({ inName, outName, duration: item.duration, fadeIn: o.fadeIn, fadeOut: o.fadeOut, outExt, bitrate: br });
      } else if (state.tool === 'normalize') {
        args = ops.buildNormalize({ inName, outName, mode: o.mode, targetLufs: o.targetLufs, ceiling: o.ceiling, gainDb: o.gainDb, outExt, bitrate: br });
      } else if (state.tool === 'speed') {
        const chain = [...ops.atempoChain(o.rate)];
        if (o.semitones) {
          const factor = Math.pow(2, o.semitones / 12);
          const rate0 = item.sampleRate || 44100;
          chain.push(
            `aresample=${Math.round(rate0)}`,
            `asetrate=${Math.round(rate0 * factor)}`,
            `aresample=${Math.round(rate0)}`,
            ...ops.atempoChain(1 / factor)
          );
        }
        args = ['-i', inName];
        if (chain.length) args.push('-af', chain.join(','));
        args.push(...ops.codecArgs(outExt, br), '-y', outName);
      } else if (state.tool === 'extract') {
        args = ops.buildExtractAudio({ inName, outName, outExt, bitrate: br });
      } else if (state.tool === 'silence') {
        args = ops.buildSilenceTrim({ inName, outName, thresholdDb: o.thresholdDb, minSilence: o.minSilence, keepPad: o.keepPad, outExt, bitrate: br });
      } else if (state.tool === 'denoise') {
        const videoMode = item.isVideo && o.videoOut;
        const guard = denoiseGuardrail(item, o);
        if (guard) { bailRun(guard); return; }
        if (item.duration && item.duration > ops.LONG_DENOISE_WARN_SECS) {
          toast(`Long file (${formatTime(item.duration)}) - this can take a few minutes.`);
        }
        downloadName = `${base}-denoised.${outExt}`;
        if (videoMode) {
          const r = await runDenoiseVideo(item, o, {
            listenRemoved: false,
            onProgress: (frac, msg) => {
              bar.style.width = `${Math.max(0, Math.min(100, Math.round(frac * 100)))}%`;
              text.textContent = msg || 'Working…';
            },
          });
          precomputedRes = r.res;
        } else {
          args = ops.buildDenoise({
            inName, outName, highpass: o.highpass, lowpass: o.lowpass,
            nr: o.nr, nf: o.nf, rf: o.rf, tn: o.tn, nt: o.nt,
            listenRemoved: false,
            profileStart: o.profile ? state.sel.start : null,
            profileEnd: o.profile ? state.sel.end : null,
            normalize: o.normalize, outExt, bitrate: br,
            isVideo: item.isVideo,
          });
        }
      } else if (state.tool === 'reverse') {
        args = ops.buildReverse({ inName, outName, outExt, bitrate: br });
      } else if (state.tool === 'tags') {
        args = ops.buildTags({ inName, outName, tags: o.tags, audioOnly: item.isVideo });
        downloadName = `${base}-tagged.${outExt}`;
      }
    }

    let res = precomputedRes;
    if (!res) {
      const [r] = await runFFmpeg({
        args,
        inputs,
        outputs: [{ name: outName, type: mime }],
        onProgress: (frac, msg) => {
          bar.style.width = `${Math.max(0, Math.min(100, Math.round(frac * 100)))}%`;
          text.textContent = msg || 'Working…';
        },
      });
      res = r;
    }

    if (liveRunId !== myRun) return; // cancelled while finishing: discard result, stay quiet
    addResult(downloadName, res.bytes, mime);
    text.textContent = 'Done!';
    bar.style.width = '100%';
  } catch (err) {
    if (liveRunId !== myRun) return; // cancelled - cancelAudioRun already reported
    console.error('Audio tool failed:', err);
    toast((err && err.message ? err.message : String(err)).slice(0, 200));
    progress.classList.add('hidden');
  } finally {
    stopElapsed();
    $('audio-cancel').classList.add('hidden');
    runBtn.disabled = false;
    if (liveRunId === myRun) liveRunId = 0;
  }
}

// ============================================
// Results
// ============================================
function addResult(name, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  state.results.push({
    id: ++state.resSeq,
    name,
    mime,
    blob,
    url: URL.createObjectURL(blob),
    size: blob.size,
  });
  renderResults();
}

function renderResults() {
  const wrap = $('audio-results');
  if (!state.results.length) {
    wrap.innerHTML = '<p class="audio-empty-note">No results yet - pick a tool and press Process.</p>';
    return;
  }
  wrap.innerHTML = state.results
    .map((r) => {
      const armed = state.confirm.kind === 'result' && state.confirm.id === r.id;
      return `<div class="audio-result${armed ? ' armed' : ''}">
        <span class="af-icon">🎧</span>
        <span class="ar-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
        <span class="ar-meta">${formatBytes(r.size)}</span>
        <span class="ar-actions">
          <button type="button" class="btn-secondary btn-mini" data-act="play" data-id="${r.id}">▶</button>
          <button type="button" class="btn-primary btn-mini" data-act="download" data-id="${r.id}">⬇</button>
          <button type="button" class="btn-secondary btn-mini" data-act="share" data-id="${r.id}">📤</button>
          <button type="button" class="btn-secondary btn-mini${armed ? ' armed' : ''}" data-act="remove" data-id="${r.id}"
            title="${armed ? 'Click again to delete this result' : 'Delete this result'}">${armed ? '✓ Delete' : '✕'}</button>
        </span>
      </div>`;
    })
    .join('');

  wrap.querySelectorAll('button[data-act]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = state.results.find((x) => x.id === parseInt(b.dataset.id, 10));
      if (!r) return;
      const act = b.dataset.act;
      if (act === 'download') downloadResult(r);
      else if (act === 'play') playResult(r, b);
      else if (act === 'share') shareResult(r);
      else if (act === 'remove') armDelete('result', r.id);
    });
  });
}

function downloadResult(r) {
  const a = document.createElement('a');
  a.href = r.url;
  a.download = r.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function playResult(r, btn) {
  if (!resultPlayer) {
    resultPlayer = new Audio();
    resultPlayer.addEventListener('ended', () => {
      $('audio-results').querySelectorAll('[data-act="play"]').forEach((b) => { b.textContent = '▶'; });
    });
  }
  if (resultPlayer.dataset.id === String(r.id) && !resultPlayer.paused) {
    resultPlayer.pause();
    btn.textContent = '▶';
    return;
  }
  resultPlayer.pause();
  resultPlayer.src = r.url;
  resultPlayer.dataset.id = String(r.id);
  $('audio-results').querySelectorAll('[data-act="play"]').forEach((b) => { b.textContent = '▶'; });
  btn.textContent = '⏸';
  resultPlayer.play().catch((err) => {
    toast('Cannot preview this format here (' + (err.message || err) + ')');
    btn.textContent = '▶';
  });
}

async function shareResult(r) {
  const file = new File([r.blob], r.name, { type: r.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: r.name });
    } catch (e) {
      if (e.name !== 'AbortError') toast('Share failed');
    }
  } else {
    downloadResult(r);
    toast('Sharing not supported - downloaded instead');
  }
}

function clearResults() {
  clearTimeout(state.confirmTimer);
  state.confirm = { kind: null, id: null };
  if (resultPlayer) {
    resultPlayer.pause();
    resultPlayer.removeAttribute('src');
  }
  for (const r of state.results) URL.revokeObjectURL(r.url);
  state.results = [];
  renderResults();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}