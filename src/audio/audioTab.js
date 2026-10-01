/**
 * Audio Toolbox tab - waveform, transport, 9 FFmpeg tools, results list.
 * Everything runs client-side on the shared FFmpeg singleton.
 */

import { runFFmpeg, fsName } from '../converters/media.js';
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
const MAX_FILES = 12;
const WEB_AUDIO_SKIP_BYTES = 80 * 1024 * 1024;
const PCM_FALLBACK_RATE = 8000;

const state = {
  files: [],
  activeId: null,
  seq: 0,
  resSeq: 0,
  tool: 'cut',
  sel: { start: 0, end: 0 },
  results: [],
  drag: null,
};

let canvas = null;
let ctx = null;
let player = null;
let resultPlayer = null;
let rafId = null;
let toastTimer = null;

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

function bitrate() {
  return parseInt($('audio-bitrate').value, 10) || 192;
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

  // Output format / bitrate
  const sel = $('audio-out-ext');
  sel.innerHTML = ops.AUDIO_OUT_FORMATS.map((f) => `<option value="${f.ext}">${f.label}</option>`).join('');
  sel.value = 'mp3';
  sel.addEventListener('change', () => {
    updateBitrateVisibility();
    renderTools();
    renderPanel();
  });
  $('audio-bitrate').innerHTML = ops.BITRATES.map((b) => `<option value="${b}"${b === 192 ? ' selected' : ''}>${b} kbps</option>`).join('');
  $('audio-bitrate').addEventListener('change', renderPanel);
  updateBitrateVisibility();

  // Tools
  $('audio-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.audio-tool-btn');
    if (!btn || btn.disabled) return;
    state.tool = btn.dataset.tool;
    renderTools();
    renderPanel();
  });

  $('audio-run').addEventListener('click', runTool);
  $('audio-clear-results').addEventListener('click', clearResults);

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

  // Render the disabled tool rail + empty panel before any file is loaded.
  renderTools();
  renderPanel();
  renderResults();
}

function updateBitrateVisibility() {
  const ext = fmtOutExt();
  $('audio-bitrate-group').classList.toggle('hidden', ['wav', 'flac'].includes(ext));
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
  for (const file of list) {
    const ext = ops.extOf(file.name);
    if (!ops.isSupportedInput(ext)) {
      rejected.push(file.name);
      continue;
    }
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
  if (!accepted.length) return;

  $('audio-upload-zone').style.display = 'none';
  $('audio-workspace').classList.remove('hidden');

  renderFileList();
  const target = accepted.length ? state.files.find((f) => f.id === state.seq) : activeFile();
  if (target) setActive(target.id);
  else renderTools();
}

function renderFileList() {
  const list = $('audio-file-list');
  $('audio-file-count').textContent = String(state.files.length);
  list.innerHTML = state.files
    .map((f) => {
      const dur = f.duration ? ` · ${formatTime(f.duration)}` : '';
      return `<button class="audio-file-chip${f.id === state.activeId ? ' active' : ''}" data-id="${f.id}" type="button">
        <span class="af-icon">${f.isVideo ? '🎬' : '🎵'}</span>
        <span class="af-name">${escapeHtml(f.name)}</span>
        <span class="af-meta">${formatBytes(f.size)}${dur}</span>
      </button>`;
    })
    .join('');

  list.querySelectorAll('.audio-file-chip').forEach((chip) => {
    chip.addEventListener('click', () => setActive(parseInt(chip.dataset.id, 10)));
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
  const bar = $('audio-toolbar');
  bar.innerHTML = ops.TOOLS.map((t) => {
    let disabled = false;
    if (t.needsVideo) disabled = !(item && item.isVideo);
    else if (t.needsAudio) disabled = !(item && !item.isVideo);
    else if (t.id === 'merge') disabled = state.files.filter((f) => !f.isVideo).length < 2;
    else if (t.id === 'tags') disabled = !(item && ops.isTaggable(item.ext));
    return `<button type="button" class="audio-tool-btn${state.tool === t.id ? ' active' : ''}" data-tool="${t.id}"${disabled ? ' disabled' : ''}>${t.label}</button>`;
  }).join('');
}

function renderPanel() {
  const el = $('audio-tool-panel');
  const item = activeFile();
  const dur = item && item.duration ? item.duration : 0;
  const maxAttr = dur ? ops.r3(dur) : '0';
  const losslessOk = item ? ops.canLosslessTrim(item.ext, fmtOutExt()) : false;
  const t = state.tool;

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

  if (t === 'merge') {
    const audioOnly = state.files.filter((f) => !f.isVideo);
    const videos = state.files.filter((f) => f.isVideo);
    el.innerHTML = `
      <label class="control-label">Merge order (top to bottom)</label>
      ${state.files.map((f, i) => `<div class="audio-result">
          <span class="ar-name">${i + 1}. ${escapeHtml(f.name)}</span>
          <span class="ar-meta">${f.isVideo ? 'video - skipped' : formatBytes(f.size)}</span>
          <span class="ar-actions">
            <button type="button" class="btn-secondary btn-mini" data-mv="up" data-i="${i}"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="btn-secondary btn-mini" data-mv="down" data-i="${i}"${i === state.files.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="btn-secondary btn-mini" data-mv="rm" data-i="${i}">✕</button>
          </span>
        </div>`).join('')}
      <p class="field-hint">Merges ${audioOnly.length} audio file${audioOnly.length === 1 ? '' : 's'} into one track, re-encoded to the chosen format so mixed sources still join cleanly.${videos.length ? ` Video files (${videos.length}) are skipped - use Extract Audio on them first.` : ''}</p>`;
    el.querySelectorAll('[data-mv]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.i, 10);
        const mv = b.dataset.mv;
        if (mv === 'up' && i > 0) [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]];
        else if (mv === 'down' && i < state.files.length - 1) [state.files[i + 1], state.files[i]] = [state.files[i], state.files[i + 1]];
        else if (mv === 'rm') {
          const [gone] = state.files.splice(i, 1);
          if (gone) URL.revokeObjectURL(gone.url);
          if (gone && gone.id === state.activeId) state.activeId = null;
        }
        if (!state.activeId && state.files.length) {
          const keep = state.files.find((f) => f.peaks) || state.files[0];
          setActive(keep.id);
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
  if (t === 'fade') return { fadeIn: num('ao-fadein', 2), fadeOut: num('ao-fadeout', 3) };
  if (t === 'normalize') {
    const mode = ($('ao-mode') || {}).value || 'loudnorm';
    return { mode, targetLufs: num('ao-lufs', -14), ceiling: num('ao-ceiling', -1.5), gainDb: num('ao-gain', 0) };
  }
  if (t === 'speed') return { rate: num('ao-rate', 1), semitones: num('ao-pitch', 0) };
  if (t === 'silence') return { thresholdDb: num('ao-threshold', -45), minSilence: num('ao-minsil', 0.4), keepPad: num('ao-pad', 0.15) };
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
async function runTool() {
  const item = activeFile();
  if (!item) return;

  const o = readPanel();
  const outExt = state.tool === 'tags' ? item.ext : fmtOutExt();
  const br = bitrate();
  const meta = ops.AUDIO_OUT_FORMATS.find((f) => f.ext === outExt);
  const mime = (meta ? meta.mime : 'application/octet-stream');
  const base = baseName(item.name);

  const progress = $('audio-progress');
  const bar = $('audio-progress-bar');
  const text = $('audio-progress-text');
  const runBtn = $('audio-run');
  progress.classList.remove('hidden');
  bar.style.width = '0%';
  text.textContent = 'Preparing…';
  runBtn.disabled = true;

  try {
    let args = [];
    let inputs = [];
    let outName = '';
    let downloadName = `${base}-${state.tool}.${outExt}`;

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
        args = ops.buildTrim({ inName, outName, start: o.start, end: o.end, outExt, bitrate: br, fadeIn: o.fadeIn, fadeOut: o.fadeOut, lossless: o.lossless });
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
      } else if (state.tool === 'reverse') {
        args = ops.buildReverse({ inName, outName, outExt, bitrate: br });
      } else if (state.tool === 'tags') {
        args = ops.buildTags({ inName, outName, tags: o.tags });
        downloadName = `${base}-tagged.${outExt}`;
      }
    }

    const [res] = await runFFmpeg({
      args,
      inputs,
      outputs: [{ name: outName, type: mime }],
      onProgress: (frac, msg) => {
        bar.style.width = `${Math.max(0, Math.min(100, Math.round(frac * 100)))}%`;
        text.textContent = msg || 'Working…';
      },
    });

    addResult(downloadName, res.bytes, mime);
    text.textContent = 'Done!';
    bar.style.width = '100%';
  } catch (err) {
    console.error('Audio tool failed:', err);
    toast((err && err.message ? err.message : String(err)).slice(0, 200));
    progress.classList.add('hidden');
  } finally {
    runBtn.disabled = false;
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
    .map(
      (r) => `<div class="audio-result">
        <span class="af-icon">🎧</span>
        <span class="ar-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
        <span class="ar-meta">${formatBytes(r.size)}</span>
        <span class="ar-actions">
          <button type="button" class="btn-secondary btn-mini" data-act="play" data-id="${r.id}">▶</button>
          <button type="button" class="btn-primary btn-mini" data-act="download" data-id="${r.id}">⬇</button>
          <button type="button" class="btn-secondary btn-mini" data-act="share" data-id="${r.id}">📤</button>
          <button type="button" class="btn-secondary btn-mini" data-act="remove" data-id="${r.id}">✕</button>
        </span>
      </div>`
    )
    .join('');

  wrap.querySelectorAll('button[data-act]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = state.results.find((x) => x.id === parseInt(b.dataset.id, 10));
      if (!r) return;
      const act = b.dataset.act;
      if (act === 'download') downloadResult(r);
      else if (act === 'play') playResult(r, b);
      else if (act === 'share') shareResult(r);
      else if (act === 'remove') {
        URL.revokeObjectURL(r.url);
        state.results = state.results.filter((x) => x.id !== r.id);
        renderResults();
      }
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
  for (const r of state.results) URL.revokeObjectURL(r.url);
  state.results = [];
  renderResults();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}