/**
 * Audio Toolbox - FFmpeg argument builders.
 * Pure functions only (no DOM, no FFmpeg instance) so they are Node-testable.
 *
 * The browser core is FFmpeg 5.1.4 built with --enable-gpl and no
 * --disable-filters, so afilter (afade/loudnorm/silenceremove/areverse/
 * atempo/asetrate/aresample/alimiter) and the concat demuxer are available.
 */

export const AUDIO_OUT_FORMATS = [
  { ext: 'mp3', label: 'MP3', mime: 'audio/mpeg' },
  { ext: 'wav', label: 'WAV', mime: 'audio/wav' },
  { ext: 'm4a', label: 'M4A', mime: 'audio/mp4' },
  { ext: 'aac', label: 'AAC', mime: 'audio/aac' },
  { ext: 'ogg', label: 'OGG', mime: 'audio/ogg' },
  { ext: 'opus', label: 'OPUS', mime: 'audio/opus' },
  { ext: 'flac', label: 'FLAC', mime: 'audio/flac' },
];

export const BITRATES = [128, 192, 256, 320];

export const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'oga', 'aac', 'm4a', 'flac', 'opus', 'wma', 'aiff', 'weba'];
export const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'mkv', 'avi', 'webm', 'flv', '3gp', 'ts', 'ogv'];
/** Formats where FFmpeg can rewrite tags while stream-copying the audio. */
export const TAGGABLE_EXTS = ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac'];
/** MP3 frames hold 1152 samples, so cut points land on ~26ms steps. */
export const MP3_FRAME_SAMPLES = 1152;

export function extOf(name) {
  return (String(name).split('.').pop() || '').toLowerCase();
}

export function isVideoExt(ext) {
  return VIDEO_EXTS.includes(ext);
}

export function isSupportedInput(ext) {
  return AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext);
}

export function isTaggable(ext) {
  return TAGGABLE_EXTS.includes(ext);
}

/** Same-format copies that keep the audio bit-exact (no re-encode). */
export function canLosslessTrim(inExt, outExt) {
  return inExt === outExt && ['mp3', 'aac', 'm4a', 'wav'].includes(outExt);
}

export function r3(n) {
  return String(Math.round(Number(n) * 1000) / 1000);
}

export function codecArgs(ext, bitrate = 192) {
  switch (ext) {
    case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`];
    case 'wav': return ['-c:a', 'pcm_s16le'];
    case 'm4a':
    case 'aac': return ['-c:a', 'aac', '-b:a', `${bitrate}k`];
    case 'ogg': return ['-c:a', 'libvorbis', '-b:a', `${bitrate}k`];
    case 'opus': return ['-c:a', 'libopus', '-b:a', '128k'];
    case 'flac': return ['-c:a', 'flac'];
    default: return ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`];
  }
}

/**
 * atempo only accepts 0.5-2.0 per instance, so chain it for wider ranges.
 */
export function atempoChain(rate) {
  const out = [];
  let r = Math.max(0.25, Math.min(4, Number(rate) || 1));
  while (r > 2) { out.push('atempo=2'); r /= 2; }
  while (r < 0.5) { out.push('atempo=0.5'); r /= 0.5; }
  if (Math.abs(r - 1) > 1e-3) out.push(`atempo=${r3(r)}`);
  return out;
}

function fadeChain(fadeIn, fadeOut, duration) {
  const chain = [];
  if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${r3(fadeIn)}`);
  if (fadeOut > 0 && duration != null && duration > fadeOut) {
    chain.push(`afade=t=out:st=${r3(duration - fadeOut)}:d=${r3(fadeOut)}`);
  }
  return chain;
}

/**
 * Cut a selection. -ss before -i seeks fast; -t caps the output length.
 */
export function buildTrim({ inName, outName, start = 0, end = null, outExt = 'mp3', bitrate = 192, fadeIn = 0, fadeOut = 0, lossless = false }) {
  const s = Math.max(0, Number(start) || 0);
  const e = end == null ? null : Math.max(0, Number(end) || 0);
  const dur = e != null && e > s ? e - s : null;
  const copy = !!lossless && !fadeIn && !fadeOut;

  const args = ['-ss', r3(s), '-i', inName];
  if (dur != null) args.push('-t', r3(dur));

  if (copy) {
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
  } else {
    const chain = fadeChain(fadeIn, fadeOut, dur);
    if (chain.length) args.push('-af', chain.join(','));
    args.push(...codecArgs(outExt, bitrate));
  }
  args.push('-y', outName);
  return args;
}

/** Merge N inputs via the concat demuxer (handles mixed formats). */
export function buildConcat({ outName, outExt = 'mp3', bitrate = 192 }) {
  return ['-f', 'concat', '-safe', '0', '-i', 'list.txt', ...codecArgs(outExt, bitrate), '-y', outName];
}

export function concatList(names) {
  return names.map((n) => `file '${n}'`).join('\n') + '\n';
}

export function buildFade({ inName, outName, duration = null, fadeIn = 0, fadeOut = 0, outExt = 'mp3', bitrate = 192 }) {
  const chain = fadeChain(fadeIn, fadeOut, duration);
  const args = ['-i', inName];
  if (chain.length) args.push('-af', chain.join(','));
  args.push(...codecArgs(outExt, bitrate), '-y', outName);
  return args;
}

export function buildNormalize({ inName, outName, mode = 'loudnorm', targetLufs = -14, ceiling = -1.5, gainDb = 0, outExt = 'mp3', bitrate = 192 }) {
  let chain = null;
  if (mode === 'gain') {
    if (Number(gainDb) !== 0) chain = `volume=${r3(gainDb)}dB`;
  } else {
    chain = `loudnorm=I=${Number(targetLufs)}:TP=${Number(ceiling)}:LRA=11`;
  }
  const args = ['-i', inName];
  if (chain) args.push('-af', chain);
  args.push(...codecArgs(outExt, bitrate), '-y', outName);
  return args;
}

export function buildSpeed({ inName, outName, rate = 1, outExt = 'mp3', bitrate = 192 }) {
  const chain = atempoChain(rate);
  const args = ['-i', inName];
  if (chain.length) args.push('-af', chain.join(','));
  args.push(...codecArgs(outExt, bitrate), '-y', outName);
  return args;
}

/** Independent pitch shift: resample to the new rate, then correct tempo. */
export function buildPitch({ inName, outName, semitones = 0, baseRate = 44100, outExt = 'mp3', bitrate = 192 }) {
  const st = Number(semitones) || 0;
  const args = ['-i', inName];
  if (st !== 0) {
    const f = Math.pow(2, st / 12);
    const chain = [
      `aresample=${Math.round(baseRate)}`,
      `asetrate=${Math.round(baseRate * f)}`,
      `aresample=${Math.round(baseRate)}`,
      ...atempoChain(1 / f),
    ];
    args.push('-af', chain.join(','));
  }
  args.push(...codecArgs(outExt, bitrate), '-y', outName);
  return args;
}

export function buildExtractAudio({ inName, outName, outExt = 'mp3', bitrate = 192 }) {
  return ['-i', inName, '-vn', '-map', '0:a:0', ...codecArgs(outExt, bitrate), '-y', outName];
}

/**
 * Trim leading + trailing silence.
 * Two chained silenceremove instances: `stop_periods=1` in a single instance
 * empties the output (verified against the browser core), while `stop_periods=-1`
 * plus chaining trims correctly for leading-only, trailing-only and clean input.
 */
export function buildSilenceTrim({ inName, outName, thresholdDb = -45, minSilence = 0.4, keepPad = 0.15, outExt = 'mp3', bitrate = 192 }) {
  const chain = [
    `silenceremove=start_periods=1:start_duration=${r3(minSilence)}:start_threshold=${Number(thresholdDb)}dB:start_silence=${r3(keepPad)}`,
    `silenceremove=stop_periods=-1:stop_duration=${r3(minSilence)}:stop_threshold=${Number(thresholdDb)}dB:stop_silence=${r3(keepPad)}`,
  ];
  return ['-i', inName, '-af', chain.join(','), ...codecArgs(outExt, bitrate), '-y', outName];
}

export function buildReverse({ inName, outName, outExt = 'mp3', bitrate = 192 }) {
  return ['-i', inName, '-af', 'areverse', ...codecArgs(outExt, bitrate), '-y', outName];
}

/** Rewrite tags with -c copy so the audio itself is untouched. */
export function buildTags({ inName, outName, tags = {} }) {
  const args = ['-i', inName, '-c', 'copy'];
  const keys = { title: 'title', artist: 'artist', album: 'album', genre: 'genre', year: 'date', comment: 'comment' };
  for (const [k, metaKey] of Object.entries(keys)) {
    const v = (tags[k] || '').trim();
    if (v) args.push('-metadata', `${metaKey}=${v}`);
  }
  args.push('-id3v2_version', '3', '-y', outName);
  return args;
}

/** Extract duration as a Number from `ffmpeg`-free probing (Wave Audio). */
export function estimateDurationAfter(duration, { rate = 1 } = {}) {
  const r = Math.max(0.25, Math.min(4, Number(rate) || 1));
  return duration != null ? duration / r : null;
}

export const TOOLS = [
  { id: 'cut', label: '✂️ Cut', needsAudio: true },
  { id: 'merge', label: '🔗 Merge', needsAudio: false },
  { id: 'fade', label: '🌗 Fade', needsAudio: false },
  { id: 'normalize', label: '🔊 Normalize', needsAudio: false },
  { id: 'speed', label: '⏩ Speed & Pitch', needsAudio: true },
  { id: 'extract', label: '🎬 Extract Audio', needsVideo: true },
  { id: 'silence', label: '🤫 Silence Trim', needsAudio: true },
  { id: 'reverse', label: '⏪ Reverse', needsAudio: true },
  { id: 'tags', label: '🏷 Metadata', needsAudio: false },
];