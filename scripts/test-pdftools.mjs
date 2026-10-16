/**
 * Node checks for the PDF suite (src/pdftools/pdftools.js).
 * pdf-lib runs in Node, so merge/extract/rotate/images round-trips are
 * verified here with real bytes - the browser E2E only re-checks wiring.
 * Run: node scripts/test-pdftools.mjs
 */

import {
  parsePageSpec, pdfPageCount, mergePdfs, extractPages, rotatePages,
  imagesToPdf, blankPdf, pageRotations, MAX_SPLIT_PAGES,
} from '../src/pdftools/pdftools.js';
import { PDF_TOOLS } from '../src/pdftools/pdfTab.js';
import { PDFDocument } from 'pdf-lib';

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}

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
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
