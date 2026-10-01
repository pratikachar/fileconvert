/**
 * Node checks for the Audio Toolbox pure logic (ops.js + waveform.js).
 * Run: node scripts/test-audio-ops.mjs
 */

import {
  buildTrim, buildConcat, concatList, buildFade, buildNormalize, buildSpeed, buildPitch,
  buildExtractAudio, buildSilenceTrim, buildReverse, buildTags, atempoChain, codecArgs,
  canLosslessTrim, isSupportedInput, isVideoExt, isTaggable, extOf, r3, MP3_FRAME_SAMPLES,
} from '../src/audio/ops.js';
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

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}