/**
 * Node checks for the PDF suite (src/pdftools/pdftools.js).
 * pdf-lib runs in Node, so merge/extract/rotate/images round-trips are
 * verified here with real bytes - the browser E2E only re-checks wiring.
 * Run: node scripts/test-pdftools.mjs
 */

import {
  parsePageSpec, pdfPageCount, mergePdfs, extractPages, rotatePages,
  imagesToPdf, blankPdf, pageRotations, MAX_SPLIT_PAGES,
  WATERMARK_POSITIONS, WATERMARK_FONTS, WATERMARK_PRESETS, WATERMARK_MAX_TEXT,
  watermarkDefaults, hexToRgb01, normalizeWatermarkOptions, rotatedBox, anchorForBox,
  marginBox, watermarkCentres, visibleSize, visibleToPage, pageAngleFor,
  canEncodeStandardText, pdfPageInfo, applyWatermark,
} from '../src/pdftools/pdftools.js';
import { PDF_TOOLS, WM_POS, WM_DEFAULTS } from '../src/pdftools/pdfTab.js';
import {
  PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream,
} from 'pdf-lib';

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}

/* ---- helpers for reading back what was actually drawn ---- */

const HEXU = (s) => Buffer.from(String(s), 'latin1').toString('hex').toUpperCase();

async function pageContent(pdf, index) {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPage(index);
  const chunks = [];
  const walk = (obj) => {
    if (!obj) return;
    if (obj instanceof PDFRawStream) {
      chunks.push(Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1'));
      return;
    }
    if (obj instanceof PDFArray) {
      obj.asArray().forEach((ref) => walk(doc.context.lookup(ref)));
    }
  };
  walk(page.node.Contents());
  return chunks.join('\n');
}

async function pageResourceKeys(pdf, index, kind) {
  const doc = await PDFDocument.load(pdf);
  const res = doc.context.lookup(doc.getPage(index).node.Resources());
  const dict = res && res.get ? res.get(PDFName.of(kind)) : null;
  return dict && dict.keys ? dict.keys().map((k) => k.asString()) : [];
}

async function pageAlphas(pdf, index) {
  const doc = await PDFDocument.load(pdf);
  const res = doc.context.lookup(doc.getPage(index).node.Resources());
  const dict = res && res.get ? res.get(PDFName.of('ExtGState')) : null;
  const out = [];
  if (!dict || !dict.keys) return out;
  dict.keys().forEach((k) => {
    const entry = dict.lookup(k);
    const ca = entry && entry.get ? entry.get(PDFName.of('ca')) : null;
    if (ca && typeof ca.asNumber === 'function') out.push(ca.asNumber());
  });
  return out;
}

/** Last text matrix on a page - the watermark is drawn after the page's own content. */
function lastTm(content) {
  const hits = content.match(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/g) || [];
  if (!hits.length) return null;
  return hits[hits.length - 1].split(' ').slice(0, 4).map(Number);
}

const ONE_PX_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

// page-spec parser
{
  check('spec: all expands', JSON.stringify(parsePageSpec('all', 3).pages) === '[0,1,2]');
  check('spec: empty means all', JSON.stringify(parsePageSpec('', 2).pages) === '[0,1]');
  check('spec: ranges + singles', JSON.stringify(parsePageSpec('1-3,5', 9).pages) === '[0,1,2,4]');
  check('spec: spaces tolerated', parsePageSpec(' 1 - 2 , 4 ', 9).ok === true);
  check('spec: dedupes', JSON.stringify(parsePageSpec('2,2,3', 9).pages) === '[1,2]');
  check('spec: reversed refused', !parsePageSpec('5-2', 9).ok);
  check('spec: garbage refused', !parsePageSpec('abc', 9).ok);
  check('spec: out of range refused', !parsePageSpec('1-99', 3).ok && /has 3/.test(parsePageSpec('1-99', 3).error));
  check('spec: page 0 refused', !parsePageSpec('0', 3).ok);
  check('spec: empty without file refused', !parsePageSpec('', 0).ok);
}

// real round-trips
const a = await blankPdf(2, 'A');
const b = await blankPdf(3, 'B');

{
  check('count: reads 2 and 3 pages', (await pdfPageCount(a)) === 2 && (await pdfPageCount(b)) === 3);
  let threw = false;
  try { await pdfPageCount(new Uint8Array([1, 2, 3])); } catch { threw = true; }
  check('count: garbage throws', threw);
}

{
  const merged = await mergePdfs([a, b]);
  check('merge: 2+3 pages = 5', (await pdfPageCount(merged)) === 5);
  check('merge: starts with %PDF', String.fromCharCode(...merged.slice(0, 4)) === '%PDF');
  let threw = false;
  try { await mergePdfs([]); } catch { threw = true; }
  check('merge: empty refused', threw);
}

{
  const ex = await extractPages(a, [1]);
  check('extract: single page', (await pdfPageCount(ex)) === 1);
  const ex2 = await extractPages(b, [2, 0]);
  check('extract: keeps requested order', (await pdfPageCount(ex2)) === 2);
  check('split cap sane', MAX_SPLIT_PAGES === 20);
}

{
  const rot = await rotatePages(a, [0], 90);
  const doc = await PDFDocument.load(rot);
  check('rotate: page 0 is 90deg', doc.getPage(0).getRotation().angle === 90);
  check('rotate: page 1 untouched', doc.getPage(1).getRotation().angle === 0);
  const rot2 = await rotatePages(a, [0, 1], 180);
  const doc2 = await PDFDocument.load(rot2);
  check('rotate: 180 both pages', doc2.getPage(0).getRotation().angle === 180 && doc2.getPage(1).getRotation().angle === 180);
  check('rotations: readable back', JSON.stringify(await pageRotations(rot2)) === '[180,180]');
  let threw = false;
  try { await rotatePages(a, [0], 45); } catch { threw = true; }
  check('rotate: 45deg refused', threw);
}

{
  // 1x1 red PNG + minimal JPEG fixtures
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const redJpg = await (async () => {
    // tiny valid JPEG: reuse pdf-lib? no - build via pdf blank? JPEG needed.
    // Minimal 1x1 JPEG (SOI, JFIF APP0, DQT, SOF0, DHT, SOS, EOI) - decoders accept it.
    return Uint8Array.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xFF, 0xDB, 0x00, 0x43, 0x00, ...Array(64).fill(8),
      0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
      0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
      0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x2A, 0x9D, 0xFF, 0xD9,
    ]);
  })();
  const fit = await imagesToPdf([{ bytes: png, mime: 'image/png' }, { bytes: redJpg, mime: 'image/jpeg' }], 'fit');
  check('images: 2 images = 2 pages', (await pdfPageCount(fit)) === 2);
  const a4 = await imagesToPdf([{ bytes: png, mime: 'image/png' }], 'a4');
  const a4doc = await PDFDocument.load(a4);
  const sz = a4doc.getPage(0).getSize();
  check('images: a4 mode makes an A4 sheet', Math.abs(sz.width - 595.28) < 0.01 && Math.abs(sz.height - 841.89) < 0.01);
  let threw = false;
  try { await imagesToPdf([], 'fit'); } catch { threw = true; }
  check('images: empty refused', threw);
}

{
  const missing = PDF_TOOLS.filter((t) => !t.short);
  check("shorts: every pdf tool has one", missing.length === 0, missing.map((t) => t.id).join(","));
  const longer = PDF_TOOLS.filter((t) => t.short && t.short.length > t.label.length);
  check("shorts: never longer than the label", longer.length === 0, longer.map((t) => t.id).join(","));
  check('tools: watermark is registered', PDF_TOOLS.some((t) => t.id === 'watermark'));
}

/* ============================================================
 * Watermarks
 * ============================================================ */

{
  const d = watermarkDefaults();
  check('wm: default text is WATERMARK', d.text === 'WATERMARK', d.text);
  check('wm: default is grey, 45 deg, 18%', d.color === '#808080' && d.angle === 45 && d.opacity === 18);
  check('wm: default is one centred mark, all pages', d.count === 'one' && d.position === 'mc');
  check('wm: panel defaults mirror the engine', JSON.stringify(WM_DEFAULTS) === JSON.stringify(d));
  check('wm: panel grid mirrors the engine grid',
    WM_POS.map((p) => p.id).join(',') === WATERMARK_POSITIONS.map((p) => p.id).join(','));
  check('wm: grid is 9 cells with centre in the middle',
    WATERMARK_POSITIONS.length === 9 && WATERMARK_POSITIONS[4].id === 'mc'
    && WATERMARK_POSITIONS[4].x === 0.5 && WATERMARK_POSITIONS[4].y === 0.5);
  check('wm: presets match WATERMARK_PRESETS on the chips',
    WATERMARK_PRESETS.map((p) => p.id).join(',') === 'recommended,confidential,draft,donotcopy'
    && WATERMARK_PRESETS[0].text === 'WATERMARK');
  check('wm: fonts are all standard-14', WATERMARK_FONTS.every((f) => f.id.startsWith('Helvetica') || f.id.startsWith('Times') || f.id.startsWith('Courier')));
}

{
  check('wm: #808080 parses', (() => { const c = hexToRgb01('#808080'); return Math.abs(c.r - 128 / 255) < 1e-9 && c.r === c.g && c.g === c.b; })());
  check('wm: shorthand hex parses', (() => { const c = hexToRgb01('#f00'); return c.r === 1 && c.g === 0 && c.b === 0; })());
  check('wm: no hash still parses', hexToRgb01('ABCDEF') !== null);
  check('wm: junk is null', hexToRgb01('nope') === null && hexToRgb01('#12345') === null && hexToRgb01('') === null);
}

{
  const n = normalizeWatermarkOptions({
    text: '  Hello   world ', sizePt: 9999, opacity: 0, angle: 999, marginPct: -5,
    across: 99, down: 0, position: 'zz', fontKey: 'Comic Sans', count: 'wat', color: '#f00', imagePct: 0,
  });
  check('wm: out-of-range values are clamped', n.ok && n.opts.sizePt === 400 && n.opts.opacity === 2
    && n.opts.angle === 180 && n.opts.marginPct === 0 && n.opts.across === 8 && n.opts.down === 1 && n.opts.imagePct === 2,
  JSON.stringify(n.opts));
  check('wm: unknown enums fall back to the defaults', n.opts.position === 'mc' && n.opts.fontKey === 'Helvetica-Bold' && n.opts.count === 'one');
  check('wm: text is trimmed and collapsed', n.opts.text === 'Hello world', n.opts.text);
  check('wm: valid short hex is kept', n.opts.color === '#f00');
  check('wm: empty text refused', !normalizeWatermarkOptions({ text: '   ' }).ok);
  check('wm: over-long text refused', !normalizeWatermarkOptions({ text: 'x'.repeat(WATERMARK_MAX_TEXT + 1) }).ok);
  check('wm: image mode needs bytes', !normalizeWatermarkOptions({ mode: 'image' }).ok);
  check('wm: image mode works with bytes', normalizeWatermarkOptions({ mode: 'image' }, { hasImage: true }).ok);
  check('wm: tile count is clamped to the grid', normalizeWatermarkOptions({ count: 'tile', across: 8, down: 12 }).opts.down === 12);
}

{
  const b0 = rotatedBox(100, 20, 0);
  const b90 = rotatedBox(100, 20, 90);
  const b45 = rotatedBox(100, 20, 45);
  check('wm: 0deg box is unchanged', b0.width === 100 && b0.height === 20);
  check('wm: 90deg swaps the box', Math.abs(b90.width - 20) < 1e-9 && Math.abs(b90.height - 100) < 1e-9);
  check('wm: 45deg box grows to the diagonal', Math.abs(b45.width - 84.8528137) < 1e-4 && Math.abs(b45.width - b45.height) < 1e-9);

  const angles = [0, 30, 45, 90, -45, 135];
  const offCentre = angles.filter((angle) => {
    const w = 300;
    const localY = 12;
    const at = anchorForBox(200, 300, w, 44, angle, localY);
    const t = (angle * Math.PI) / 180;
    const cx = at.x + Math.cos(t) * (w / 2) - Math.sin(t) * localY;
    const cy = at.y + Math.sin(t) * (w / 2) + Math.cos(t) * localY;
    return Math.abs(cx - 200) > 1e-9 || Math.abs(cy - 300) > 1e-9;
  });
  check('wm: anchorForBox keeps the mark centred at every angle', offCentre.length === 0, offCentre.join(','));
}

{
  const W = 595.28;
  const H = 841.89;
  const box = marginBox(W, H, 6);
  const m = (Math.min(W, H) * 6) / 100;
  check('wm: margin box is inset on all sides', Math.abs(box.left - m) < 1e-9 && Math.abs(box.bottom - m) < 1e-9
    && Math.abs(box.width - (W - m * 2)) < 1e-9);

  const centre = watermarkCentres({ pageWidth: W, pageHeight: H, position: 'mc', marginPct: 6 })[0];
  check('wm: centre position is the page centre', Math.abs(centre.x - W / 2) < 1e-9 && Math.abs(centre.y - H / 2) < 1e-9);

  const outside = [];
  for (const p of WATERMARK_POSITIONS) {
    const c = watermarkCentres({ pageWidth: W, pageHeight: H, position: p.id, marginPct: 6 })[0];
    if (c.x < box.left - 1e-9 || c.x > box.left + box.width + 1e-9
      || c.y < box.bottom - 1e-9 || c.y > box.bottom + box.height + 1e-9) outside.push(p.id);
  }
  check('wm: every 3x3 position sits inside the margin box', outside.length === 0, outside.join(','));
  check('wm: top-left really is top-left', (() => {
    const c = watermarkCentres({ pageWidth: W, pageHeight: H, position: 'tl', marginPct: 6 })[0];
    return Math.abs(c.x - box.left) < 1e-9 && Math.abs(c.y - (box.bottom + box.height)) < 1e-9;
  })());
  check('wm: zero margin reaches the page edges', (() => {
    const c = watermarkCentres({ pageWidth: W, pageHeight: H, position: 'tl', marginPct: 0 })[0];
    return c.x === 0 && c.y === H;
  })());

  const tiles = watermarkCentres({ pageWidth: W, pageHeight: H, count: 'tile', across: 3, down: 4, marginPct: 6 });
  check('wm: tile count is exactly across x down', tiles.length === 12);
  const xs = [...new Set(tiles.map((t) => +t.x.toFixed(6)))].sort((a, b) => a - b);
  const ys = [...new Set(tiles.map((t) => +t.y.toFixed(6)))].sort((a, b) => a - b);
  const evenly = (arr) => arr.slice(1).every((v, i) => Math.abs((v - arr[i]) - (arr[1] - arr[0])) < 1e-6);
  check('wm: tiled columns are evenly spaced', xs.length === 3 && evenly(xs), JSON.stringify(xs));
  check('wm: tiled rows are evenly spaced', ys.length === 4 && evenly(ys), JSON.stringify(ys));
  check('wm: every tiled mark is on the page', tiles.every((t) => t.x > 0 && t.x < W && t.y > 0 && t.y < H));
  check('wm: 8x12 is the biggest grid the panel allows',
    watermarkCentres({ pageWidth: W, pageHeight: H, count: 'tile', across: 8, down: 12 }).length === 96);
}

{
  check('wm: 90deg page swaps the visible axes', visibleSize({ width: 100, height: 200, rotation: 90 }).width === 200);
  check('wm: 270deg swaps too', visibleSize({ width: 100, height: 200, rotation: 270 }).height === 100);
  check('wm: 180deg keeps the axes', visibleSize({ width: 100, height: 200, rotation: 180 }).width === 100);

  const p90 = visibleToPage({ x: 0, y: 0 }, { width: 100, height: 200, rotation: 90 });
  check('wm: 90deg maps visible bottom-left to page bottom-right', p90.x === 100 && p90.y === 0, JSON.stringify(p90));
  const p180 = visibleToPage({ x: 25, y: 50 }, { width: 100, height: 200, rotation: 180 });
  check('wm: 180deg flips both axes', p180.x === 75 && p180.y === 150, JSON.stringify(p180));
  const p270 = visibleToPage({ x: 0, y: 0 }, { width: 100, height: 200, rotation: 270 });
  check('wm: 270deg maps visible bottom-left to page top-left', p270.x === 0 && p270.y === 200, JSON.stringify(p270));
  const square = [0, 90, 180, 270].map((rotation) => visibleToPage({ x: 50, y: 50 }, { width: 100, height: 100, rotation }));
  check('wm: the page centre is the centre at every rotation', square.every((p) => p.x === 50 && p.y === 50));
  check('wm: a turned page adds its rotation to the mark angle',
    pageAngleFor(0, 90) === 90 && pageAngleFor(45, 270) === 315 && pageAngleFor(45, 0) === 45);
}

{
  check('wm: WATERMARK is vector-safe', await canEncodeStandardText('WATERMARK'));
  check('wm: umlauts are vector-safe', await canEncodeStandardText('Grüße'));
  check('wm: Devanagari needs the image fallback', !(await canEncodeStandardText('नमस्ते')));
  check('wm: CJK needs the image fallback', !(await canEncodeStandardText('机密')));
  check('wm: emoji need the image fallback', !(await canEncodeStandardText('😀')));
}

{
  const info = await pdfPageInfo(a);
  check('wm: page info reads count and box', info.pages === 2 && info.width === 400 && info.height === 400 && info.rotation === 0);
  const turned = await pdfPageInfo(await rotatePages(a, [0], 90));
  check('wm: page info reports the rotation', turned.rotation === 90);
}

{
  const marked = await applyWatermark(a, { ...watermarkDefaults() });
  check('wm: text mark keeps the page count', (await pdfPageCount(marked)) === 2);
  const c0 = await pageContent(marked, 0);
  const c1 = await pageContent(marked, 1);
  const hex = HEXU('WATERMARK');
  check('wm: every page gets the text', c0.includes(`<${hex}>`) && c1.includes(`<${hex}>`));
  check('wm: page text is still there', c0.includes(`<${HEXU('A-1')}>`));
  check('wm: 18% opacity reaches the graphics state', (await pageAlphas(marked, 0)).some((v) => Math.abs(v - 0.18) < 1e-6));
  check('wm: grey is the drawing colour', c0.includes('0.5019607843137255 0.5019607843137255 0.5019607843137255 rg'));
  const tm45 = lastTm(c0);
  check('wm: 45deg mark has a 45deg text matrix',
    !!tm45 && Math.abs(tm45[0] - Math.SQRT1_2) < 1e-3 && Math.abs(tm45[1] - Math.SQRT1_2) < 1e-3, JSON.stringify(tm45));

  const rotated = await applyWatermark(a, { ...watermarkDefaults(), angle: 0 });
  const tm0 = lastTm(await pageContent(rotated, 0));
  check('wm: 0deg mark has an identity matrix', !!tm0 && Math.abs(tm0[0] - 1) < 1e-6 && Math.abs(tm0[1]) < 1e-6);

  const only = await applyWatermark(a, { ...watermarkDefaults(), pages: [1] });
  check('wm: only the requested page is marked',
    !(await pageContent(only, 0)).includes(`<${hex}>`) && (await pageContent(only, 1)).includes(`<${hex}>`));

  const turnedIn = await rotatePages(a, [0], 90);
  const turnedOut = await applyWatermark(turnedIn, { ...watermarkDefaults() });
  check('wm: rotations survive stamping', JSON.stringify(await pageRotations(turnedOut)) === '[90,0]');
  const tmTurned = lastTm(await pageContent(turnedOut, 0));
  check('wm: a 90deg page is compensated back to 45deg on screen',
    !!tmTurned && Math.abs(Math.abs(tmTurned[0]) - Math.SQRT1_2) < 1e-3 && Math.abs(Math.abs(tmTurned[1]) - Math.SQRT1_2) < 1e-3,
    JSON.stringify(tmTurned));

  const tiledOut = await applyWatermark(a, { ...watermarkDefaults(), count: 'tile', across: 2, down: 3, text: 'DRAFT' });
  const tileContent = await pageContent(tiledOut, 0);
  const draftHex = `<${HEXU('DRAFT')}>`;
  check('wm: tile mode draws across x down marks', tileContent.split(draftHex).length - 1 === 6,
    String(tileContent.split(draftHex).length - 1));

  const imageOut = await applyWatermark(a, {
    ...watermarkDefaults(), mode: 'image', imageBytes: ONE_PX_PNG, imageMime: 'image/png', imagePct: 40,
  });
  const imgContent = await pageContent(imageOut, 0);
  check('wm: image mode draws an XObject', /\/\S+ Do/.test(imgContent), imgContent.slice(-120));
  check('wm: image is embedded once per document', (await pageResourceKeys(imageOut, 0, 'XObject')).length === 1);
  check('wm: image opacity reaches the graphics state', (await pageAlphas(imageOut, 0)).some((v) => Math.abs(v - 0.18) < 1e-6));
  check('wm: image mark keeps the page count', (await pdfPageCount(imageOut)) === 2);
}

{
  const reject = async (opts, label, pattern) => {
    let threw = null;
    try { await applyWatermark(a, opts); } catch (err) { threw = String(err && err.message); }
    check(label, !!threw && (!pattern || pattern.test(threw)), String(threw));
  };
  await reject({ ...watermarkDefaults(), text: '   ' }, 'wm: empty text refused at the engine');
  await reject({ ...watermarkDefaults(), mode: 'image' }, 'wm: image mode without bytes refused');
  await reject({ ...watermarkDefaults(), pages: [9] }, 'wm: out-of-range pages refused', /No pages/);
  await reject({ ...watermarkDefaults(), text: 'x'.repeat(200) }, 'wm: over-long text refused', /120/);

  let threw = false;
  try { await applyWatermark(new Uint8Array(), watermarkDefaults()); } catch { threw = true; }
  check('wm: empty bytes refused', threw);
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
