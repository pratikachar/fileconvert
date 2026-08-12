/**
 * Media Converter — Uses FFmpeg.wasm for audio & video conversion
 * Audio: MP3, WAV, OGG, AAC, FLAC, M4A, WMA
 * Video: MP4, WebM, AVI, MKV, MOV, FLV
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { OUTPUT_MIME_TYPES } from './registry.js';

let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoading = false;

/**
 * Load FFmpeg.wasm (lazy-loaded, only when needed)
 * @param {function} onProgress - Loading progress callback
 */
async function ensureFFmpegLoaded(onProgress = () => {}) {
  if (ffmpegLoaded) return;
  if (ffmpegLoading) {
    // Wait for existing load to complete
    while (ffmpegLoading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return;
  }

  ffmpegLoading = true;
  onProgress(0, 'Loading FFmpeg engine...');

  try {
    ffmpeg = new FFmpeg();

    // Log FFmpeg output for debugging
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

    onProgress(10, 'Downloading FFmpeg core (~31MB, first time only)...');

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegLoaded = true;
    onProgress(30, 'FFmpeg ready!');
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

  // Ensure FFmpeg is loaded
  await ensureFFmpegLoaded(onProgress);

  const inputFileName = 'input.' + file.name.split('.').pop().toLowerCase();
  const outputFileName = 'output.' + outputExt;

  onProgress(35, 'Reading file...');

  // Write input file to FFmpeg virtual filesystem
  const fileData = await fetchFile(file);
  await ffmpeg.writeFile(inputFileName, fileData);

  onProgress(45, 'Converting... This may take a while for large files.');

  // Set up progress tracking
  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.min(95, 45 + Math.round(progress * 50));
    onProgress(pct, `Converting... ${Math.round(progress * 100)}%`);
  });

  // Build FFmpeg command
  const inputExt = file.name.split('.').pop().toLowerCase();
  const codecArgs = getFFmpegArgs(inputExt, outputExt);

  try {
    await ffmpeg.exec(['-i', inputFileName, ...codecArgs, '-y', outputFileName]);
  } catch (err) {
    throw new Error(`Conversion failed: ${err.message}. The format combination may not be supported.`);
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
