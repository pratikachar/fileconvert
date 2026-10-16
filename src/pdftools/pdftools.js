/**
 * PDF suite - pure logic + pdf-lib orchestration (no DOM), Node-testable.
 * pdf-lib runs anywhere (no DOM needed), so even merge/rotate round-trips
 * are verified in Node, not just in the browser.
 */
import { PDFDocument, degrees } from 'pdf-lib';

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

/** Test helper: build an n-page PDF with big page numbers (pure pdf-lib). */export async function blankPdf(pages, label = 'p') {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([400, 400]);
    page.drawText(`${label}-${i + 1}`, { x: 50, y: 200, size: 48 });
  }
  return doc.save();
}
