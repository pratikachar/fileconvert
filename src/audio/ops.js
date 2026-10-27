/**
 * Audio Toolbox - FFmpeg argument builders.
 * Pure functions only (no DOM, no FFmpeg instance) so they are Node-testable.
 *
 * The browser core is FFmpeg 5.1.4 built with --enable-gpl and no
 * --disable-filters, so afilter (afade/loudnorm/silenceremove/areverse/
 * atempo/asetrate/aresample/alimiter/afftdn/highpass/lowpass/agate) and the
 * concat demuxer are available. Verified live against the pinned core:
 * afftdn, anlmdn, asendcmd, highpass, lowpass, agate, loudnorm, equalizer.
 * NOTE: anlmdn is present but measured 0.0 dB reduction at s=7..60 while
 * running 2-4x slower than afftdn, so it is deliberately NOT offered.
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
/** Still images the Audio tab accepts (slideshow source, plus GIF for GIF->video). */
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
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

export function isImageExt(ext) {
  return IMAGE_EXTS.includes((ext || '').toLowerCase());
}

export function isSupportedInput(ext) {
  return AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext) || isImageExt(ext);
}

export function isTaggable(ext) {
  return TAGGABLE_EXTS.includes(ext);
}

/** Upload size policy: the wasm FS transiently holds ~2-3x the file size. */
export const AUDIO_WARN_BYTES = 150 * 1024 * 1024;
export const AUDIO_HARD_BYTES = 500 * 1024 * 1024;

/** 'ok' | 'warn' (slow, needs memory) | 'refuse' (would likely OOM the tab). */
export function classifyAudioSize(bytes) {
  const n = Number(bytes) || 0;
  if (n > AUDIO_HARD_BYTES) return 'refuse';
  if (n > AUDIO_WARN_BYTES) return 'warn';
  return 'ok';
}

/** Same-format copies that keep the audio bit-exact (no re-encode). */
export function canLosslessTrim(inExt, outExt) {
  return inExt === outExt && ['mp3', 'aac', 'm4a', 'wav'].includes(outExt);
}

/** Video containers offered as *outputs* by the video tools. */
export const VIDEO_OUT_FORMATS = [
  { ext: 'mp4', label: 'MP4 (H.264/AAC)' },
  { ext: 'mov', label: 'MOV (QuickTime)' },
  { ext: 'mkv', label: 'MKV (Matroska)' },
  { ext: 'webm', label: 'WEBM (VP8/Vorbis)' },
  { ext: 'avi', label: 'AVI' },
  { ext: '3gp', label: '3GP (phone)' },
];

/**
 * Which containers can hold the source streams with a pure `-c copy`.
 * Stream copy is the only video path the pinned core is trusted for
 * (`-c:v copy` + `-af` traps it, see buildRemux), so the rule is
 * "same container, or a container that accepts anything".
 */
export function canLosslessVideoTrim(inExt, outExt) {
  const i = String(inExt || '').toLowerCase();
  const o = String(outExt || '').toLowerCase();
  if (!i || !o || !VIDEO_EXTS.includes(i) || !VIDEO_EXTS.includes(o)) return false;
  if (i === o) return true;
  // ISO base media family: MP4 / M4V / MOV are interchangeable for h264+aac.
  const isoFamily = ['mp4', 'm4v', 'mov'];
  if (isoFamily.includes(i) && isoFamily.includes(o)) return true;
  // Matroska accepts essentially every elementary stream ffmpeg can decode.
  return o === 'mkv';
}

/**
 * Trim a video with pure stream copy: instant, no quality loss.
 *
 * `-ss` before `-i` seeks to the nearest *preceding* keyframe, so the clip can
 * begin slightly earlier than asked (bounded by the GOP length) - that is the
 * honest trade for a zero-re-encode cut. Streams are mapped with `?` so files
 * missing an audio track do not fail with "map matches no streams".
 */

/** Drop the audio track, stream-copy the video (fast). If containers differ we
 *  fall back to re-encoding with libx264 so the output still plays. */
export function buildVideoMute({ inName, outName, outExt = 'mp4', sourceExt = 'mp4', bitrate = 192 }) {
  if (outExt === sourceExt) {
    return ['-i', inName, '-map', '0:v:0', '-an', '-c:v', 'copy', '-y', outName];
  }
  return ['-i', inName, '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', ...codecArgs('aac', bitrate), '-y', outName];
}

/** Rotate / flip a video (re-encode, keep audio copied). mode: cw|ccw|flipH|flipV|180. */
export function buildVideoRotate({ inName, outName, mode = 'cw', outExt = 'mp4' }) {
  const vf = ({
    cw: 'transpose=1',
    ccw: 'transpose=2',
    flipH: 'hflip',
    flipV: 'vflip',
    180: 'hflip,vflip',
  })[mode] || 'transpose=1';
  return ['-i', inName, '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'copy', '-y', outName];
}

/** Change video playback speed. speed>1 speeds up, <1 slows. Audio uses atempo (chained). */
export function buildVideoSpeed({ inName, outName, speed = 1, outExt = 'mp4' }) {
  const s = Math.max(0.25, Math.min(4, Number(speed) || 1));
  const pts = 1 / s;
  const args = ['-i', inName, '-vf', `setpts=${pts}*PTS`, '-r', '30'];
  // audio chain
  const chain = [];
  let r = s;
  // atempo expects 0.5..2; chain
  const at = [];
  let rr = Math.max(0.25, Math.min(4, s));
  while (rr > 2) { at.push('atempo=2'); rr /= 2; }
  while (rr < 0.5) { at.push('atempo=0.5'); rr /= 0.5; }
  if (Math.abs(rr - 1) > 1e-3) at.push(`atempo=${rr}`);
  if (at.length) args.push('-af', at.join(','));
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'aac', '-b:a', '128k', '-y', outName);
  return args;
}

/** Re-encode for tiny downloads (WhatsApp-friendly). target: 720|480|360. */
export function buildVideoCompress({ inName, outName, target = 720, crf = 28 }) {
  const h = ({ 720: 720, 480: 480, 360: 360 })[target] || 720;
  return ['-i', inName, '-vf', `scale=-2:${h}`, '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-y', outName];
}

export function buildVideoTrim({
  inName, outName,
  start = 0, end = null,
  keepVideo = true, keepAudio = true,
}) {
  const s = Math.max(0, Number(start) || 0);
  const e = end == null ? null : Math.max(0, Number(end) || 0);
  const dur = e != null && e > s ? e - s : null;

  const args = ['-ss', r3(s), '-i', inName];
  if (dur != null) args.push('-t', r3(dur));
  // Dropping both would produce nothing; keep the picture so the output is usable.
  const wantVideo = keepVideo || !keepAudio;
  if (wantVideo) args.push('-map', '0:v:0?');
  if (keepAudio) args.push('-map', '0:a:0?');
  args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', outName);
  return args;
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
export function buildTrim({ inName, outName, start = 0, end = null, outExt = 'mp3', bitrate = 192, fadeIn = 0, fadeOut = 0, lossless = false, audioOnly = false }) {
  const s = Math.max(0, Number(start) || 0);
  const e = end == null ? null : Math.max(0, Number(end) || 0);
  const dur = e != null && e > s ? e - s : null;
  const copy = !!lossless && !fadeIn && !fadeOut;

  const args = ['-ss', r3(s), '-i', inName];
  if (dur != null) args.push('-t', r3(dur));

  if (copy) {
    if (audioOnly) args.push('-map', '0:a:0');
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

/** Build a mid/side centre-cancel vocal reduction. Honest property<rfl:parameter name="<rfl:parameter name="gained.
 *  Removes frequencies carrying the same in-phase content in both channels, which
 *  gets a large fraction of dead-centre vocals but also attenuates drum hits,
 *  etc. The empirical drop measured live on a 440 Hz centred tone: ~15 dB.
 */
export function buildKaraoke({ inName, outName, intensity = 0.5, highpass = 180, outExt = 'mp3', bitrate = 192 }) {
  const k = Math.max(0.3, Math.min(1.5, Number(intensity) || 0.5));
  const chain = [];
  if (highpass > 0) chain.push(`highpass=f=${Math.round(highpass)}`);
  chain.push(`pan=stereo|c0=${r3(k)}*c0-${r3(k)}*c1|c1=${r3(k)}*c1-${r3(k)}*c0`);
  return ['-i', inName, '-af', chain.join(','), ...codecArgs(outExt, bitrate), '-y', outName];
}

/** Build a ringtone: trim the selection, fade in 0.1s, fade out 0.3s, and
 *  normalise + peak-limit to broadcast-friendly levels.  */
export function buildRingtone({ inName, outName, start = 0, end = null, outExt = 'mp3', bitrate = 192 }) {
  const s = Math.max(0, Number(start) || 0);
  const e = end == null ? null : Math.max(0, Number(end) || 0);
  const dur = e != null && e > s ? e - s : 30;
  const chain = [`afade=t=in:st=0:d=0.1`, `afade=t=out:st=${r3(Math.max(0, dur - 0.3))}:d=0.3`];
  return ['-ss', r3(s), '-i', inName, '-t', r3(dur),
    '-af', `${chain.join(',')},dynaudnorm=p=0.9:s=10,alimiter=limit=0.95`,
    ...codecArgs(outExt, bitrate), '-y', outName];
}
export function buildTags({ inName, outName, tags = {}, audioOnly = false }) {
  const args = ['-i', inName];
  // For video inputs (or MP3s with embedded cover art) keep only the audio stream.
  if (audioOnly) args.push('-map', '0:a:0');
  args.push('-c', 'copy');
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

/* ----------------------- Noise cleanup ----------------------- */

/**
 * Preset table. Values were measured live against the pinned core on a
 * -17 dB white-noise bed: Standard gives ~2.5 dB reduction with the tone
 * untouched (-0.3 dB); Strong gives ~8 dB with the tone at -0.7 dB.
 * tn (track_noise) measured HARMFUL on short/mixed content (0.0 dB), so it
 * defaults off everywhere.
 */
export const DENOISE_PRESETS = {
  light: { label: 'Light', desc: 'Gentle hiss tidy-up, safest for music.', highpass: 80, lowpass: 0, nr: 8, nf: -30, rf: -50, tn: false, nt: 'white' },
  standard: { label: 'Standard', desc: 'Everyday cleanup for voice memos & calls.', highpass: 80, lowpass: 0, nr: 12, nf: -25, rf: -50, tn: false, nt: 'white' },
  strong: { label: 'Strong', desc: 'Heavy hiss/hum. May soften fine detail.', highpass: 100, lowpass: 0, nr: 30, nf: -20, rf: -60, tn: false, nt: 'white' },
  voice: { label: 'Voice focus', desc: 'Podcast/voice: trims rumble and harsh highs too.', highpass: 100, lowpass: 15000, nr: 12, nf: -25, rf: -50, tn: false, nt: 'white' },
  custom: { label: 'Custom', desc: 'Your slider values below.', highpass: 80, lowpass: 0, nr: 12, nf: -25, rf: -50, tn: false, nt: 'white' },
};

export const NOISE_TYPES = ['white', 'vinyl', 'shellac'];
export const HIGHPASS_CHOICES = [0, 40, 80, 100, 120, 200];
export const LOWPASS_CHOICES = [0, 8000, 12000, 15000, 18000];

/** Audio encoder to use when the container is a video format.
 *  NOTE: libopus is deliberately absent - its encoder traps the pinned
 *  wasm core (verified live), so WebM uses libvorbis instead. */
export const VIDEO_CONTAINER_AUDIO = {
  mp4: 'aac', m4v: 'aac', mov: 'aac', mkv: 'aac', avi: 'mp3',
  webm: 'ogg', flv: 'aac', ogv: 'ogg', '3gp': 'aac', ts: 'aac',
};

/** MIME types for video containers (results list + downloads). */
export const VIDEO_MIME_TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', webm: 'video/webm', flv: 'video/x-flv', ogv: 'video/ogg',
  '3gp': 'video/3gpp', ts: 'video/mp2t',
};

/** Container for the denoised-audio intermediate of a video-out run. */
export function intermediateAudioExt(containerExt) {
  const audioExt = VIDEO_CONTAINER_AUDIO[(containerExt || '').toLowerCase()] || 'aac';
  return { aac: 'm4a', mp3: 'mp3', ogg: 'ogg' }[audioExt] || 'm4a';
}

/**
 * Mux an already-encoded audio track with a copied video stream.
 * Deliberately filter-free: `-c:v copy` combined with `-af` traps the pinned
 * wasm core (verified live), so video-out always runs as denoise-then-mux.
 *
 * The video map is optional (`0:v:0?`): a .webm/.mp4 can legitimately hold
 * only an audio track (voice memos recorded by this app are audio-only
 * WEBM), and a required map kills the whole command with
 * "Stream map '0:v:0' matches no streams".
 */
export function buildRemux({ videoIn, audioIn, outName }) {
  return ['-i', videoIn, '-i', audioIn, '-map', '0:v:0?', '-map', '1:a:0', '-c', 'copy', '-shortest', '-y', outName];
}

/** Above this many seconds of audio, warn that the run will take a while. */
export const LONG_DENOISE_WARN_SECS = 600;
/** Preview snippet length (seconds). */
export const DENOISE_PREVIEW_SECS = 8;

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
/**
 * Build just the `-af` chain for noise cleanup (unit-testable on its own).
 * asendcmd times are absolute file times unless `seekBase` shifts them
 * (used when a `-ss` preview window moves the filter timeline).
 */
export function denoiseChain({
  highpass = 80, lowpass = 0,
  nr = 12, nf = -25, rf = -50, tn = false, nt = 'white',
  listenRemoved = false,
  profileStart = null, profileEnd = null, seekBase = 0,
  normalize = false,
} = {}) {
  const parts = [];
  if (highpass > 0) parts.push(`highpass=f=${Math.round(highpass)}`);
  if (lowpass > 0) parts.push(`lowpass=f=${Math.round(lowpass)}`);
  const cleanNt = NOISE_TYPES.includes(nt) ? nt : 'white';
  parts.push(
    `afftdn=nr=${r3(clampNum(nr, 0.01, 97, 12))}` +
    `:nf=${r3(clampNum(nf, -80, -20, -25))}` +
    `:rf=${r3(clampNum(rf, -80, -20, -50))}` +
    `:tn=${tn ? 1 : 0}:nt=${cleanNt}` +
    (listenRemoved ? ':om=n' : '')
  );
  if (normalize && !listenRemoved) parts.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  const chain = parts.join(',');
  if (profileStart != null && profileEnd != null && profileEnd > profileStart) {
    const rel = (t) => r3(Math.max(0, t - (seekBase || 0)));
    return `asendcmd=${rel(profileStart)} afftdn sn start,asendcmd=${rel(profileEnd)} afftdn sn stop,${chain}`;
  }
  return chain;
}

/**
 * Full denoise command: audio in, audio out. Video inputs take the proven
 * extract-style path (`-vn -map 0:a:0`); video-out is orchestrated as two
 * passes in the UI (denoise audio, then buildRemux) because `-c:v copy`
 * combined with `-af` traps the pinned wasm core.
 * previewFrom/previewLen render a snippet instead of the whole file.
 */
export function buildDenoise({
  inName, outName,
  highpass = 80, lowpass = 0,
  nr = 12, nf = -25, rf = -50, tn = false, nt = 'white',
  listenRemoved = false,
  profileStart = null, profileEnd = null,
  normalize = false,
  outExt = 'mp3', bitrate = 192,
  isVideo = false,
  previewFrom = null, previewLen = null,
}) {
  const chain = denoiseChain({
    highpass, lowpass, nr, nf, rf, tn, nt, listenRemoved,
    profileStart, profileEnd, seekBase: previewFrom || 0, normalize,
  });
  const args = [];
  if (previewFrom != null && previewLen != null) {
    args.push('-ss', r3(Math.max(0, previewFrom)), '-t', r3(Math.max(0.5, previewLen)));
  }
  args.push('-i', inName);
  if (isVideo) args.push('-vn', '-map', '0:a:0');
  args.push(...codecArgs(outExt, bitrate));
  args.push('-af', chain, '-y', outName);
  return args;
}

/**
 * Grab one still frame at an absolute time. Input seek (-ss before -i) lands on
 * the exact frame; no stream copy is involved so there is no keyframe snap.
 */
export function buildExtractFrame({ inName, outName, at = 0 }) {
  return ['-ss', r3(Math.max(0, Number(at) || 0)), '-i', inName, '-frames:v', '1', '-y', outName];
}

/**
 * Convert an animated GIF to a seekable MP4. Single pass on purpose: the
 * palettegen/paletteuse two-pass needs filters this core was never probed for,
 * while plain libx264 at CRF 20 is artefact-free for animation. Alpha is
 * flattened onto black (MP4 has no alpha channel) and the width is capped so
 * phone GIFs do not explode in size.
 */
export function buildGifToVideo({ inName, outName, width = 480 }) {
  const w = Math.max(160, Math.min(1280, Math.round(Number(width) || 480)));
  return ['-i', inName,
    '-vf', 'scale=' + w + ':-2:flags=lanczos,setsar=1',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-movflags', '+faststart', '-an', '-y', outName];
}

/**
 * Static photo slideshow. Every picture is normalised to the same canvas
 * (scale-down + pad + 30 fps) and joined with the concat filter, so mixed
 * portrait/landscape sources just work. Music is optional: when present its
 * stream is mapped with -shortest so a long song never stretches the video.
 */
export const SLIDESHOW_WIDTHS = [640, 854, 1280];
export function buildSlideshow({ inNames, outName, secs = 2, width = 1280, height = 720, musicName = null }) {
  const n = inNames.length;
  const per = inNames.map(function (_, i) {
    return '[' + i + ':v]scale=' + width + ':' + height +
      ':force_original_aspect_ratio=decrease,' +
      'pad=' + width + ':' + height + ':(ow-iw)/2:(oh-ih)/2:color=black,' +
      'setsar=1,fps=30[v' + i + ']';
  }).join(';');
  const fc = per + ';' + inNames.map(function (_, i) { return '[v' + i + ']'; }).join('') +
    'concat=n=' + n + ':v=1:a=0[vout]';
  const args = [];
  for (const name of inNames) args.push('-loop', '1', '-framerate', '30', '-t', r3(Math.max(0.5, Math.min(10, Number(secs) || 2))), '-i', name);
  if (musicName) args.push('-i', musicName);
  args.push('-filter_complex', fc, '-map', '[vout]');
  if (musicName) args.push('-map', n + ':a?', '-c:a', 'aac', '-b:a', '128k', '-shortest');
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', outName);
  return args;
}

/**
 * Swap a video's soundtrack. The picture is stream-copied (no filters, so the
 * pinned core's `-c:v copy` + `-af` trap cannot trigger), while the new audio
 * is RE-ENCODED to the container's native codec - a WAV/PCM track cannot live
 * inside MP4, and copying it there aborts the mux (verified live). The codec
 * follows VIDEO_CONTAINER_AUDIO, so WebM still avoids the libopus trap.
 */
export function buildReplaceAudio({ videoIn, audioIn, outName, containerExt = "mp4", bitrate = 192 }) {
  const c = (containerExt || "mp4").toLowerCase();
  const audioFileExt = intermediateAudioExt(c);
  return ["-i", videoIn, "-i", audioIn,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", ...codecArgs(audioFileExt, bitrate),
    "-shortest", "-y", outName];
}

/** Above this many frames, Extract Frames refuses and asks for a wider step. */
export const MAX_EXTRACT_FRAMES = 12;

export const TOOLS = [
  { id: 'cut', label: '✂️ Cut', short: '✂️ Cut' },
  { id: 'vtrim', label: '🎞 Trim Video', short: '🎞 Trim', needsVideo: true },
  { id: 'merge', label: '🔗 Merge', short: '🔗 Merge', needsFiles: 2 },
  { id: 'fade', label: '🌗 Fade', short: '🌗 Fade' },
  { id: 'normalize', label: '🔊 Normalize', short: '🔊 Norm' },
  { id: 'speed', label: '⏩ Speed & Pitch', short: '⏩ Speed' },
  { id: 'extract', label: '🎬 Extract Audio', short: '🎬 Extract', needsVideo: true },
  { id: 'silence', label: '🤫 Silence Trim', short: '🤫 Silence' },
  { id: 'denoise', label: '🔇 Noise Cleanup', short: '🔇 Denoise' },
  { id: 'reverse', label: '⏪ Reverse', short: '⏪ Rev' },
  { id: 'karaoke', label: '🎤 Karaoke vocal‑down', short: '🎤 Karaoke' },
  { id: 'ringtone', label: '📞 Ringtone', short: '📞 Ring' },
  { id: 'bpm', label: '🪘 BPM Tapper', short: '🪘 BPM' },
  { id: 'record', label: '🎙 Record (mic)', short: '🎙 Rec' },
  { id: 'screen', label: '🎥 Screen Record', short: '🎥 Screen' },
  { id: 'split', label: '✂️ Split on silence', short: '✂️ Split' },
  { id: 'vmute', label: '🔇 Mute audio', short: '🔇 Mute' },
  { id: 'vrotate', label: '🔄 Rotate/Flip', short: '🔄 Rotate' },
  { id: 'vspeed', label: '⚡ Change speed', short: '⚡ V-Speed' },
  { id: 'vcompress', label: '📱 Compress (WhatsApp)', short: '📱 Shrink' },
  { id: 'vframes', label: '🖼 Extract Frames', short: '🖼 Frames', needsVideo: true },
  { id: 'vgif', label: '🎞 GIF \u2192 Video', short: '🎞 GIF', needsGif: true },
  { id: 'vslideshow', label: '🎞 Images \u2192 Slideshow', short: '🎞 Slides', needsImages: 2 },
  { id: 'vreplace', label: '🎵 Replace Audio Track', short: '🎵 Re-Audio', needsVideo: true },
  { id: 'tags', label: '🏷 Metadata', short: '🏷 Tags', needsTaggable: true },
];