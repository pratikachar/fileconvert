/**
 * Node checks for the palette extractor (src/editors/palette.js).
 * Run: node scripts/test-palette.mjs
 */

import { rgbToHex, extractPalette } from '../src/editors/palette.js';

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}

function solid(w, h, r, g, b, a = 255) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = r; data[p * 4 + 1] = g; data[p * 4 + 2] = b; data[p * 4 + 3] = a;
  }
  return { data, width: w, height: h };
}

{
  check('hex: black', rgbToHex(0, 0, 0) === '#000000');
  check('hex: white', rgbToHex(255, 255, 255) === '#ffffff');
  check('hex: pads single digits', rgbToHex(1, 2, 3) === '#010203');
  check('hex: clamps out of range', rgbToHex(-5, 300, 128) === '#00ff80');
}

{
  // solid red buckets to f00 -> #ff0000 and owns 100%
  const pal = extractPalette(solid(40, 40, 255, 0, 0), 6);
  check('solid red: top color is #ff0000', pal[0] && pal[0].hex === '#ff0000', JSON.stringify(pal[0]));
  check('solid red: single entry, fraction 1', pal.length === 1 && pal[0].fraction === 1);
}

{
  // half red / half blue -> both reported, red first on ties? (order by count)
  const img = solid(40, 40, 255, 0, 0);
  for (let p = 800; p < 1600; p++) {
    img.data[p * 4] = 0; img.data[p * 4 + 1] = 0; img.data[p * 4 + 2] = 255;
  }
  const pal = extractPalette(img, 6);
  const hexes = pal.map((p) => p.hex);
  check('split: red and blue both found', hexes.includes('#ff0000') && hexes.includes('#0000ff'), hexes.join(','));
  check('split: fractions sum to 1', Math.abs(pal.reduce((a, p) => a + p.fraction, 0) - 1) < 1e-9);
}

{
  // transparency is not a color
  const pal = extractPalette(solid(20, 20, 0, 255, 0, 0), 6);
  check('transparent: no colors reported', pal.length === 0);
}

{
  // maxColors caps the list
  const img = solid(60, 10, 0, 0, 0);
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255]];
  colors.forEach(([r, g, b], i) => {
    for (let p = i * 120; p < (i + 1) * 120; p++) {
      img.data[p * 4] = r; img.data[p * 4 + 1] = g; img.data[p * 4 + 2] = b;
    }
  });
  const pal = extractPalette(img, 3);
  check('cap: at most maxColors entries', pal.length === 3, String(pal.length));
  check('cap: clamps absurd values to 1..12', extractPalette(img, 0).length >= 1 && extractPalette(img, 99).length <= 12);
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
