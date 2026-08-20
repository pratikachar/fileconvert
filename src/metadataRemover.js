import JSZip from 'jszip';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 20;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const AI_SIGNATURES = [
  'stable diffusion', 'automatic1111', 'a1111', 'comfyui', 'midjourney',
  'dall-e', 'dall e', 'chatgpt', 'gpt image', 'firefly', 'leonardo ai',
  'ideogram', 'canva', 'flux', 'grok', 'sora', 'runway', 'pika', 'nightcafe',
  'bing image', 'dreamstudio', 'stability.ai', 'gradio', 'parameters',
  'negative prompt', 'seed:', 'steps:', 'cfg scale', 'sampler', 'model hash',
  'sd checkpoint', 'ensd', 'denoising', 'hires fix', 'lora', 'embeddings',
];

const AI_PNG_KEYWORDS = [
  'parameters', 'prompt', 'negative prompt', 'workflow', 'seed', 'steps',
  'cfg scale', 'sampler', 'model hash', 'checksum', 'ui settings', 'samples',
];

let state = { items: [] };

/* ----------------------- CRC32 (zlib) ----------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ----------------------- helpers ----------------------- */
function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function readASCII(buf, start, len) {
  let s = '';
  for (let i = start; i < start + len && i < buf.length; i++) {
    const c = buf[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function bytesToHex(buf, start, len) {
  let s = '';
  for (let i = start; i < start + len && i < buf.length; i++) {
    s += buf[i].toString(16).padStart(2, '0');
  }
  return s;
}

function looksAI(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return AI_SIGNATURES.some((sig) => t.includes(sig));
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function stampName(name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  return `${base}-clean${ext ? '.' + ext : ''}`;
}

/* ----------------------- PNG ----------------------- */
function parsePNGChunks(buf) {
  const chunks = [];
  if (buf.length < 8 || !PNG_SIG.every((b, i) => buf[i] === b)) {
    throw new Error('Not a valid PNG');
  }
  let pos = 8;
  const dv = new DataView(buf.buffer, buf.byteOffset);
  while (pos + 8 <= buf.length) {
    const len = dv.getUint32(pos);
    const type = readASCII(buf, pos + 4, 4);
    if (pos + 12 + len > buf.length) throw new Error('Truncated PNG chunk');
    chunks.push({ type, data: buf.slice(pos + 8, pos + 8 + len), offset: pos, length: len });
    pos += 12 + len;
  }
  return chunks;
}

function pngTextKeyword(data) {
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) return readASCII(data, 0, i).toLowerCase();
  }
  return readASCII(data, 0, Math.min(32, data.length)).toLowerCase();
}

function pngTextValue(data) {
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) return readASCII(data, i + 1, data.length - i - 1);
  }
  return '';
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function pngTextChunk(keyword, value) {
  const enc = new TextEncoder();
  const data = new Uint8Array(keyword.length + 1 + value.length);
  const kw = enc.encode(keyword);
  data.set(kw, 0);
  data[keyword.length] = 0;
  data.set(enc.encode(value), keyword.length + 1);
  return pngChunk('tEXt', data);
}

const PNG_KEEP_ALWAYS = new Set([
  'IHDR', 'PLTE', 'IDAT', 'tRNS', 'gAMA', 'sRGB', 'cHRM', 'bKGD', 'sBIT',
  'pHYs', 'hIST', 'sPLT', 'oFFs', 'sCAL', 'pCAL', 'iCCP', 'acTL', 'fcTL', 'fdAT',
]);

function keepPNGChunk(type, data, opts) {
  if (PNG_KEEP_ALWAYS.has(type)) {
    if (type === 'iCCP') return opts.keepICC;
    return true;
  }
  if (type === 'eXIf') return !opts.stripEXIF;
  if (type === 'IEND') return true;
  if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
    const kw = pngTextKeyword(data);
    if (kw === 'c2pa' || kw === 'com.adobe.c2pa') return !opts.stripC2PA;
    if (kw === 'xml:com.adobe.xmp' || kw === 'xmp') return !opts.stripXMP;
    const isAI = AI_PNG_KEYWORDS.includes(kw) || looksAI(pngTextValue(data));
    if (isAI) return !opts.stripPNGText;
    if (opts.mode === 'all') return false;
    return true;
  }
  // unknown ancillary chunk
  if (opts.mode === 'all') return false;
  return true;
}

function processPNG(buf, opts) {
  const chunks = parsePNGChunks(buf);
  const out = [Uint8Array.from(PNG_SIG)];
  for (const c of chunks) {
    if (c.type === 'IEND') continue;
    if (keepPNGChunk(c.type, c.data, opts)) {
      const arr = new Uint8Array(12 + c.data.length);
      new DataView(arr.buffer).setUint32(0, c.data.length);
      for (let i = 0; i < 4; i++) arr[4 + i] = c.type.charCodeAt(i);
      arr.set(c.data, 8);
      new DataView(arr.buffer).setUint32(8 + c.data.length, crc32(arr, 4, 8 + c.data.length));
      out.push(arr);
    }
  }
  if (opts.addCamera) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}:${pad(now.getMonth() + 1)}:${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    out.push(pngTextChunk('Software', opts.software || 'Adobe Photoshop 25.0 (Windows)'));
    out.push(pngTextChunk('CreateDate', stamp));
  }
  out.push(pngChunk('IEND', new Uint8Array(0)));
  return concatBytes(out);
}

/* ----------------------- JPEG ----------------------- */
function jpegSegments(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Not a valid JPEG');
  const segs = [];
  let tail = null;
  let pos = 2;
  const dv = new DataView(buf.buffer, buf.byteOffset);
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) { pos++; continue; }
    const marker = buf[pos + 1];
    if (marker === 0xd9) { segs.push({ marker: 0xd9, payload: new Uint8Array(0), at: pos }); break; }
    if (marker === 0x00 || marker === 0xff) { pos++; continue; }
    if (marker >= 0xd0 && marker <= 0xd8) {
      segs.push({ marker, payload: new Uint8Array(0), at: pos });
      pos += 2;
      continue;
    }
    const len = dv.getUint16(pos + 2);
    const payload = buf.slice(pos + 4, pos + 2 + len);
    segs.push({ marker, payload, at: pos, len });
    pos += 2 + len;
    if (marker === 0xda) { // SOS — everything after is entropy-coded scan data, copy verbatim
      tail = buf.slice(pos);
      break;
    }
  }
  return { segs, tail };
}

function jpegApp1Kind(payload) {
  if (!payload || payload.length < 5) return 'other';
  const head = readASCII(payload, 0, Math.min(40, payload.length));
  if (head.startsWith('Exif')) return 'exif';
  if (head.startsWith('http://ns.adobe.com/xap/1.0')) return 'xmp';
  if (head.startsWith('http://ns.adobe.com/exif/1.0')) return 'exif-xmp';
  if (head.startsWith('JUMBF') || head.includes('c2pa') || head.includes('application/c2pa')) return 'c2pa';
  return 'other';
}

function keepJPEGSegment(seg, opts) {
  if (seg.marker === 0xd9) return true;
  if (seg.marker === 0xff01) return true; // TEM
  if (seg.marker >= 0xe0 && seg.marker <= 0xef) { // APPn
    if (seg.marker === 0xe0) return true; // JFIF
    if (seg.marker === 0xe1) {
      const kind = jpegApp1Kind(seg.payload);
      if (kind === 'c2pa') return !opts.stripC2PA;
      if (kind === 'xmp') return !opts.stripXMP;
      if (kind === 'exif' || kind === 'exif-xmp') return !opts.stripEXIF && !opts.addCamera;
      return opts.mode === 'ai';
    }
    if (seg.marker === 0xe2) { // APP2: ICC / MPF
      const head = readASCII(seg.payload, 0, Math.min(12, seg.payload.length));
      if (head.startsWith('ICC_PROFILE')) return opts.keepICC;
      if (head.startsWith('MPF')) return true;
      return true;
    }
    if (seg.marker === 0xed) { // APP13 Photoshop/IPTC
      const head = readASCII(seg.payload, 0, Math.min(12, seg.payload.length));
      if (head.startsWith('Photoshop 3.0')) return opts.mode === 'ai' || !opts.stripEXIF;
      return true;
    }
    if (seg.marker === 0xee) return true; // APP14 Adobe
    return opts.mode === 'ai';
  }
  if (seg.marker === 0xfe) { // COM
    if (opts.mode === 'all') return !opts.stripEXIF;
    const comment = readASCII(seg.payload, 0, seg.payload.length);
    if (looksAI(comment)) return !opts.stripPNGText;
    return true;
  }
  return true; // SOF/DHT/DQT/SOS/etc — keep
}

function jpegExifSegment(payload) {
  const arr = new Uint8Array(2 + 2 + payload.length);
  arr[0] = 0xff;
  arr[1] = 0xe1;
  const dv = new DataView(arr.buffer);
  dv.setUint16(2, payload.length + 2);
  arr.set(payload, 4);
  return arr;
}

function buildExifTIFF(make, model, software, datetime) {
  const enc = new TextEncoder();
  const ascii = (s) => enc.encode(s + '\0');
  const strs = {
    make: ascii(make || ''),
    model: ascii(model || ''),
    software: ascii(software || ''),
    dt: ascii(datetime || ''),
  };
  const n = 5;
  const entryLen = 12;
  const ifdOffset = 8;
  const ifdLen = 2 + n * entryLen + 4;
  let off = ifdOffset + ifdLen;
  if (off % 2) off++;
  const offsets = {};
  for (const key of ['make', 'model', 'software', 'dt']) {
    offsets[key] = off;
    off += strs[key].length;
    if (off % 2) off++;
  }
  const buf = new Uint8Array(off);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x49; buf[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, n, true);
  const put = (idx, tag, type, count, value) => {
    const e = 10 + idx * entryLen;
    dv.setUint16(e, tag, true);
    dv.setUint16(e + 2, type, true);
    dv.setUint32(e + 4, count, true);
    dv.setUint32(e + 8, value, true);
  };
  put(0, 0x010f, 2, strs.make.length, offsets.make);
  put(1, 0x0110, 2, strs.model.length, offsets.model);
  put(2, 0x0131, 2, strs.software.length, offsets.software);
  put(3, 0x0132, 2, strs.dt.length, offsets.dt);
  put(4, 0x0112, 3, 1, 1); // Orientation
  dv.setUint32(8 + n * entryLen + 2, 0, true);
  for (const key of ['make', 'model', 'software', 'dt']) buf.set(strs[key], offsets[key]);
  return buf;
}

function processJPEG(buf, opts) {
  const { segs, tail } = jpegSegments(buf);
  const out = [new Uint8Array([0xff, 0xd8])];
  if (opts.addCamera) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dt = `${now.getFullYear()}:${pad(now.getMonth() + 1)}:${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const tiff = buildExifTIFF(opts.make, opts.model, opts.software, dt);
    const payload = new Uint8Array(6 + tiff.length);
    payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
    payload.set(tiff, 6);
    out.push(jpegExifSegment(payload));
  }
  for (const seg of segs) {
    if (seg.marker === 0xd9) { out.push(new Uint8Array([0xff, 0xd9])); break; }
    if (!keepJPEGSegment(seg, opts)) continue;
    if (seg.marker >= 0xd0 && seg.marker <= 0xd8) {
      out.push(new Uint8Array([0xff, seg.marker]));
      continue;
    }
    const arr = new Uint8Array(2 + 2 + seg.payload.length);
    arr[0] = 0xff;
    arr[1] = seg.marker;
    const dv = new DataView(arr.buffer);
    dv.setUint16(2, seg.payload.length + 2);
    arr.set(seg.payload, 4);
    out.push(arr);
  }
  if (tail) out.push(tail);
  return concatBytes(out);
}

/* ----------------------- WebP ----------------------- */
function parseWebPChunks(buf) {
  if (readASCII(buf, 0, 4) !== 'RIFF' || readASCII(buf, 8, 4) !== 'WEBP') {
    throw new Error('Not a valid WebP');
  }
  const chunks = [];
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const tag = readASCII(buf, pos, 4);
    const len = new DataView(buf.buffer, buf.byteOffset + pos).getUint32(4, true);
    const data = buf.slice(pos + 8, pos + 8 + len);
    chunks.push({ tag, data, offset: pos });
    pos += 8 + len + (len % 2);
  }
  return chunks;
}

function keepWebPChunk(chunk, opts) {
  if (chunk.tag === 'VP8 ' || chunk.tag === 'VP8L' || chunk.tag === 'ALPH') return true;
  if (chunk.tag === 'VP8X') return true;
  if (chunk.tag === 'ANIM' || chunk.tag === 'ANMF') return true;
  if (chunk.tag === 'ICCP') return opts.keepICC;
  if (chunk.tag === 'EXIF') return !opts.stripEXIF;
  if (chunk.tag === 'XMP ') return !opts.stripXMP;
  if (chunk.tag === 'C2PA' || chunk.tag === 'c2pa') return !opts.stripC2PA;
  if (chunk.tag === 'META') return !opts.stripEXIF;
  if (chunk.tag === 'FRM ' || chunk.tag === 'FRGA') return true;
  if (chunk.tag === 'SKIP') return true;
  return opts.mode === 'ai';
}

function processWebP(buf, opts) {
  const chunks = parseWebPChunks(buf);
  const kept = chunks.filter((c) => keepWebPChunk(c, opts));
  const out = [];
  for (const c of kept) {
    let data = c.data;
    if (c.tag === 'VP8X' && data.length >= 5) {
      const copy = data.slice();
      let flags = copy[4];
      if (!opts.keepICC) flags &= ~0x01;
      if (!opts.stripEXIF) flags &= ~0x04;
      if (!opts.stripXMP) flags &= ~0x08;
      copy[4] = flags;
      data = copy;
    }
    const size = data.length;
    const arr = new Uint8Array(8 + size + (size % 2));
    for (let i = 0; i < 4; i++) arr[i] = c.tag.charCodeAt(i);
    new DataView(arr.buffer).setUint32(4, size, true);
    arr.set(data, 8);
    out.push(arr);
  }
  const body = concatBytes(out);
  const header = new Uint8Array(12);
  for (let i = 0; i < 4; i++) header[i] = 'RIFF'.charCodeAt(i);
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  for (let i = 0; i < 4; i++) header[8 + i] = 'WEBP'.charCodeAt(i);
  return concatBytes([header, body]);
}

/* ----------------------- Scan / report ----------------------- */
function parseEXIF(exifBlock) {
  try {
    const buf = exifBlock;
    if (!buf || buf.length < 8) return {};
    let off = 0;
    if (readASCII(buf, 0, 5) === 'Exif') off = 6;
    if (buf.length < off + 8) return {};
    const endian = readASCII(buf, off, 2);
    if (endian !== 'II' && endian !== 'MM') return {};
    const little = endian === 'II';
    const dv = new DataView(buf.buffer, buf.byteOffset);
    const u16 = (o) => dv.getUint16(o, little);
    const u32 = (o) => dv.getUint32(o, little);
    if (u16(off + 2) !== 42) return {};
    const ifd0 = off + u32(off + 4);
    if (ifd0 + 2 > buf.length) return {};
    const out = {};
    const readIFD = (ifdStart) => {
      const n = u16(ifdStart);
      let gpsIfd = null;
      for (let i = 0; i < n; i++) {
        const e = ifdStart + 2 + i * 12;
        if (e + 12 > buf.length) break;
        const tag = u16(e);
        const type = u16(e + 2);
        const count = u32(e + 4);
        const readASCII = (start, len) => {
          let s = '';
          for (let k = start; k < start + len && k < buf.length; k++) {
            const c = buf[k];
            if (!c) break;
            s += String.fromCharCode(c);
          }
          return s;
        };
        const valuePos = () => (count > 4 ? off + u32(e + 8) : e + 8);
        if (tag === 0x010f && type === 2) out.make = readASCII(valuePos(), count);
        else if (tag === 0x0110 && type === 2) out.model = readASCII(valuePos(), count);
        else if (tag === 0x0131 && type === 2) out.software = readASCII(valuePos(), count);
        else if (tag === 0x0132 && type === 2) out.datetime = readASCII(valuePos(), count);
        else if (tag === 0x9003 && type === 2) out.datetime = out.datetime || readASCII(valuePos(), count);
        else if (tag === 0x8825 && type === 4 && count === 1) gpsIfd = off + u32(e + 8);
      }
      return gpsIfd;
    };
    const gpsIfd = readIFD(ifd0);
    if (gpsIfd != null && gpsIfd + 2 <= buf.length) {
      const n = u16(gpsIfd);
      let found = false;
      for (let i = 0; i < n; i++) {
        const e = gpsIfd + 2 + i * 12;
        if (e + 12 > buf.length) break;
        const tag = u16(e);
        if (tag >= 0x0001 && tag <= 0x0004) found = true;
      }
      if (found) out.gps = true;
    }
    return out;
  } catch {
    return {};
  }
}

function scanPNG(buf) {
  const chunks = parsePNGChunks(buf);
  const report = { format: 'png', c2pa: false, xmp: false, exif: {}, icc: false, text: [], ai: [] };
  for (const c of chunks) {
    if (c.type === 'iCCP') report.icc = true;
    if (c.type === 'eXIf') report.exif = parseEXIF(c.data) || {};
    if (c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt') {
      const kw = pngTextKeyword(c.data);
      const val = pngTextValue(c.data);
      if (kw === 'c2pa' || kw === 'com.adobe.c2pa') report.c2pa = true;
      if (kw === 'xml:com.adobe.xmp' || kw === 'xmp') report.xmp = true;
      report.text.push({ kw, val: val.slice(0, 60), raw: val });
      if (AI_PNG_KEYWORDS.includes(kw) || looksAI(val) || looksAI(kw)) {
        report.ai.push(kw || 'AI tag');
      }
    }
  }
  return report;
}

function scanJPEG(buf) {
  const { segs } = jpegSegments(buf);
  const report = { format: 'jpeg', c2pa: false, xmp: false, exif: {}, icc: false, iptc: false, ai: [] };
  for (const seg of segs) {
    if (seg.marker === 0xe1) {
      const kind = jpegApp1Kind(seg.payload);
      if (kind === 'c2pa') report.c2pa = true;
      if (kind === 'xmp') { report.xmp = true; report.ai.push('XMP'); }
      if (kind === 'exif' || kind === 'exif-xmp') {
        report.exif = { ...report.exif, ...(parseEXIF(seg.payload) || {}) };
      }
    }
    if (seg.marker === 0xe2) {
      const head = readASCII(seg.payload, 0, Math.min(12, seg.payload.length));
      if (head.startsWith('ICC_PROFILE')) report.icc = true;
    }
    if (seg.marker === 0xed) {
      const head = readASCII(seg.payload, 0, Math.min(12, seg.payload.length));
      if (head.startsWith('Photoshop 3.0')) report.iptc = true;
    }
    if (seg.marker === 0xfe) {
      const comment = readASCII(seg.payload, 0, seg.payload.length);
      if (looksAI(comment)) report.ai.push('AI comment');
    }
  }
  if (report.exif.software && looksAI(report.exif.software)) report.ai.push('AI software');
  return report;
}

function scanWebP(buf) {
  const chunks = parseWebPChunks(buf);
  const report = { format: 'webp', c2pa: false, xmp: false, exif: {}, icc: false, ai: [] };
  for (const c of chunks) {
    if (c.tag === 'ICCP') report.icc = true;
    if (c.tag === 'EXIF') {
      const info = parseEXIF(c.data);
      report.exif = { ...report.exif, ...info };
    }
    if (c.tag === 'XMP ') { report.xmp = true; report.ai.push('XMP'); }
    if (c.tag === 'C2PA' || c.tag === 'c2pa') report.c2pa = true;
  }
  if (report.exif.software && looksAI(report.exif.software)) report.ai.push('AI software');
  return report;
}

function scanBuffer(buf, format) {
  if (format === 'png') return scanPNG(buf);
  if (format === 'jpeg') return scanJPEG(buf);
  return scanWebP(buf);
}

function formatFromName(name, type) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'png' || type === 'image/png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg' || type === 'image/jpeg') return 'jpeg';
  if (ext === 'webp' || type === 'image/webp') return 'webp';
  if (ext === 'zip') return 'zip';
  return 'unknown';
}

function mimeFor(format) {
  return { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[format] || 'application/octet-stream';
}

/* ----------------------- processing pipeline ----------------------- */
function processBuffer(buf, format, opts) {
  if (format === 'png') return processPNG(buf, opts);
  if (format === 'jpeg') return processJPEG(buf, opts);
  if (format === 'webp') return processWebP(buf, opts);
  throw new Error('Unsupported format: ' + format);
}

function defaultOpts() {
  return {
    mode: 'ai',
    stripC2PA: true,
    stripXMP: true,
    stripEXIF: false,
    stripPNGText: true,
    keepICC: true,
    addCamera: false,
    make: 'Sony',
    model: 'ILCE-7M4',
    software: 'Adobe Photoshop 25.0 (Windows)',
  };
}

/* ----------------------- UI ----------------------- */
export function setupAIMetadataRemover() {
  const zone = $('#ai-upload-zone');
  const input = $('#ai-file-input');
  const panel = $('#ai-panel');
  const fileList = $('#ai-file-list');
  const cleanBtn = $('#ai-clean');
  const clearBtn = $('#ai-clear');
  const progressWrap = $('#ai-progress');
  const progressBar = $('#ai-progress-bar');
  const progressText = $('#ai-progress-text');
  const resultEl = $('#ai-result');
  const addCameraChk = $('#ai-add-camera');
  const cameraFields = $('#ai-camera-fields');

  const modeBtns = $$('.seg-btn', $('#tab-content-ai'));

  function readOpts() {
    const opts = defaultOpts();
    const active = modeBtns.find((b) => b.classList.contains('active'));
    opts.mode = active ? active.dataset.mode : 'ai';
    opts.stripC2PA = $('#ai-strip-c2pa').checked;
    opts.stripXMP = $('#ai-strip-xmp').checked;
    opts.stripEXIF = $('#ai-strip-exif').checked;
    opts.stripPNGText = $('#ai-strip-png').checked;
    opts.keepICC = $('#ai-keep-icc').checked;
    opts.addCamera = addCameraChk.checked;
    opts.make = $('#ai-make').value.trim();
    opts.model = $('#ai-model').value.trim();
    opts.software = $('#ai-software').value.trim();
    return opts;
  }

  function setMode(mode) {
    for (const b of modeBtns) b.classList.toggle('active', b.dataset.mode === mode);
    const isAI = mode === 'ai';
    $('#ai-strip-exif').checked = !isAI;
    $('#ai-strip-c2pa').checked = true;
    $('#ai-strip-xmp').checked = true;
    $('#ai-strip-png').checked = true;
  }

  modeBtns.forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });

  addCameraChk.addEventListener('change', () => {
    cameraFields.classList.toggle('hidden', !addCameraChk.checked);
  });

  zone.addEventListener('click', (e) => {
    if (e.target.closest('.ai-item') || e.target.closest('input')) return;
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
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) addFiles(files);
  });
  input.addEventListener('change', () => {
    addFiles(Array.from(input.files || []));
    input.value = '';
  });

  cleanBtn.addEventListener('click', clean);
  clearBtn.addEventListener('click', clearAll);

  window.__aiAddFiles = addFiles;

  function badge(text, cls) {
    return `<span class="ai-badge ${cls}">${text}</span>`;
  }

  function renderItem(item) {
    const r = item.report;
    const badges = [];
    if (r.c2pa) badges.push(badge('C2PA', 'b-warn'));
    if (r.xmp) badges.push(badge('XMP', 'b-warn'));
    if (r.exif && (r.exif.make || r.exif.model || r.exif.software || r.exif.gps)) badges.push(badge('EXIF', 'b-info'));
    if (r.icc) badges.push(badge('ICC', 'b-info'));
    if (r.iptc) badges.push(badge('IPTC', 'b-info'));
    if (r.text && r.text.length) badges.push(badge(r.text.length + ' PNG tag' + (r.text.length > 1 ? 's' : ''), 'b-info'));
    if (r.ai && r.ai.length) badges.push(badge('AI', 'b-ai'));
    if (!badges.length) badges.push(badge('No metadata', 'b-clean'));

    const aiCount = (r.c2pa ? 1 : 0) + (r.xmp ? 1 : 0) + (r.ai.length ? 1 : 0) + (r.text.filter((t) => AI_PNG_KEYWORDS.includes(t.kw) || looksAI(t.val)).length ? 1 : 0);
    const verdict = aiCount > 0
      ? `<div class="ai-verdict v-ai">⚠ ${aiCount} AI marker${aiCount > 1 ? 's' : ''}</div>`
      : (badges.some((b) => b.includes('No metadata')) ? '<div class="ai-verdict v-clean">✓ No metadata</div>' : '<div class="ai-verdict v-meta">Metadata only</div>');

    const dims = item.dims ? `${item.dims.w}×${item.dims.h} · ` : '';
    const details = buildDetails(r);
    item.el = document.createElement('div');
    item.el.className = 'ai-item' + (item.error ? ' has-error' : '');
    item.el.innerHTML = `
      <img class="ai-thumb" alt="" ${item.thumb ? `src="${item.thumb}"` : ''} />
      <div class="ai-item-body">
        <div class="ai-item-top">
          <div class="ai-item-name" title="${item.name}">${item.name}</div>
          <div class="ai-item-actions">
            <label class="checkbox-label ai-include">
              <input type="checkbox" data-id="${item.id}" ${item.selected ? 'checked' : ''} />
              <span>Clean</span>
            </label>
            <button class="btn-secondary btn-mini" data-remove="${item.id}" title="Remove">✕</button>
          </div>
        </div>
        <div class="ai-item-meta">${dims}${formatBytes(item.size)}</div>
        <div class="ai-badges">${badges.join(' ')}</div>
        ${verdict}
        ${details ? `<details class="ai-details"><summary>Details</summary><pre>${details}</pre></details>` : ''}
        ${item.result ? `<div class="ai-item-result">${item.result}</div>` : ''}
        ${item.error ? `<div class="ai-item-error">✕ ${item.error}</div>` : ''}
      </div>
    `;
    return item.el;
  }

  function buildDetails(r) {
    const lines = [];
    if (r.c2pa) lines.push('• C2PA / Content Credentials present (AI provenance)');
    if (r.xmp) lines.push('• XMP metadata present (AI creator / prompt data)');
    const ex = r.exif || {};
    if (ex.make || ex.model || ex.software || ex.datetime) {
      lines.push('• EXIF: ' + [ex.make, ex.model, ex.software, ex.datetime].filter(Boolean).join(' · '));
    }
    if (ex.gps) lines.push('• GPS coordinates present');
    if (r.iptc) lines.push('• IPTC (Photoshop) metadata present');
    if (r.icc) lines.push('• ICC color profile present');
    for (const t of (r.text || [])) {
      if (AI_PNG_KEYWORDS.includes(t.kw) || looksAI(t.raw)) lines.push(`• PNG "${t.kw}" = ${t.val}`);
    }
    if (!lines.length) return null;
    return lines.join('\n');
  }

  function renderList() {
    fileList.innerHTML = '';
    for (const item of state.items) fileList.appendChild(renderItem(item));
    $$('.ai-include input', fileList).forEach((cb) => {
      cb.addEventListener('change', () => {
        const item = state.items.find((i) => i.id === Number(cb.dataset.id));
        if (item) item.selected = cb.checked;
      });
    });
    $$('[data-remove]', fileList).forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.remove);
        const idx = state.items.findIndex((i) => i.id === id);
        if (idx >= 0) {
          const item = state.items[idx];
          if (item.thumb) URL.revokeObjectURL(item.thumb);
          state.items.splice(idx, 1);
          renderList();
        }
      });
    });
  }

  function resetProgress() {
    progressWrap.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Preparing…';
  }

  function setProgress(pct, text) {
    progressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (text) progressText.textContent = text;
  }

  function collectZipEntries(zipEntries, seen) {
    const out = [];
    for (const e of zipEntries) {
      if (e.dir) continue;
      const format = formatFromName(e.name, '');
      if (format === 'unknown') continue;
      if (seen.has(e.name.toLowerCase())) continue;
      seen.add(e.name.toLowerCase());
      out.push({ name: e.name, format });
    }
    return out;
  }

  async function addFiles(files) {
    let all = Array.from(files);
    // expand zips first
    const expanded = [];
    for (const f of all) {
      const format = formatFromName(f.name, f.type);
      if (format === 'zip') {
        try {
          const zip = await JSZip.loadAsync(f);
          const entries = Object.values(zip.files).filter((e) => !e.dir);
          const imgs = collectZipEntries(entries, new Set());
          if (!imgs.length) {
            alert('ZIP contains no supported images (PNG/JPEG/WebP).');
            continue;
          }
          let ok = 0;
          for (const img of imgs) {
            const blob = await zip.file(img.name).async('blob');
            if (blob.size > MAX_FILE_BYTES) continue;
            expanded.push({ blob, name: img.name, format: img.format });
            ok++;
            if (ok + state.items.length >= MAX_FILES) break;
          }
          if (!ok) {
            alert('No usable images inside that ZIP.');
          }
        } catch (err) {
          alert('Could not read ZIP: ' + (err.message || 'invalid archive'));
        }
      } else if (format !== 'unknown') {
        expanded.push({ blob: f, name: f.name, format });
      }
    }

    let added = 0;
    for (const e of expanded) {
      if (state.items.length + added >= MAX_FILES) {
        alert(`Batch limit reached (${MAX_FILES} files). Extra files were skipped.`);
        break;
      }
      if (e.blob.size > MAX_FILE_BYTES) {
        alert(`"${e.name}" exceeds the 50 MB per-file limit and was skipped.`);
        continue;
      }
      const item = await addItem(e.blob, e.name, e.format);
      if (item) added++;
    }
    if (added) {
      panel.classList.remove('hidden');
      renderList();
      resultEl.classList.add('hidden');
    }
  }

  async function addItem(blob, name, format) {
    const item = {
      id: Date.now() + Math.random(),
      name,
      format,
      blob,
      size: blob.size,
      selected: true,
      report: null,
      thumb: null,
      dims: null,
      result: null,
      error: null,
    };
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      item.report = scanBuffer(buf, format);
      item.thumb = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { item.dims = { w: img.naturalWidth, h: img.naturalHeight }; if (item.el) renderList(); };
      img.src = item.thumb;
      state.items.push(item);
      return item;
    } catch (err) {
      item.error = err.message || 'Unreadable file';
      state.items.push(item);
      return item;
    }
  }

  async function clean() {
    const selected = state.items.filter((i) => i.selected);
    if (!selected.length) {
      alert('Select at least one file to clean.');
      return;
    }
    const opts = readOpts();
    cleanBtn.disabled = true;
    resetProgress();
    resultEl.classList.add('hidden');

    const results = [];
    let done = 0;
    for (const item of selected) {
      try {
        setProgress((done / selected.length) * 100, `Cleaning ${item.name}…`);
        const buf = new Uint8Array(await item.blob.arrayBuffer());
        const outBuf = processBuffer(buf, item.format, opts);
        const outBlob = new Blob([outBuf], { type: mimeFor(item.format) });
        item.result = `${formatBytes(item.size)} → ${formatBytes(outBlob.size)} · ✓`;
        item.error = null;
        results.push({ name: stampName(item.name), blob: outBlob, format: item.format });
        done++;
        setProgress((done / selected.length) * 100, `${done}/${selected.length} cleaned`);
      } catch (err) {
        item.result = null;
        item.error = err.message || 'Failed';
        done++;
      }
    }
    setProgress(100, 'Done');
    renderList();

    const cleanCount = results.length;
    const failCount = selected.length - results.length;
    let html = '';
    if (cleanCount === 0) {
      html = '<div class="ai-result-msg error">Nothing was cleaned. Check the errors above.</div>';
    } else if (cleanCount === 1) {
      const r = results[0];
      html = `<div class="ai-result-msg ok">${failCount ? `1 cleaned, ${failCount} failed. ` : ''}Download cleaned file:</div>
        <button id="ai-download-single" class="btn-primary">⬇ Download ${r.name}</button>`;
    } else {
      html = `<div class="ai-result-msg ok">${cleanCount} files cleaned${failCount ? `, ${failCount} failed` : ''}. Batch saved as ZIP.</div>
        <button id="ai-download-zip" class="btn-primary">⬇ Download ZIP (${cleanCount})</button>`;
    }
    resultEl.innerHTML = html;
    resultEl.classList.remove('hidden');
    cleanBtn.disabled = false;

    const singleBtn = $('#ai-download-single');
    if (singleBtn) {
      singleBtn.addEventListener('click', () => downloadBlob(results[0].blob, results[0].name));
    }
    const zipBtn = $('#ai-download-zip');
    if (zipBtn) {
      zipBtn.addEventListener('click', async () => {
        zipBtn.disabled = true;
        const zip = new JSZip();
        for (const r of results) zip.file(r.name, r.blob);
        const out = await zip.generateAsync({ type: 'blob' });
        downloadBlob(out, 'fileforge-ai-cleaner.zip');
        zipBtn.disabled = false;
      });
    }
  }

  function clearAll() {
    for (const item of state.items) if (item.thumb) URL.revokeObjectURL(item.thumb);
    state.items = [];
    fileList.innerHTML = '';
    panel.classList.add('hidden');
    resultEl.classList.add('hidden');
    progressWrap.classList.add('hidden');
  }
}

export { scanBuffer, processBuffer, defaultOpts, formatFromName, mimeFor, buildExifTIFF };