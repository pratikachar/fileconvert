/**
 * Generate PWA icons as real PNGs (Chrome installability requires 192px and
 * 512px PNGs - SVG alone never fires beforeinstallprompt).
 * Pure Node (zlib built in): dark rounded square + lightning bolt, no fonts.
 * Run once: node scripts/gen-icons.mjs (outputs are committed - they are tiny).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

// CRC32 table (PNG chunks need it)
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, Buffer.from(data)])));
  return Buffer.concat([len, t, Buffer.from(data), crc]);
}

/** Point-in-polygon for the bolt shape. */
function inBolt(x, y, s) {
  // lightning polygon in unit space, y down
  const poly = [[0.55, 0.08], [0.30, 0.55], [0.47, 0.55], [0.42, 0.92], [0.70, 0.44], [0.53, 0.44]];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function roundedMask(x, y, s, r) {
  // inside a rounded rect inset by margin? full-bleed for maskable, rounded for any
  return true;
}

function render(size, { rounded = true, bg = [16, 14, 26], bolt = [167, 139, 250] } = {}) {
  // Supersample 4x then box-downscale: hard binary alpha on curves looks
  // blurred/pixelated when the OS scales the splash screen, so edges are
  // anti-aliased here instead.
  const SS = 4;
  const big = size * SS;
  const field = new Float32Array(big * big * 4);
  const r = rounded ? big * 0.225 : 0;
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      let alpha = 1;
      if (rounded) {
        const cx = Math.min(x + 0.5, big - 0.5 - x), cy = Math.min(y + 0.5, big - 0.5 - y);
        const dx = r - cx, dy = r - cy;
        if (dx > 0 && dy > 0) {
          const d = Math.sqrt(dx * dx + dy * dy);
          alpha = Math.max(0, Math.min(1, r + 0.5 - d));
        }
      }
      const t = y / (big - 1);
      let R = bg[0] + (30 - bg[0]) * (1 - t) * 0.35;
      let G = bg[1] + (27 - bg[1]) * (1 - t) * 0.35;
      let B = bg[2] + (48 - bg[2]) * (1 - t) * 0.35;
      if (alpha > 0 && inBolt((x + 0.5) / big, (y + 0.5) / big, big)) { R = bolt[0]; G = bolt[1]; B = bolt[2]; }
      const o = (y * big + x) * 4;
      field[o] = R; field[o + 1] = G; field[o + 2] = B; field[o + 3] = alpha;
    }
  }
  const raw = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let R = 0, G = 0, B = 0, A = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = (((y * SS + dy) * big) + (x * SS + dx)) * 4;
          R += field[o]; G += field[o + 1]; B += field[o + 2]; A += field[o + 3];
        }
      }
      const o = (y * size + x) * 4;
      raw[o] = Math.round(R / 16); raw[o + 1] = Math.round(G / 16);
      raw[o + 2] = Math.round(B / 16); raw[o + 3] = Math.round((A / 16) * 255);
    }
  }
  // PNG: signature + IHDR + IDAT (zlib of filtered scanlines) + IEND
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const lines = [];
  for (let y = 0; y < size; y++) {
    lines.push(0); // filter type 0 (none)
    lines.push(...raw.subarray(y * size * 4, (y + 1) * size * 4));
  }
  const idat = deflateSync(Buffer.from(lines), { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const jobs = [
  ['icon-192.png', 192, { rounded: true }],
  ['icon-512.png', 512, { rounded: true }],
  ['icon-maskable-192.png', 192, { rounded: false }],
  ['icon-maskable-512.png', 512, { rounded: false }],
];
for (const [name, size, opts] of jobs) {
  const buf = render(size, opts);
  writeFileSync(resolve(outDir, name), buf);
  console.log(`${name} (${(buf.length / 1024).toFixed(1)} KB)`);
}
