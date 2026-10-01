/**
 * Waveform rendering - peaks, canvas draw, time/x mapping.
 * Pure-ish: compute/format/map helpers are Node-testable; draw needs a 2D context.
 */

import { MP3_FRAME_SAMPLES } from './ops.js';

/**
 * Build min/max peaks from an AudioBuffer-like object.
 * Mixes all channels into one peak column per bucket.
 * @returns {{min:Float32Array,max:Float32Array}}
 */
export function computePeaks(buffer, buckets) {
  const b = Math.max(1, Math.min(buckets | 0 || 1, buffer.length || 1));
  const min = new Float32Array(b);
  const max = new Float32Array(b);
  const channels = Math.max(1, buffer.numberOfChannels || 1);
  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  const samplesPerBucket = buffer.length / b;
  for (let i = 0; i < b; i++) {
    const from = Math.floor(i * samplesPerBucket);
    const to = Math.max(from + 1, Math.min(buffer.length, Math.ceil((i + 1) * samplesPerBucket)));
    let lo = 0;
    let hi = 0;
    for (let s = from; s < to; s++) {
      for (let c = 0; c < channels; c++) {
        const v = data[c][s];
        if (v < lo) lo = v;
        else if (v > hi) hi = v;
      }
    }
    min[i] = lo;
    max[i] = hi;
  }
  return { min, max };
}

/** Peaks from mono signed 16-bit PCM (FFmpeg -f s16le fallback path). */
export function computePeaksFromPcm(int16, buckets) {
  const b = Math.max(1, Math.min(buckets | 0 || 1, int16.length || 1));
  const min = new Float32Array(b);
  const max = new Float32Array(b);
  const samplesPerBucket = int16.length / b;
  for (let i = 0; i < b; i++) {
    const from = Math.floor(i * samplesPerBucket);
    const to = Math.max(from + 1, Math.min(int16.length, Math.ceil((i + 1) * samplesPerBucket)));
    let lo = 0;
    let hi = 0;
    for (let s = from; s < to; s++) {
      const v = int16[s] / 32768;
      if (v < lo) lo = v;
      else if (v > hi) hi = v;
    }
    min[i] = lo;
    max[i] = hi;
  }
  return { min, max };
}

export function timeAtX(x, width, duration) {
  if (!width || !duration) return 0;
  return Math.max(0, Math.min(duration, (x / width) * duration));
}

export function xAtTime(t, width, duration) {
  if (!duration) return 0;
  return Math.max(0, Math.min(width, (t / duration) * width));
}

/**
 * MP3 (and most MPEG audio) can only be cut on frame boundaries.
 * @param {number} t seconds
 * @param {number} sampleRate
 */
export function frameSnap(t, sampleRate, framesPerFrame = MP3_FRAME_SAMPLES) {
  if (!sampleRate) return Math.round(t * 1000) / 1000;
  const frameDur = framesPerFrame / sampleRate;
  return Math.round(t / frameDur) * frameDur;
}

/** "m:ss.mmm" */
export function formatTime(t) {
  const s = Math.max(0, t || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Draw waveform + selection + playhead.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawWaveform(ctx, opts) {
  if (!ctx) return;
  const {
    peaks,
    width,
    height,
    playRatio = 0,
    selStart = 0,
    selEnd = 0,
    duration = 0,
    color = '#4c4a6b',
    progressColor = '#a855f7',
    selColor = 'rgba(168,85,247,0.18)',
    selEdge = '#a855f7',
    dpr = 1,
  } = opts;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const mid = height / 2;
  const amp = height / 2 - 2;

  if (!peaks || !peaks.min.length) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const n = peaks.min.length;
  const barW = width / n;
  const playedUpTo = playRatio * width;

  for (let i = 0; i < n; i++) {
    const x = i * barW;
    const lo = peaks.min[i] * amp;
    const hi = peaks.max[i] * amp;
    ctx.fillStyle = x <= playedUpTo ? progressColor : color;
    ctx.fillRect(x, mid + lo, Math.max(1, barW - 1), Math.max(1, hi - lo));
  }

  // Selection band (only when duration is known)
  if (duration > 0 && selEnd > selStart) {
    const x1 = xAtTime(selStart, width, duration);
    const x2 = xAtTime(selEnd, width, duration);
    ctx.fillStyle = selColor;
    ctx.fillRect(0, 0, x1, height);
    ctx.fillRect(x2, 0, width - x2, height);
    ctx.fillStyle = selEdge;
    ctx.fillRect(x1, 0, 2, height);
    ctx.fillRect(x2 - 2, 0, 2, height);
  }

  // Playhead
  if (playRatio > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(playedUpTo - 1, 0, 2, height);
  }

  ctx.restore();
}