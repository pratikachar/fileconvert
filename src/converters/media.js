/**
 * Media Converter - Uses FFmpeg.wasm for audio & video conversion
 * Audio: MP3, WAV, OGG, AAC, FLAC, M4A, WMA
 * Video: MP4, WebM, AVI, MKV, MOV, FLV
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { OUTPUT_MIME_TYPES } from './registry.js';

let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoading = false;
let progressSink = null;
let nameSeq = 0;
/** Ring buffer of recent ffmpeg stderr lines, so failures can quote the real cause. */
const recentLogs = [];

/**
 * Build a unique, filesystem-safe name for FFmpeg's in-memory FS.
 * Callers must use the returned string in both `args` and `inputs`.
 */
export function fsName(base) {
  const safe = String(base).replace(/[^A-Za-z0-9._-]/g, '_').slice(-60) || 'file';
  return `ff_${++nameSeq}_${safe}`;
}

/**
 * Load FFmpeg.wasm (lazy-loaded, only when needed). Returns the shared
 * singleton so every feature reuses the one ~31MB core download.
 * @param {function} onProgress - Loading progress callback
 */
export async function getFFmpeg(onProgress = () => {}) {
  if (ffmpegLoaded) return ffmpeg;
  if (ffmpegLoading) {
    // Wait for existing load to complete
    while (ffmpegLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (ffmpegLoaded) return ffmpeg;
  }

  ffmpegLoading = true;
  onProgress(0, 'Loading FFmpeg engine...');

  try {
    ffmpeg = new FFmpeg();

    // Log FFmpeg output for debugging
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
      recentLogs.push(message);
      if (recentLogs.length > 200) recentLogs.shift();
    });

    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

    onProgress(10, 'Downloading FFmpeg core (~31MB, first time only)...');

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    // Registered once here (was re-registered on every convertMedia call,
    // which leaked listeners and multiplied progress callbacks).
    ffmpeg.on('progress', ({ progress }) => {
      if (progressSink) progressSink(Number.isFinite(progress) ? progress : 0);
    });

    ffmpegLoaded = true;
    onProgress(30, 'FFmpeg ready!');
    return ffmpeg;
  } catch (err) {
    ffmpegLoading = false;
    throw new Error(
      'Failed to load FFmpeg. This feature requires Cross-Origin Isolation headers. ' +
      'If running locally, make sure you\'re using the Vite dev server (npm run dev). ' +
      'Error: ' + err.message
    );
  } finally {
    ffmpegLoading = false;
  }
}

/**
 * True when the error is a wasm-engine trap (not an ordinary bad-arguments or
 * missing-file failure). Pure and Node-testable.
 */
export function getRecentFFmpegLogs() {
  return recentLogs.slice();
}
export function clearFFmpegLogs() {
  recentLogs.length = 0;
}

export function isWasmTrapError(err) {
  const msg = String((err && err.message) || err || '');
  if (/No such file|Invalid (argument|data)|not found|exited with code/i.test(msg)) return false;
  return /memory access out of bounds|out of memory|RuntimeError|abort/i.test(msg);
}

/**
 * A wasm trap (e.g. "memory access out of bounds") bricks the shared instance:
 * every later exec fails the same way until the core is reloaded. Detect it and
 * drop the instance so the next call transparently loads a fresh one instead of
 * failing forever. Ordinary command failures (bad args, missing files) never match.
 * Returns true when a reset happened (caller may retry once).
 */
function noteFFmpegCrash(err) {
  if (!isWasmTrapError(err)) return false;
  ffmpeg = null;
  ffmpegLoaded = false;
  return true;
}

/** Last few ffmpeg stderr lines, for quoting the real cause in errors. */
function ffmpegTail() {
  return recentLogs.slice(-3).join(' / ').slice(-160);
}

/**
 * Run one FFmpeg command against the shared engine.
 * Writes `inputs`, execs `args`, reads `outputs`, then always deletes the
 * temp files (matters when a tool writes a dozen intermediates).
 *
 * @param {object} o
 * @param {string[]} o.args - FFmpeg argv (use fsName() for every file path)
 * @param {Array<{name:string, file?:File, data?:Uint8Array|string}>} o.inputs
 * @param {Array<{name:string, type?:string}>} o.outputs
 * @param {function} o.onProgress - (fraction 0..1, message) => void
 * @returns {Promise<Array<{name:string, bytes:Uint8Array, type:string}>>}
 */
export async function runFFmpeg({ args, inputs = [], outputs = [], onProgress = () => {}, _retried = false }) {
  const ff = await getFFmpeg((p, m) => onProgress(p * 0.3, m));
  const prevSink = progressSink;
  progressSink = (ratio) => onProgress(0.3 + ratio * 0.65);

  const written = inputs.map((i) => i.name);
  try {
    for (const input of inputs) {
      const src = input.data !== undefined ? input.data : await fetchFile(input.file);
      // The worker transfer detaches input buffers, so always send a copy:
      // reusing a buffer (e.g. on retry) would post a detached ArrayBuffer.
      const data = src.slice ? src.slice() : src;
      await ff.writeFile(input.name, data);
    }

    // exec() resolves with the exit code: a nonzero code means ffmpeg gave up
    // (bad combo, unreadable input...) and any partial output must NOT be
    // presented as a success.
    const code = await ff.exec(args);
    if (code !== 0) {
      throw new Error(`FFmpeg exited with code ${code}. The codec/format combination may not be supported in the browser build.`);
    }

    const results = [];
    for (const out of outputs) {
      const data = await ff.readFile(out.name);
      results.push({
        name: out.name,
        bytes: data instanceof Uint8Array ? data : new Uint8Array(data),
        type: out.type || 'application/octet-stream',
      });
    }
    onProgress(1, 'Done!');
    return results;
  } catch (err) {
    // A trap poisons the shared instance; retry once on a transparently
    // reloaded core instead of failing forever. Bounded by _retried.
    if (!_retried && noteFFmpegCrash(err)) {
      progressSink = prevSink;
      return runFFmpeg({ args, inputs, outputs, onProgress, _retried: true });
    }
    noteFFmpegCrash(err);
    const tail = ffmpegTail();
    throw new Error(
      `FFmpeg command failed${tail ? ' - ' + tail : ''}. ${(err && err.message) || err} ` +
      'The codec/format combination may not be supported in the browser build.'
    );
  } finally {
    progressSink = prevSink;
    for (const n of written.concat(outputs.map((o) => o.name))) {
      try { await ff.deleteFile(n); } catch { /* already gone */ }
    }
  }
}

/**
 * Get FFmpeg output arguments for a given output extension
 */
function getFFmpegArgs(inputExt, outputExt) {
  const audioCodecs = {
    mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
    wav: ['-c:a', 'pcm_s16le'],
    ogg: ['-c:a', 'libvorbis', '-b:a', '192k'],
    aac: ['-c:a', 'aac', '-b:a', '192k'],
    flac: ['-c:a', 'flac'],
    opus: ['-c:a', 'libopus', '-b:a', '128k'],
  };

  const videoCodecs = {
    mp4: ['-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac'],
    webm: ['-c:v', 'libvpx', '-c:a', 'libvorbis', '-b:v', '1M'],
    avi: ['-c:v', 'mpeg4', '-c:a', 'mp3'],
    mkv: ['-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac'],
    gif: ['-f', 'gif', '-vf', 'fps=10'],
  };

  // Audio output
  if (audioCodecs[outputExt]) {
    return audioCodecs[outputExt];
  }

  // Video output
  if (videoCodecs[outputExt]) {
    return videoCodecs[outputExt];
  }

  // Fallback: just copy streams
  return ['-c', 'copy'];
}

/**
 * Convert an audio or video file using FFmpeg.wasm
 * @param {File} file - The input media file
 * @param {string} outputExt - Target format extension
 * @param {object} options - Conversion options
 * @param {function} options.onProgress - Progress callback (0-100, message)
 * @returns {Promise<Blob>} - Converted media blob
 */
export async function convertMedia(file, outputExt, options = {}) {
  const { onProgress = () => {} } = options;

  // Ensure FFmpeg is loaded (shared singleton - never a second 31MB core)
  await getFFmpeg(onProgress);

  const inputFileName = 'input.' + file.name.split('.').pop().toLowerCase();
  const outputFileName = 'output.' + outputExt;

  onProgress(35, 'Reading file...');

  // Write input file to FFmpeg virtual filesystem
  const fileData = await fetchFile(file);
  await ffmpeg.writeFile(inputFileName, fileData);

  onProgress(45, 'Converting... This may take a while for large files.');

  // Set up progress tracking (single shared listener, see getFFmpeg)
  const prevSink = progressSink;
  progressSink = (ratio) => {
    const pct = Math.min(95, 45 + Math.round(ratio * 50));
    onProgress(pct, `Converting... ${Math.round(ratio * 100)}%`);
  };

  // Build FFmpeg command
  const inputExt = file.name.split('.').pop().toLowerCase();
  const codecArgs = getFFmpegArgs(inputExt, outputExt);

  try {
    const code = await ffmpeg.exec(['-i', inputFileName, ...codecArgs, '-y', outputFileName]);
    if (code !== 0) {
      throw new Error(`FFmpeg exited with code ${code}. The format combination may not be supported.`);
    }
  } catch (err) {
    noteFFmpegCrash(err);
    const tail = ffmpegTail();
    throw new Error(`Conversion failed${tail ? ' - ' + tail : ''}: ${err.message}. The format combination may not be supported.`);
  } finally {
    progressSink = prevSink;
  }

  onProgress(95, 'Encoding output...');

  // Read output file
  const outputData = await ffmpeg.readFile(outputFileName);

  // Clean up
  try {
    await ffmpeg.deleteFile(inputFileName);
    await ffmpeg.deleteFile(outputFileName);
  } catch (e) {
    // Ignore cleanup errors
  }

  const mimeType = OUTPUT_MIME_TYPES[outputExt] || 'application/octet-stream';
  const blob = new Blob([outputData.buffer], { type: mimeType });

  onProgress(100, 'Done!');
  return blob;
}

/**
 * Check if FFmpeg is already loaded
 */
export function isFFmpegLoaded() {
  return ffmpegLoaded;
}

/**
 * Check if FFmpeg is currently loading (core downloading).
 */
export function isFFmpegLoading() {
  return ffmpegLoading;
}

/**
 * Drop the shared engine (terminating its worker when possible) so the next
 * call transparently loads a fresh one. Used by Cancel and by trap recovery.
 * Safe to call any time, even mid-run: in-flight calls fail fast and the UI
 * discards their late results via its own run ids.
 */
export function resetFFmpegEngine() {
  try {
    if (ffmpeg && typeof ffmpeg.terminate === 'function') ffmpeg.terminate();
  } catch { /* already dead */ }
  ffmpeg = null;
  ffmpegLoaded = false;
  ffmpegLoading = false;
}
