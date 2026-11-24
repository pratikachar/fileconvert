/**
 * PDF suite - pure logic + pdf-lib orchestration (no DOM), Node-testable.
 * pdf-lib runs anywhere (no DOM needed), so even merge/rotate round-trips
 * are verified in Node, not just in the browser.
 *
 * Watermarks live here too: the placement maths, the presets and the drawing
 * loop are DOM-free, so a 3-page round-trip is checked with real bytes in Node.
 * Canvas work (image downscaling, lettering for non-Latin text) stays in
 * pdfTab.js; this module only ever receives finished PNG/JPEG bytes.
 */
import { PDFDocument, degrees, rgb } from 'pdf-lib';

export const MAX_SPLIT_PAGES = 20;

/**
 * Parse a page spec like "1-3, 5, 8-6?" (no - reversed ranges are an error).
 * Pages are 1-based for humans; returns 0-based indices.
 * "all" / "" with a known pageCount means every page.
 */
export function parsePageSpec(spec, pageCount) {
  const s = String(spec || '').trim().toLowerCase();
  if (s === '' || s === 'all') {
    if (!pageCount || pageCount < 1) return { ok: false, error: 'Load a PDF first.' };
    return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i) };
  }
  const pages = [];
  for (const part of s.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a > b) return { ok: false, error: `"${p}" runs backwards - ranges go low-high (e.g. 2-5).` };
      for (let i = a; i <= b; i++) pages.push(i);
    } else if (/^\d+$/.test(p)) {
      pages.push(+p);
    } else {
      return { ok: false, error: `"${p}" is not a page or range (try 1-3,5).` };
    }
  }
  const unique = [...new Set(pages)];
  if (!unique.length) return { ok: false, error: 'No pages selected.' };
  if (pageCount) {
    const bad = unique.find((n) => n < 1 || n > pageCount);
    if (bad !== undefined) return { ok: false, error: `Page ${bad} does not exist (this file has ${pageCount}).` };
  }
  return { ok: true, pages: unique.map((n) => n - 1) };
}

/** Load a PDF from bytes and report its page count (throws on garbage). */
export async function pdfPageCount(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

/** Merge several PDFs (Uint8Array list) into one PDF's bytes. */
export async function mergePdfs(buffers) {
  if (!buffers.length) throw new Error('Nothing to merge.');
  const out = await PDFDocument.create();
  for (const bytes of buffers) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/** Extract the given 0-based pages into a new PDF. */
export async function extractPages(bytes, pages) {
  if (!pages.length) throw new Error('No pages selected.');
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

/** Rotate the given 0-based pages by 90/180/270 degrees. */
export async function rotatePages(bytes, pages, angle = 90) {
  if (![90, 180, 270].includes(angle)) throw new Error('Angle must be 90, 180 or 270.');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  for (const i of pages) {
    const page = doc.getPage(i);
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  }
  return doc.save();
}

/**
 * Images (PNG/JPEG bytes + mime) into one PDF.
 * mode 'fit' keeps each photo's own size; 'a4' centers it on an A4 sheet.
 */
export async function imagesToPdf(images, mode = 'fit') {
  if (!images.length) throw new Error('Add at least one image.');
  const out = await PDFDocument.create();
  for (const { bytes, mime } of images) {
    const img = mime === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    if (mode === 'a4') {
      const page = out.addPage([595.28, 841.89]); // A4 in points
      const sc = Math.min(595.28 / img.width, 841.89 / img.height);
      const w = img.width * sc, h = img.height * sc;
      page.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h });
    } else {
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
  }
  return out.save();
}

/** Read back every page's rotation (verifies rotatePages end to end). */
export async function pageRotations(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPages().map((p) => p.getRotation().angle);
}

/** Test helper: build an n-page PDF with big page numbers (pure pdf-lib). */
export async function blankPdf(pages, label = 'p', size = [400, 400]) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    page.drawText(`${label}${label ? `-${i + 1}` : ''}`, { x: 50, y: 200, size: 48 });
  }
  return doc.save();
}

/* ============================================================
 * Watermarks
 * ============================================================ */

/** The 3x3 position grid, in VISIBLE page space (0..1, y up). */
export const WATERMARK_POSITIONS = [
  { id: 'tl', label: '↖', name: 'top left', x: 0, y: 1 },
  { id: 'tc', label: '↑', name: 'top', x: 0.5, y: 1 },
  { id: 'tr', label: '↗', name: 'top right', x: 1, y: 1 },
  { id: 'ml', label: '←', name: 'left', x: 0, y: 0.5 },
  { id: 'mc', label: '•', name: 'centre', x: 0.5, y: 0.5 },
  { id: 'mr', label: '→', name: 'right', x: 1, y: 0.5 },
  { id: 'bl', label: '↙', name: 'bottom left', x: 0, y: 0 },
  { id: 'bc', label: '↓', name: 'bottom', x: 0.5, y: 0 },
  { id: 'br', label: '↘', name: 'bottom right', x: 1, y: 0 },
];

/** Standard-14 fonts only (no fontkit), so every mark stays vector. */
export const WATERMARK_FONTS = [
  { id: 'Helvetica-Bold', label: 'Bold sans', family: 'Helvetica, Arial, sans-serif', weight: 700 },
  { id: 'Helvetica', label: 'Sans', family: 'Helvetica, Arial, sans-serif', weight: 400 },
  { id: 'Times-Bold', label: 'Bold serif', family: 'Times, "Times New Roman", serif', weight: 700 },
  { id: 'Times-Roman', label: 'Serif', family: 'Times, "Times New Roman", serif', weight: 400 },
  { id: 'Courier-Bold', label: 'Bold typewriter', family: '"Courier New", Courier, monospace', weight: 700 },
];

/**
 * The recommended look the panel opens with: a grey 45° "WATERMARK" across
 * the middle of the page at 18% - visible in print, still readable underneath.
 */
export function watermarkDefaults() {
  return {
    mode: 'text',
    text: 'WATERMARK',
    fontKey: 'Helvetica-Bold',
    sizePt: 48,
    color: '#808080',
    imagePct: 35,
    opacity: 18,
    angle: 45,
    marginPct: 6,
    count: 'one',
    position: 'mc',
    across: 3,
    down: 4,
  };
}

/** Quick text fills for the preset chips (the look itself stays customisable). */
export const WATERMARK_PRESETS = [
  { id: 'recommended', label: 'Recommended', text: 'WATERMARK' },
  { id: 'confidential', label: 'Confidential', text: 'CONFIDENTIAL' },
  { id: 'draft', label: 'Draft', text: 'DRAFT' },
  { id: 'donotcopy', label: 'Do not copy', text: 'DO NOT COPY' },
];

export const WATERMARK_MAX_TEXT = 120;

const clampNum = (n, lo, hi, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
};

/** "#808080" / "f00" -> {r,g,b} in 0..1, or null when it is not a colour. */
export function hexToRgb01(hex) {
  let s = String(hex == null ? '' : hex).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16) / 255,
    g: parseInt(s.slice(2, 4), 16) / 255,
    b: parseInt(s.slice(4, 6), 16) / 255,
  };
}

/**
 * Validate + clamp raw panel values into the shape the engine draws.
 * Returns { ok, opts } or { ok: false, error } - never throws, so the panel
 * can show a friendly message instead of a stack trace.
 */
export function normalizeWatermarkOptions(input = {}, { hasImage = false } = {}) {
  const d = watermarkDefaults();
  const src = input || {};
  const mode = src.mode === 'image' ? 'image' : 'text';
  const text = String(src.text == null ? d.text : src.text).replace(/\s+/g, ' ').trim();

  if (mode === 'text' && !text) return { ok: false, error: 'Type the watermark text, or switch to Image.' };
  if (text.length > WATERMARK_MAX_TEXT) return { ok: false, error: `Keep the watermark under ${WATERMARK_MAX_TEXT} characters.` };
  if (mode === 'image' && !hasImage) return { ok: false, error: 'Choose a watermark image first (PNG, JPG or WEBP).' };

  const opts = {
    mode,
    text,
    fontKey: WATERMARK_FONTS.some((f) => f.id === src.fontKey) ? src.fontKey : d.fontKey,
    sizePt: clampNum(src.sizePt, 4, 400, d.sizePt),
    color: hexToRgb01(src.color) ? String(src.color).trim() : d.color,
    imagePct: clampNum(src.imagePct, 2, 100, d.imagePct),
    opacity: clampNum(src.opacity, 2, 100, d.opacity),
    angle: clampNum(src.angle, -180, 180, d.angle),
    marginPct: clampNum(src.marginPct, 0, 40, d.marginPct),
    count: src.count === 'tile' ? 'tile' : 'one',
    position: WATERMARK_POSITIONS.some((p) => p.id === src.position) ? src.position : d.position,
    across: Math.round(clampNum(src.across, 1, 8, d.across)),
    down: Math.round(clampNum(src.down, 1, 12, d.down)),
  };
  return { ok: true, opts };
}

/** Size of the axis-aligned box around a w x h mark turned by `angleDeg`. */
export function rotatedBox(width, height, angleDeg = 0) {
  const t = (Math.abs(Number(angleDeg) || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return { width: width * c + height * s, height: width * s + height * c };
}

/**
 * Where to put the draw origin so a mark's own box ends up centred on a point.
 *
 * PDF drawing rotates about the origin it is given, so centring a rotated mark
 * means working backwards: rotate the box centre, then subtract it. `localCentreY`
 * is the box centre above the origin - half the height for images, and
 * (ascent - descent) / 2 for text, whose origin sits on the baseline.
 */
export function anchorForBox(centreX, centreY, width, height, angleDeg = 0, localCentreY = height / 2) {
  const t = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const dx = width / 2;
  const dy = localCentreY;
  return { x: centreX - (c * dx - s * dy), y: centreY - (s * dx + c * dy) };
}

/** Text metrics relative to the baseline, used for exact vertical centring. */
export function textBoxMetrics(font, size) {
  const ascent = font.heightAtSize(size, { descender: false });
  const height = font.heightAtSize(size);
  return { ascent, descent: Math.max(0, height - ascent), height };
}

/** The page area marks are laid out in (inset by `marginPct` of the short side). */
export function marginBox(pageWidth, pageHeight, marginPct = 6) {
  const m = (Math.min(pageWidth, pageHeight) * clampNum(marginPct, 0, 40, 6)) / 100;
  return { left: m, bottom: m, width: Math.max(1, pageWidth - m * 2), height: Math.max(1, pageHeight - m * 2) };
}

/**
 * Centre points for a page: one at the chosen 3x3 position, or an exact
 * rows x columns grid with one mark centred in every cell. Space is measured in
 * VISIBLE page coordinates, so the choice looks the same on a rotated page.
 */
export function watermarkCentres({
  pageWidth, pageHeight, count = 'one', position = 'mc', marginPct = 6, across = 3, down = 4,
} = {}) {
  const box = marginBox(pageWidth, pageHeight, marginPct);
  if (count === 'tile') {
    const cols = Math.max(1, Math.round(Number(across) || 1));
    const rows = Math.max(1, Math.round(Number(down) || 1));
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({
          x: box.left + box.width * ((c + 0.5) / cols),
          y: box.bottom + box.height * ((r + 0.5) / rows),
        });
      }
    }
    return out;
  }
  const p = WATERMARK_POSITIONS.find((q) => q.id === position) || WATERMARK_POSITIONS[4];
  return [{ x: box.left + box.width * p.x, y: box.bottom + box.height * p.y }];
}

/** Width/height of the page as the reader shows it (90/270 swap the axes). */
export function visibleSize({ width, height, rotation = 0 } = {}) {
  const r = (((Number(rotation) || 0) % 360) + 360) % 360;
  return r === 90 || r === 270 ? { width: height, height: width } : { width, height };
}

/** Turn a point on the VISIBLE page back into page-stream coordinates. */
export function visibleToPage(point, { width, height, rotation = 0 } = {}) {
  const r = (((Number(rotation) || 0) % 360) + 360) % 360;
  if (r === 90) return { x: width - point.y, y: point.x };
  if (r === 180) return { x: width - point.x, y: height - point.y };
  if (r === 270) return { x: point.y, y: height - point.x };
  return { x: point.x, y: point.y };
}

/** A page turned by `rotation` needs the mark turned the other way to look straight. */
export function pageAngleFor(angleDeg, rotation = 0) {
  const r = (((Number(rotation) || 0) % 360) + 360) % 360;
  return (Number(angleDeg) || 0) + r;
}

/**
 * Can this text be drawn as a standard-font glyph? WinAnsi covers Latin-1-ish
 * only, so Devanagari/CJK/emoji answer false and the tab renders them to a PNG.
 */
export async function canEncodeStandardText(text, fontKey = 'Helvetica-Bold') {
  const key = WATERMARK_FONTS.some((f) => f.id === fontKey) ? fontKey : 'Helvetica-Bold';
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(key);
  try {
    font.encodeText(String(text));
    return true;
  } catch {
    return false;
  }
}

/** Page count + the first page's box and rotation (warms the panel preview). */
export async function pdfPageInfo(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPageCount();
  if (!pages) return { pages: 0, width: 595.28, height: 841.89, rotation: 0 };
  const first = doc.getPage(0);
  const { width, height } = first.getSize();
  const rotation = (((first.getRotation().angle % 360) + 360) % 360);
  return { pages, width, height, rotation };
}

/**
 * Stamp a watermark onto every selected page.
 *
 * Text is drawn as real glyphs (crisp at any zoom, ~1 KB per page). Images are
 * embedded once and re-used, so a 40-page logo watermark does not multiply the
 * file size. Placement runs in visible-page space and is mapped back through
 * the page's own /Rotate, so a page the app already rotated still reads the
 * same way on screen.
 */
export async function applyWatermark(pdfBytes, options = {}, { onProgress = () => {} } = {}) {
  if (!pdfBytes || !pdfBytes.length) throw new Error('No PDF loaded.');
  const hasImage = !!(options.imageBytes && options.imageBytes.length);
  const norm = normalizeWatermarkOptions(options, { hasImage });
  if (!norm.ok) throw new Error(norm.error);
  const o = norm.opts;

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const everyPage = doc.getPageIndices();
  const wanted = Array.isArray(options.pages) && options.pages.length
    ? [...new Set(options.pages)].filter((i) => Number.isInteger(i) && i >= 0 && i < everyPage.length)
    : everyPage;
  if (!wanted.length) throw new Error('No pages to mark.');

  const font = o.mode === 'text' ? await doc.embedFont(o.fontKey) : null;
  const rgb01 = hexToRgb01(o.color) || { r: 0.5, g: 0.5, b: 0.5 };
  const color = rgb(rgb01.r, rgb01.g, rgb01.b);
  const img = o.mode === 'image'
    ? (options.imageMime === 'image/jpeg' ? await doc.embedJpg(options.imageBytes) : await doc.embedPng(options.imageBytes))
    : null;
  const alpha = o.opacity / 100;

  for (let k = 0; k < wanted.length; k++) {
    const page = doc.getPage(wanted[k]);
    const size = page.getSize();
    const rotation = (((page.getRotation().angle % 360) + 360) % 360);
    const vis = visibleSize({ width: size.width, height: size.height, rotation });

    let markW;
    let markH;
    let localCentreY;
    if (o.mode === 'text') {
      markW = font.widthOfTextAtSize(o.text, o.sizePt);
      const m = textBoxMetrics(font, o.sizePt);
      markH = m.height;
      localCentreY = (m.ascent - m.descent) / 2;
    } else {
      markW = (vis.width * o.imagePct) / 100;
      markH = img.width ? markW * (img.height / img.width) : markW;
      localCentreY = markH / 2;
    }

    const angle = pageAngleFor(o.angle, rotation);
    const centres = watermarkCentres({
      pageWidth: vis.width,
      pageHeight: vis.height,
      count: o.count,
      position: o.position,
      marginPct: o.marginPct,
      across: o.across,
      down: o.down,
    });

    for (const centre of centres) {
      const p = visibleToPage(centre, { width: size.width, height: size.height, rotation });
      const at = anchorForBox(p.x, p.y, markW, markH, angle, localCentreY);
      if (o.mode === 'text') {
        page.drawText(o.text, {
          x: at.x, y: at.y, size: o.sizePt, font, color, opacity: alpha, rotate: degrees(angle),
        });
      } else {
        page.drawImage(img, {
          x: at.x, y: at.y, width: markW, height: markH, opacity: alpha, rotate: degrees(angle),
        });
      }
    }

    // Let the tab paint progress on a long document instead of freezing.
    if ((k + 1) % 8 === 0 || k === wanted.length - 1) {
      onProgress(k + 1, wanted.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return doc.save();
}
