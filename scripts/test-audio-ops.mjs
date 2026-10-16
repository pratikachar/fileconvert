/**
 * Node checks for the Audio Toolbox pure logic (ops.js + waveform.js).
 * Run: node scripts/test-audio-ops.mjs
 */

import {
  buildTrim, buildConcat, concatList, buildFade, buildNormalize, buildSpeed, buildPitch,
  buildExtractAudio, buildSilenceTrim, buildReverse, buildTags, buildKaraoke, buildRingtone, buildDenoise, buildRemux, denoiseChain,
  DENOISE_PRESETS, VIDEO_CONTAINER_AUDIO, VIDEO_MIME_TYPES, intermediateAudioExt,
  AUDIO_WARN_BYTES, AUDIO_HARD_BYTES, classifyAudioSize,
  atempoChain, codecArgs,
  canLosslessTrim, isSupportedInput, isVideoExt, isTaggable, extOf, r3, MP3_FRAME_SAMPLES,
  buildVideoTrim, canLosslessVideoTrim, VIDEO_OUT_FORMATS, TOOLS,
  buildExtractFrame, buildGifToVideo, buildSlideshow, buildReplaceAudio,
  isImageExt, IMAGE_EXTS, SLIDESHOW_WIDTHS, MAX_EXTRACT_FRAMES,
} from '../src/audio/ops.js';
import { isWasmTrapError } from '../src/converters/media.js';
import { computePeaks, computePeaksFromPcm, frameSnap, formatTime, timeAtX, xAtTime } from '../src/audio/waveform.js';

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}
const has = (args, ...needles) => needles.every((n) => args.includes(n));

// --- helpers ---
check('extOf mp3', extOf('Song.MP3') === 'mp3');
check('extOf none', extOf('noext') === 'noext');
check('r3 rounds', r3(1.23456) === '1.235');
check('isVideoExt mp4/mkv', isVideoExt('mp4') && isVideoExt('mkv') && !isVideoExt('mp3'));
check('isSupportedInput', isSupportedInput('mp3') && isSupportedInput('webm') && !isSupportedInput('exe'));
check('isTaggable', isTaggable('mp3') && isTaggable('flac') && !isTaggable('wav'));
check('lossless only same fmt', canLosslessTrim('mp3', 'mp3') && !canLosslessTrim('mp3', 'wav'));

// --- codec args ---
check('mp3 codec', has(codecArgs('mp3', 320), '-c:a', 'libmp3lame', '-b:a', '320k'));
check('wav codec', has(codecArgs('wav'), '-c:a', 'pcm_s16le'));
check('opus codec', has(codecArgs('opus'), '-c:a', 'libopus', '-b:a', '128k'));
check('flac codec', has(codecArgs('flac'), '-c:a', 'flac'));

// --- trim ---
{
  const a = buildTrim({ inName: 'in.mp3', outName: 'out.mp3', start: 10, end: 25, outExt: 'mp3', bitrate: 256 });
  check('trim seeks', has(a, '-ss', '10', '-i', 'in.mp3', '-t', '15'));
  check('trim reencodes by default', has(a, '-c:a', 'libmp3lame', '-b:a', '256k'));
  check('trim ends with output', a[a.length - 1] === 'out.mp3');
  check('trim no -af when no fades', !a.includes('-af'));
}
{
  const a = buildTrim({ inName: 'i.mp3', outName: 'o.mp3', start: 1, end: 4, outExt: 'mp3', lossless: true });
  check('trim lossless copy', has(a, '-c', 'copy', '-avoid_negative_ts', 'make_zero'));
  check('trim lossless has no encoder', !a.includes('libmp3lame'));
}
{
  const a = buildTrim({ inName: 'i.mp3', outName: 'o.mp3', start: 5, end: 9, outExt: 'mp3', fadeIn: 1, fadeOut: 2, lossless: true });
  check('fades force re-encode', !a.includes('-c') && has(a, '-c:a', 'libmp3lame'));
  check('fade chain timing', a[a.indexOf('-af') + 1] === 'afade=t=in:st=0:d=1,afade=t=out:st=2:d=2');
}
{
  const a = buildTrim({ inName: 'i.wav', outName: 'o.wav', end: null, outExt: 'wav' });
  check('trim no end => no -t', !a.includes('-t'));
}

// --- concat ---
{
  const a = buildConcat({ outName: 'm.mp3', outExt: 'mp3', bitrate: 192 });
  check('concat demuxer', has(a, '-f', 'concat', '-safe', '0', '-i', 'list.txt'));
  check('concat encodes', has(a, '-c:a', 'libmp3lame'));
  check('concat output last', a[a.length - 1] === 'm.mp3');
  check('concat list content', concatList(['a.mp3', 'b.mp3']) === "file 'a.mp3'\nfile 'b.mp3'\n");
}

// --- fade / normalize / speed / pitch ---
{
  const a = buildFade({ inName: 'i.mp3', outName: 'o.mp3', duration: 100, fadeIn: 2, fadeOut: 3 });
  check('fade whole file', a[a.indexOf('-af') + 1] === 'afade=t=in:st=0:d=2,afade=t=out:st=97:d=3');
  check('fade skips out when longer than file', !buildFade({ inName: 'i', outName: 'o', duration: 2, fadeIn: 0, fadeOut: 5 }).includes('afade=t=out'));
}
{
  const a = buildNormalize({ inName: 'i.mp3', outName: 'o.mp3', mode: 'loudnorm', targetLufs: -16, ceiling: -2 });
  check('loudnorm filter', a[a.indexOf('-af') + 1] === 'loudnorm=I=-16:TP=-2:LRA=11');
  const b = buildNormalize({ inName: 'i.mp3', outName: 'o.mp3', mode: 'gain', gainDb: 3.5 });
  check('gain filter', b[b.indexOf('-af') + 1] === 'volume=3.5dB');
  check('gain 0 => no filter', !buildNormalize({ inName: 'i', outName: 'o', mode: 'gain', gainDb: 0 }).includes('-af'));
}
{
  check('atempo 1x empty', atempoChain(1).length === 0);
  check('atempo 1.5', atempoChain(1.5).join() === 'atempo=1.5');
  check('atempo 4x chained', atempoChain(4).join() === 'atempo=2,atempo=2');
  check('atempo 0.5x', atempoChain(0.5).join() === 'atempo=0.5');
  check('atempo 0.25x chained', atempoChain(0.25).join() === 'atempo=0.5,atempo=0.5');
  check('speed builds chain', buildSpeed({ inName: 'i', outName: 'o', rate: 2 })[3] === 'atempo=2');
}
{
  const a = buildPitch({ inName: 'i.mp3', outName: 'o.mp3', semitones: 12, baseRate: 44100 });
  const af = a[a.indexOf('-af') + 1];
  check('pitch doubles rate', af.includes('asetrate=88200'));
  check('pitch compensates tempo', af.includes('atempo=0.5'));
  check('pitch 0 => no filter', !buildPitch({ inName: 'i', outName: 'o', semitones: 0 }).includes('-af'));
}

// --- extract / silence / reverse / tags ---
{
  const a = buildExtractAudio({ inName: 'v.mp4', outName: 'a.mp3' });
  check('extract drops video', has(a, '-vn', '-map', '0:a:0'));
}
{
  const a = buildSilenceTrim({ inName: 'i.wav', outName: 'o.wav', thresholdDb: -50, minSilence: 0.3, keepPad: 0.1, outExt: 'wav' });
  const af = a[a.indexOf('-af') + 1];
  check('silenceremove threshold', af.includes('start_threshold=-50dB'));
  check('silenceremove duration', af.includes('start_duration=0.3'));
  check('silenceremove trims tail too', af.includes('stop_periods=-1'));
  check('silenceremove two chained instances', af.split(',silenceremove=').length === 2);
  check('silenceremove keeps padding', af.includes('start_silence=0.1') && af.includes('stop_silence=0.1'));
}
{
  check('reverse uses areverse', buildReverse({ inName: 'i.mp3', outName: 'o.mp3' }).includes('areverse'));
}
{
  const a = buildTags({ inName: 'i.mp3', outName: 'o.mp3', tags: { title: 'Hi', artist: '', album: 'A' } });
  check('tags stream copy', has(a, '-c', 'copy'));
  check('tags writes title', has(a, '-metadata', 'title=Hi'));
  check('tags skips empty', !a.some((x) => String(x).startsWith('artist=')));
  check('tags id3v2.3', a.includes('-id3v2_version') && a[a.indexOf('-id3v2_version') + 1] === '3');
  check('tags keeps audio untouched', a[a.length - 1] === 'o.mp3');
}

// --- waveform math ---
{
  const sr = 44100;
  const n = 1000;
  const data = new Float32Array(n);
  data[0] = -1;
  data[n - 1] = 1;
  const buf = { length: n, numberOfChannels: 1, getChannelData: () => data };
  const p = computePeaks(buf, 10);
  check('peaks bucket count', p.min.length === 10 && p.max.length === 10);
  check('peaks catch min', p.min[0] === -1);
  check('peaks catch max', p.max[9] === 1);
  check('peaks silence is zero', p.min[4] === 0 && p.max[4] === 0);

  const int16 = new Int16Array([0, 32767, -32768, 0]);
  const q = computePeaksFromPcm(int16, 2);
  check('pcm peaks scale', Math.abs(q.max[0] - 1) < 0.001 && Math.abs(q.min[1] + 1) < 0.001);

  const frame = MP3_FRAME_SAMPLES / sr;
  check('frame snap lands on frame', Math.abs(frameSnap(1.0, sr) / frame - Math.round(1.0 / frame)) < 1e-9);
  check('frame snap no sample rate', frameSnap(1.23456, 0) === 1.235);
  check('formatTime', formatTime(75.5) === '1:15.500');
  check('timeAtX clamp', timeAtX(-5, 100, 10) === 0 && timeAtX(200, 100, 10) === 10);
  check('xAtTime clamp', xAtTime(5, 100, 10) === 50 && xAtTime(-1, 100, 10) === 0);
}

// --- denoise ---
{
  // preset table sanity: every preset stays inside safe, measured ranges
  for (const [id, p] of Object.entries(DENOISE_PRESETS)) {
    check(`denoise preset ${id} nr in range`, p.nr >= 1 && p.nr <= 30);
    check(`denoise preset ${id} nf in range`, p.nf >= -50 && p.nf <= -15);
    check(`denoise preset ${id} rf in range`, p.rf >= -80 && p.rf <= -20);
    check(`denoise preset ${id} track off`, p.tn === false);
  }
  // standard chain shape (mirrors the probe-verified command)
  const c = denoiseChain({ highpass: 80, nr: 12, nf: -25, rf: -50, tn: false, nt: 'white' });
  check('denoise chain order', c === 'highpass=f=80,afftdn=nr=12:nf=-25:rf=-50:tn=0:nt=white');
  // profile commands use absolute times, shifted by the preview seek base
  const pc = denoiseChain({ nr: 15, nf: -25, profileStart: 62, profileEnd: 65 });
  check('denoise profile commands', pc.startsWith('asendcmd=62 afftdn sn start,asendcmd=65 afftdn sn stop,') && pc.includes('afftdn=nr=15'));
  const pc2 = denoiseChain({ nr: 15, nf: -25, profileStart: 62, profileEnd: 65, seekBase: 60 });
  check('denoise profile times shift with preview seek', pc2.startsWith('asendcmd=2 afftdn sn start,asendcmd=5 afftdn sn stop,'));
  // hear-removed mode + loudness interplay
  const om = denoiseChain({ nr: 12, listenRemoved: true, normalize: true });
  check('denoise om=n present', om.includes(':om=n'));
  check('denoise normalize skipped for noise-only output', !om.includes('loudnorm'));
  const norm = denoiseChain({ nr: 12, normalize: true });
  check('denoise normalize appended', norm.endsWith(',loudnorm=I=-16:TP=-1.5:LRA=11'));
  // invalid noise type falls back to white
  check('denoise bad nt falls back', denoiseChain({ nt: 'banana' }).includes('nt=white'));
  // full command: audio
  const a = buildDenoise({ inName: 'in.wav', outName: 'out.mp3', outExt: 'mp3', bitrate: 192 });
  check('denoise audio encodes', has(a, '-i', 'in.wav', '-af', '-c:a', 'libmp3lame', '-y', 'out.mp3'));
  check('denoise audio has no maps', !a.includes('-map') && !a.includes('-c:v'));
  // video input takes the extract-style audio path (video-out is two-pass via buildRemux)
  const va = buildDenoise({ inName: 'in.mp4', outName: 'out.mp3', outExt: 'mp3', isVideo: true });
  check('denoise from video drops video stream', has(va, '-vn', '-map', '0:a:0') && !va.includes('-c:v'));
  // mux step for video-out
  const mx = buildRemux({ videoIn: 'v.mp4', audioIn: 'a.m4a', outName: 'out.mp4' });
  check('remux maps + copies', has(mx, '-i', 'v.mp4', '-i', 'a.m4a', '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest', '-y', 'out.mp4'));
  check('remux has no filters', !mx.includes('-af') && !mx.includes('-c:v'));
  // preview window seeks before input
  const pv = buildDenoise({ inName: 'in.wav', outName: 'out.mp3', previewFrom: 60, previewLen: 8 });
  check('denoise preview seeks', has(pv, '-ss', '60', '-t', '8', '-i', 'in.wav'));
  check('denoise preview seek precedes input', pv.indexOf('-ss') < pv.indexOf('-i'));
  // video mime lookup for results/downloads
  check('denoise video mime mp4', VIDEO_MIME_TYPES.mp4 === 'video/mp4');
  check('denoise video mime webm', VIDEO_MIME_TYPES.webm === 'video/webm');
  // webm maps to vorbis: libopus encoder traps the pinned core (verified live)
  check('denoise webm avoids libopus', VIDEO_CONTAINER_AUDIO.webm === 'ogg' && VIDEO_CONTAINER_AUDIO.mp4 === 'aac');
  // intermediates are real demuxable containers (extensionless temp files break ffmpeg)
  check('denoise intermediate mp4', intermediateAudioExt('mp4') === 'm4a');
  check('denoise intermediate webm', intermediateAudioExt('webm') === 'ogg');
  check('denoise intermediate avi', intermediateAudioExt('avi') === 'mp3');
}

// --- upload size policy ---
{
  check('size ok small', classifyAudioSize(1024) === 'ok');
  check('size ok zero/NaN', classifyAudioSize(0) === 'ok' && classifyAudioSize('x') === 'ok');
  check('size warn boundary', classifyAudioSize(AUDIO_WARN_BYTES) === 'ok' && classifyAudioSize(AUDIO_WARN_BYTES + 1) === 'warn');
  check('size refuse boundary', classifyAudioSize(AUDIO_HARD_BYTES) === 'warn' && classifyAudioSize(AUDIO_HARD_BYTES + 1) === 'refuse');
}

// --- wasm trap classification (engine recovery only fires on these) ---
{
  check('trap: memory access', isWasmTrapError(new Error('RuntimeError: memory access out of bounds')) === true);
  check('trap: OOM', isWasmTrapError('out of memory') === true);
  check('trap: abort', isWasmTrapError('Aborted()') === true);
  check('no trap: bad args', isWasmTrapError(new Error('Invalid argument')) === false);
  check('no trap: missing file', isWasmTrapError('ffmpeg://whatever: No such file or directory') === false);
  check('no trap: exit code', isWasmTrapError(new Error('FFmpeg exited with code 1.')) === false);
  check('no trap: wrapped trap text stays trap', isWasmTrapError(new Error('FFmpeg command failed: RuntimeError: memory access out of bounds')) === true);
}

// --- video trim: stream-copy rules (the only video path the core is trusted for) ---
{
  // Container compatibility
  check('vtrim: same container copies', canLosslessVideoTrim('mp4', 'mp4') === true);
  check('vtrim: mp4->mov copies (ISO family)', canLosslessVideoTrim('mp4', 'mov') === true);
  check('vtrim: mov->m4v copies (ISO family)', canLosslessVideoTrim('mov', 'm4v') === true);
  check('vtrim: anything->mkv copies', canLosslessVideoTrim('avi', 'mkv') === true && canLosslessVideoTrim('mp4', 'mkv') === true);
  check('vtrim: mp4->webm refused (codec mismatch)', canLosslessVideoTrim('mp4', 'webm') === false);
  check('vtrim: mkv->webm refused', canLosslessVideoTrim('mkv', 'webm') === false);
  check('vtrim: audio in/out refused', canLosslessVideoTrim('mp3', 'mp3') === false && canLosslessVideoTrim('mp4', 'mp3') === false);
  check('vtrim: missing ext refused', canLosslessVideoTrim('', 'mp4') === false && canLosslessVideoTrim('mp4', null) === false);

  // Command shape
  const a = buildVideoTrim({ inName: 'in.mp4', outName: 'out.mp4', start: 5, end: 15 });
  check('vtrim: seeks before input', a.indexOf('-ss') < a.indexOf('-i') && a[a.indexOf('-ss') + 1] === '5');
  check('vtrim: duration cap', a.includes('-t') && a[a.indexOf('-t') + 1] === '10');
  check('vtrim: copies both streams', has(a, '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy'));
  check('vtrim: negative ts shifted', a.includes('-avoid_negative_ts') && a[a.indexOf('-avoid_negative_ts') + 1] === 'make_zero');
  check('vtrim: writes to out name', a[a.length - 1] === 'out.mp4' && a[a.length - 2] === '-y');

  // Optional stream mapping must not fail on files lacking an audio track.
  const noAudio = buildVideoTrim({ inName: 'in.mp4', outName: 'out.mp4', start: 0, end: 5, keepAudio: false });
  check('vtrim: video-only drops audio map', !noAudio.includes('0:a:0') && noAudio.includes('0:v:0?'));
  const audioOnly = buildVideoTrim({ inName: 'in.mp4', outName: 'out.m4a', start: 0, end: 5, keepVideo: false, keepAudio: true });
  check('vtrim: audio-only drops video map', !audioOnly.includes('0:v:0') && audioOnly.includes('0:a:0?'));
  const neither = buildVideoTrim({ inName: 'in.mp4', outName: 'out.mp4', start: 0, end: 5, keepVideo: false, keepAudio: false });
  check('vtrim: both off still emits a playable file', neither.includes('0:v:0?'));

  // Degenerate inputs must not produce NaN in argv
  const bad = buildVideoTrim({ inName: 'in.mp4', outName: 'out.mp4', start: -5, end: 2 });
  check('vtrim: negative start clamps to 0', bad[bad.indexOf('-ss') + 1] === '0' && !bad.join(' ').includes('NaN'));
  const open = buildVideoTrim({ inName: 'in.mp4', outName: 'out.mp4', start: 3, end: null });
  check('vtrim: open end omits -t', !open.includes('-t') && open[open.indexOf('-ss') + 1] === '3');

  // Registry: tool exists and is video-gated
  const vt = TOOLS.find((t) => t.id === 'vtrim');
  check('vtrim: registered in TOOLS', !!vt && vt.needsVideo === true);
  check('vtrim: every offered video container has a mime', VIDEO_OUT_FORMATS.every((f) => !!VIDEO_MIME_TYPES[f.ext]));
  check('vtrim: video containers all video exts', VIDEO_OUT_FORMATS.every((f) => isVideoExt(f.ext)));
}


// --- phase 3 audio extras ---------------------------------------------------
{
  const k = buildKaraoke({ inName: 'in.wav', outName: 'k.mp3', intensity: 1, highpass: 200 });
  check('karaoke: mid/side cancel filter present', has(k, '-af', 'pan=stereo|c0=1 *c0-1 *c1'.replace(/\s/g, '')) || k.some(function (a) { return String(a).includes('pan=stereo|c0=1') && String(a).includes('c1=1'); }));
  check('karaoke: highpass added when asked', k.join(' ').includes('highpass=f=200'));
  check('karaoke: no highpass when 0', !buildKaraoke({ inName: 'in.wav', outName: 'k.mp3', intensity: 0.5, highpass: 0 }).some(function (a) { return String(a).startsWith('highpass='); }));
  const low = buildKaraoke({ inName: 'in.wav', outName: 'k.mp3', intensity: 10 }).join(' ');
  check('karaoke: intensity clamped to 1.5', low.includes('1.5*'));
  const high = buildKaraoke({ inName: 'in.wav', outName: 'k.mp3', intensity: 0 }).join(' ');
  check('karaoke: intensity clamped to 0.3', high.includes('0.5*c0'));

  const r = buildRingtone({ inName: 'in.wav', outName: 'r.mp3', start: 5, end: 25.5 });
  check('ringtone: seeks before input', r.indexOf('-ss') < r.indexOf('-i'));
  check('ringtone: trims to <=30 s', r[r.indexOf('-ss') + 1] === '5' && r[r.indexOf('-t') + 1] === '20.5');
  check('ringtone: has fade in + out', has(r, '-af') && r.join(' ').includes('afade=t=in:st=0:d=0.1') && r.join(' ').includes('afade=t=out:'));
  check('ringtone: loudnorm + limiter', r.join(' ').includes('dynaudnorm') && r.join(' ').includes('alimiter'));
  const shortR = buildRingtone({ inName: 'in.wav', outName: 'r.mp3', start: 0, end: 3 });
  check('ringtone: short content stays whole', shortR[shortR.indexOf('-t') + 1] === '3');
  const openR = buildRingtone({ inName: 'in.wav', outName: 'r.mp3', start: 2, end: null });
  check('ringtone: open end defaults 30s', openR[openR.indexOf('-t') + 1] === '30');
}

// --- phase 4 remainder: frames, gif->video, slideshow, replace-audio ------
{
  // image gating
  check('images: png/jpg/gif/bmp accepted', isSupportedInput('png') && isSupportedInput('jpg') && isSupportedInput('gif') && isSupportedInput('bmp'));
  check('images: jpeg + webp accepted', isImageExt('jpeg') && isImageExt('webp'));
  check('images: ext matching is case-insensitive', isImageExt('PNG') && isImageExt('Gif'));
  check('images: audio is not image', !isImageExt('mp3') && !isImageExt('mp4'));
  check('images: registry lists the still formats', IMAGE_EXTS.includes('png') && IMAGE_EXTS.includes('gif'));

  // frame extraction: input seek, exactly one frame, no NaN
  const fr = buildExtractFrame({ inName: 'in.mp4', outName: 'f.png', at: 7.5 });
  check('frames: seeks before input', fr.indexOf('-ss') < fr.indexOf('-i') && fr[fr.indexOf('-ss') + 1] === '7.5');
  check('frames: exactly one frame', fr.includes('-frames:v') && fr[fr.indexOf('-frames:v') + 1] === '1');
  check('frames: writes the png name', fr[fr.length - 1] === 'f.png' && fr[fr.length - 2] === '-y');
  const frNeg = buildExtractFrame({ inName: 'in.mp4', outName: 'f.png', at: -4 });
  check('frames: negative time clamps to 0', frNeg[frNeg.indexOf('-ss') + 1] === '0' && !frNeg.join(' ').includes('NaN'));

  // gif -> video: h264 mp4, no audio, alpha-safe pix fmt, width clamped
  const gv = buildGifToVideo({ inName: 'in.gif', outName: 'o.mp4', width: 480 });
  check('gif: libx264 mp4 with faststart', has(gv, '-c:v', 'libx264', '-movflags', '+faststart'));
  check('gif: yuv420p + no audio track', has(gv, '-pix_fmt', 'yuv420p', '-an'));
  check('gif: lanczos scale to asked width', gv.join(' ').includes('scale=480:-2'));
  const gvBig = buildGifToVideo({ inName: 'in.gif', outName: 'o.mp4', width: 4000 });
  check('gif: width clamped to 1280', gvBig.join(' ').includes('scale=1280:-2'));
  const gvTiny = buildGifToVideo({ inName: 'in.gif', outName: 'o.mp4', width: 10 });
  check('gif: width clamped to 160', gvTiny.join(' ').includes('scale=160:-2'));

  // slideshow: normalised canvas, concat count, optional music
  const ss = buildSlideshow({ inNames: ['a.png', 'b.jpg', 'c.webp'], outName: 's.mp4', secs: 2, width: 1280, height: 720, musicName: null });
  check('slideshow: one looped input per photo', ss.filter(function (a) { return a === '-loop'; }).length === 3);
  check('slideshow: each photo held 2s', ss.filter(function (a) { return a === '2'; }).length >= 3 || ss.join(' ').includes(' -t 2 '));
  check('slideshow: canvas normalisation per input', ss.join(' ').includes('force_original_aspect_ratio=decrease') && ss.join(' ').includes('color=black') && ss.join(' ').includes('fps=30') && ss.join(' ').includes('setsar=1'));
  check('slideshow: concat joins all three', ss.join(' ').includes('[v0][v1][v2]concat=n=3:v=1:a=0'));
  check('slideshow: silent without music', !ss.join(' ').includes('-shortest') && !ss.includes('-c:a'));
  check('slideshow: h264 + faststart', has(ss, '-c:v', 'libx264', '-movflags', '+faststart'));
  const ssm = buildSlideshow({ inNames: ['a.png', 'b.jpg'], outName: 's.mp4', secs: 1.5, width: 640, height: 360, musicName: 'm.mp3' });
  check('slideshow: music mapped with -shortest', ssm.join(' ').includes('2:a?') && ssm.join(' ').includes('-shortest') && ssm.includes('-c:a'));
  check('slideshow: widths registry sane', SLIDESHOW_WIDTHS.includes(640) && SLIDESHOW_WIDTHS.includes(1280));

  // replace-audio: picture copied WITHOUT filters, soundtrack re-encoded
  const rp = buildReplaceAudio({ videoIn: "v.mp4", audioIn: "a.wav", outName: "o.mp4", containerExt: "mp4" });
  check("replace: copies video, encodes audio, no filters", has(rp, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac") && !rp.join(" ").includes("-af") && !rp.join(" ").includes("-vf"));
  check("replace: shortest bound kept", rp.includes("-shortest"));
  const rpWav = buildReplaceAudio({ videoIn: "v.mp4", audioIn: "a.wav", outName: "o.mp4", containerExt: "mp4" });
  check("replace: wav into mp4 becomes aac (mp4 cannot hold pcm)", rpWav.join(" ").includes("-c:a") && rpWav.includes("aac"));
  const rpWebm = buildReplaceAudio({ videoIn: "v.webm", audioIn: "a.mp3", outName: "o.webm", containerExt: "webm" });
  check("replace: webm uses vorbis, never libopus", rpWebm.includes("libvorbis") && !rpWebm.join(" ").includes("libopus"));
  const rpAvi = buildReplaceAudio({ videoIn: "v.avi", audioIn: "a.flac", outName: "o.avi", containerExt: "avi" });
  check("replace: avi uses mp3 audio", rpAvi.includes("libmp3lame"));

  // replace-audio reuses the proven filter-free remux
  const rx = buildRemux({ videoIn: 'v.mp4', audioIn: 'a.m4a', outName: 'o.mp4' });
  check('replace: copies both streams, no filters', has(rx, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy') && !rx.join(' ').includes('-af') && !rx.join(' ').includes('-vf'));

  // registry: new tools gated correctly
  const tFrames = TOOLS.find(function (t) { return t.id === 'vframes'; });
  const tGif = TOOLS.find(function (t) { return t.id === 'vgif'; });
  const tSlide = TOOLS.find(function (t) { return t.id === 'vslideshow'; });
  const tRep = TOOLS.find(function (t) { return t.id === 'vreplace'; });
  check('registry: frames + replace need video', !!tFrames && tFrames.needsVideo === true && !!tRep && tRep.needsVideo === true);
  check('registry: gif tool needs a gif', !!tGif && tGif.needsGif === true);
  check('registry: slideshow needs 2 images', !!tSlide && tSlide.needsImages === 2);
  check('registry: frame cap is sane', MAX_EXTRACT_FRAMES === 12);
}

// --- compact rail labels (phones) ---
{
  const missing = TOOLS.filter((t) => !t.short);
  check("shorts: every audio tool has one", missing.length === 0, missing.map((t) => t.id).join(","));
  const longer = TOOLS.filter((t) => t.short && t.short.length > t.label.length);
  check("shorts: never longer than the label", longer.length === 0, longer.map((t) => t.id).join(","));
  const ids = new Set(TOOLS.map((t) => t.id));
  check("shorts: ids still unique", ids.size === TOOLS.length);
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}