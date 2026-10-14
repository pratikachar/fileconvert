/**
 * Proof tests for the AI Cleaner JPEG path.
 * Builds synthetic JPEGs with known markers and checks scanBuffer/processBuffer.
 * Run: node scripts/test-ai-jpeg.mjs  (exit 1 on any failure)
 */
import { scanBuffer, processBuffer, defaultOpts, mimeFor } from '../src/metadataRemover.js';

const enc = new TextEncoder();
let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}

/* ---------- tiny JPEG builder ---------- */
function seg(marker, payload) {
  const out = new Uint8Array(2 + 2 + payload.length);
  out[0] = 0xff; out[1] = marker;
  new DataView(out.buffer).setUint16(2, payload.length + 2);
  out.set(payload, 4);
  return out;
}
function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// minimal valid tail: SOS + a few entropy bytes + EOI
const SCAN_TAIL = (() => {
  const sos = seg(0xda, Uint8Array.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));
  return concat([sos, Uint8Array.from([0xd2, 0xcf, 0x20, 0xff, 0xd9])]);
})();
function jpeg(...segs) {
  return concat([Uint8Array.from([0xff, 0xd8]), ...segs, SCAN_TAIL]);
}

/* ---------- tiny TIFF builder (IFD0 only; offsets relative to TIFF start) ---------- */
function tiff(little, entries) {
  // entries: [{tag, type, value:Uint8Array}]
  const n = entries.length;
  const head = 8, ifdLen = 2 + n * 12 + 4;
  let dataOff = head + ifdLen;
  if (dataOff % 2) dataOff++;
  const total = { v: dataOff };
  for (const e of entries) {
    if (e.value.length <= 4) continue;
    e.at = total.v;
    total.v += e.value.length;
    if (total.v % 2) total.v++;
  }
  const buf = new Uint8Array(total.v);
  const dv = new DataView(buf.buffer);
  buf[0] = little ? 0x49 : 0x4d; buf[1] = buf[0];
  dv.setUint16(2, 42, little);
  dv.setUint32(4, 8, little);
  dv.setUint16(head, n, little);
  entries.forEach((e, i) => {
    const p = head + 2 + i * 12;
    dv.setUint16(p, e.tag, little);
    dv.setUint16(p + 2, e.type, little);
    dv.setUint32(p + 4, e.value.length / (e.type === 5 ? 8 : e.type === 3 || e.type === 9 ? 2 : 4 * 0 + (e.type === 4 ? 4 : 1)), little);
    if (e.value.length <= 4) { buf.set(e.value, p + 8); }
    else dv.setUint32(p + 8, e.at, little);
  });
  dv.setUint32(head + 2 + n * 12, 0, little);
  for (const e of entries) if (e.value.length > 4) buf.set(e.value, e.at);
  return buf;
}
const ascii = (s) => enc.encode(s + '\0');
function exifPayload(little, entries) {
  return concat([enc.encode('Exif\0\0'), tiff(little, entries)]);
}
const exifSeg = (little, entries) => seg(0xe1, exifPayload(little, entries));

const xmpSeg = (body) => seg(0xe1, concat([enc.encode('http://ns.adobe.com/xap/1.0/\0'), enc.encode(body)]));
const extXmpSeg = (body) => seg(0xe1, concat([enc.encode('http://ns.adobe.com/xmp/extension/1.0/\0'), enc.encode(body)]));
const iccSeg = () => seg(0xe2, concat([enc.encode('ICC_PROFILE\0'), Uint8Array.from([1, 1, 0, 0, 1, 2, 3])]));
const app13Seg = () => seg(0xed, concat([enc.encode('Photoshop 3.0\0'), enc.encode('8BIMcaption here')]));
function app11Seg(ci, boxBytes) {
  const head = Uint8Array.from([0x4a, 0x55, 0x4d, 0x42, 0x46, 0x00, ci]); // "JUMBF\0" + CI
  return seg(0xeb, concat([head, boxBytes]));
}
const c2paBox = () => {
  // jumb box containing a "c2pa" typed box, mirroring C2PA-in-JPEG
  const inner = concat([Uint8Array.from([0, 0, 0, 24]), enc.encode('jumb'), Uint8Array.from([0, 0, 0, 16]), enc.encode('c2pa'), Uint8Array.from([9, 9, 9, 9])]);
  return inner;
};
const jxlBox = () => concat([Uint8Array.from([0, 0, 0, 20]), enc.encode('jumb'), enc.encode('jxlc'), Uint8Array.from([7, 7, 7, 7])]);
const commentSeg = (t) => seg(0xfe, enc.encode(t));
const APP14 = seg(0xee, concat([enc.encode('Adobe\0'), Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]));
const JFIF = seg(0xe0, concat([enc.encode('JFIF\0'), Uint8Array.from([1, 2, 0, 0, 1, 0, 1, 0, 0])]));

/* ---------- build the cases ---------- */
const E = (tag, s) => ({ tag, type: 2, value: ascii(s) });
const phoneJpg = jpeg(
  JFIF,
  exifSeg(true, [E(0x010f, 'Google'), E(0x0110, 'Pixel 8'), E(0x0132, '2025:03:11 10:20:30')]),
  seg(0xe1, exifPayload(true, [])), // second exif APP1 (some cameras write two)
  xmpSeg('<x:xmpmeta>created with stable diffusion</x:xmpmeta>'),
  iccSeg(),
  APP14
);
const dtOnlyJpg = jpeg(JFIF, exifSeg(true, [E(0x0132, '2024:01:02 03:04:05')]));
const beJpg = jpeg(JFIF, exifSeg(false, [E(0x010f, 'Canon'), E(0x0110, 'EOS R5')]));
const c2paJpg = jpeg(
  JFIF,
  exifSeg(true, [E(0x010f, 'Adobe'), E(0x0131, 'Adobe Firefly')]),
  app11Seg(0x00, c2paBox()),
  app11Seg(0x01, Uint8Array.from([5, 5, 5, 5, 5, 5, 5, 5])),
  APP14
);
const jxlJpg = jpeg(JFIF, app11Seg(0x00, jxlBox())); // JXL-in-JUMBF: real image data, must NOT be flagged/stripped
const extXmpJpg = jpeg(JFIF, extXmpSeg('GUID chunk 1 of 2'), extXmpSeg('GUID chunk 2 of 2'));
const iptcComJpg = jpeg(JFIF, app13Seg(), commentSeg('Rendered by Leonardo AI, seed 42'));

/* ---------- scanner checks ---------- */
{
  const r = scanBuffer(phoneJpg, 'jpeg');
  check('phone EXIF make', r.exif.make === 'Google', JSON.stringify(r.exif));
  check('phone EXIF model', r.exif.model === 'Pixel 8');
  check('phone EXIF datetime', r.exif.datetime === '2025:03:11 10:20:30');
  check('phone XMP flagged', r.xmp === true);
  check('phone XMP -> ai', r.ai.includes('XMP'));
  check('phone ICC flagged', r.icc === true);
}
{
  const r = scanBuffer(dtOnlyJpg, 'jpeg');
  check('datetime-only EXIF parsed', r.exif.datetime === '2024:01:02 03:04:05');
}
{
  const r = scanBuffer(beJpg, 'jpeg');
  check('big-endian EXIF make', r.exif.make === 'Canon', JSON.stringify(r.exif));
  check('big-endian EXIF model', r.exif.model === 'EOS R5');
}
{
  const r = scanBuffer(c2paJpg, 'jpeg');
  check('C2PA APP11 detected', r.c2pa === true, JSON.stringify({ c2pa: r.c2pa, xmp: r.xmp }));
  check('APP11 Firefly software parsed', r.exif.software === 'Adobe Firefly');
}
{
  const r = scanBuffer(jxlJpg, 'jpeg');
  check('JXL APP11 not flagged as C2PA', r.c2pa === false, JSON.stringify({ c2pa: r.c2pa }));
}
{
  const r = scanBuffer(extXmpJpg, 'jpeg');
  check('extended XMP detected', r.xmp === true, JSON.stringify({ xmp: r.xmp }));
}
{
  const r = scanBuffer(iptcComJpg, 'jpeg');
  check('IPTC APP13 detected', r.iptc === true, JSON.stringify({ iptc: r.iptc }));
  check('AI comment detected', r.ai.includes('AI comment'), JSON.stringify(r.ai));
}
{
  // IPTC caption carrying an AI signature must surface as an AI marker
  const aiCap = jpeg(JFIF, seg(0xed, concat([enc.encode('Photoshop 3.0\0'), enc.encode('8BIM caption made by midjourney v6 seed 7')]))); 
  const r = scanBuffer(aiCap, 'jpeg');
  check('IPTC detected with AI caption', r.iptc === true);
  check('AI IPTC pushed', r.ai.includes('AI IPTC'), JSON.stringify(r.ai));
  const out = processBuffer(aiCap, 'jpeg', { ...defaultOpts(), mode: 'all', stripEXIF: true });
  check('remove-all strips IPTC', !hasBytes(out, enc.encode('midjourney')));
}
{
  // legacy JUMBF-in-APP1 path still works end to end
  const j1 = jpeg(JFIF, seg(0xe1, concat([enc.encode('JUMBF\0'), enc.encode('xx c2pa manifest yy')])));
  const r = scanBuffer(j1, 'jpeg');
  check('APP1 JUMBF flagged C2PA', r.c2pa === true);
  const out = processBuffer(j1, 'jpeg', defaultOpts());
  check('APP1 JUMBF stripped in AI mode', !hasBytes(out, enc.encode('c2pa')));
}

/* ---------- stripper checks (default AI-only opts) ---------- */
function hasMarker(buf, m) {
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 0xff && buf[i + 1] === m) return true;
  }
  return false;
}
function hasBytes(buf, bytes) {
  outer: for (let i = 0; i + bytes.length <= buf.length; i++) {
    for (let j = 0; j < bytes.length; j++) if (buf[i + j] !== bytes[j]) continue outer;
    return true;
  }
  return false;
}
{
  const out = processBuffer(c2paJpg, 'jpeg', defaultOpts());
  check('C2PA APP11 stripped (AI mode)', !hasMarker(out, 0xeb), 'APP11 marker still present');
  check('no c2pa bytes left', !hasBytes(out, enc.encode('c2pa')));
  check('output still decodable start', out[0] === 0xff && out[1] === 0xd8);
  check('output has EOI', out[out.length - 2] === 0xff && out[out.length - 1] === 0xd9);
  check('Firefly EXIF kept in AI mode (stripEXIF off)', hasBytes(out, enc.encode('Adobe Firefly')));
}
{
  const out = processBuffer(jxlJpg, 'jpeg', defaultOpts());
  check('JXL APP11 preserved', hasMarker(out, 0xeb) && hasBytes(out, enc.encode('jxlc')));
}
{
  const out = processBuffer(extXmpJpg, 'jpeg', defaultOpts());
  check('extended XMP stripped', !hasBytes(out, enc.encode('xmp/extension')));
}
{
  const out = processBuffer(phoneJpg, 'jpeg', { ...defaultOpts(), mode: 'all', stripEXIF: true, stripXMP: true, stripC2PA: true, keepICC: false });
  check('remove-all kills EXIF', !hasBytes(out, enc.encode('Pixel 8')));
  check('remove-all kills XMP', !hasBytes(out, enc.encode('x:xmpmeta')));
  check('remove-all kills ICC', !hasBytes(out, enc.encode('ICC_PROFILE')));
  check('remove-all keeps JFIF (renders)', hasBytes(out, enc.encode('JFIF')));
  check('remove-all keeps APP14 (renders)', hasBytes(out, enc.encode('Adobe')));
}
{
  const out = processBuffer(phoneJpg, 'jpeg', { ...defaultOpts(), mode: 'ai', stripXMP: true });
  check('AI mode keeps ICC by default', hasBytes(out, enc.encode('ICC_PROFILE')));
  check('AI mode keeps camera EXIF by default', hasBytes(out, enc.encode('Google')));
}
console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log('FAILURES:\n- ' + fails.join('\n- ')); process.exit(1); }