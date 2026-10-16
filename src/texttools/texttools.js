/**
 * Text & Dev Tools - pure logic (no DOM), so it is Node-testable.
 * Everything runs locally; nothing is uploaded anywhere.
 */

/* ---------------- JSON ---------------- */

/** Pretty-print (or minify) JSON. Returns { ok, out } or { ok: false, error }. */
export function formatJSON(text, indent = 2) {
  try {
    const v = JSON.parse(String(text));
    const out = indent === 0 ? JSON.stringify(v) : JSON.stringify(v, null, Math.max(1, Math.min(8, indent)));
    return { ok: true, out };
  } catch (err) {
    return { ok: false, error: jsonErrorHint(String((err && err.message) || err)) };
  }
}

/** Turn V8's terse "Unexpected token" into something that points at the spot. */
export function jsonErrorHint(msg) {
  const m = msg.match(/position (\d+)/);
  if (m) return `${msg} (around character ${m[1]})`;
  return msg;
}

/* ---------------- Base64 (unicode-safe) ---------------- */

export function b64encode(text) {
  const bytes = new TextEncoder().encode(String(text));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64decode(b64) {
  const clean = String(b64).trim().replace(/\s+/g, '');
  try {
    const bin = atob(clean);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { ok: true, out: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: 'Not valid Base64 (or not valid UTF-8 text).' };
  }
}

/* ---------------- URL encoding ---------------- */

export function urlEncode(text) {
  return encodeURIComponent(String(text));
}

export function urlDecode(text) {
  try {
    return { ok: true, out: decodeURIComponent(String(text)) };
  } catch {
    return { ok: false, error: 'Not valid percent-encoding (lone % or bad UTF-8).' };
  }
}

/* ---------------- JWT (decode only, no verification) ---------------- */

function b64urlToUtf8(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return b64decode(padded);
}

/**
 * Decode a JWT's header + payload. Never verifies the signature - that needs
 * the secret, which we deliberately never ask for.
 */
export function parseJWT(token) {
  const parts = String(token).trim().split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) {
    return { ok: false, error: 'A JWT looks like header.payload.signature (three dot-separated parts).' };
  }
  const h = b64urlToUtf8(parts[0]);
  const p = b64urlToUtf8(parts[1]);
  if (!h.ok) return { ok: false, error: 'Header is not valid Base64URL JSON.' };
  if (!p.ok) return { ok: false, error: 'Payload is not valid Base64URL JSON.' };
  let header, payload;
  try {
    header = JSON.parse(h.out);
    payload = JSON.parse(p.out);
  } catch {
    return { ok: false, error: 'Header/payload decoded but are not JSON.' };
  }
  return { ok: true, header, payload, alg: header.alg || '(missing)', signed: parts[2].length > 0 };
}

/* ---------------- Password generator ---------------- */

export const PW_SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?',
};

/** Charset for the enabled sets (pure - the randomness itself is not testable). */
export function passwordCharset({ lower = true, upper = true, digits = true, symbols = false } = {}) {
  let s = '';
  if (lower) s += PW_SETS.lower;
  if (upper) s += PW_SETS.upper;
  if (digits) s += PW_SETS.digits;
  if (symbols) s += PW_SETS.symbols;
  return s;
}

export function genPassword(length = 20, opts = {}) {
  const set = passwordCharset(opts);
  if (!set) return { ok: false, error: 'Enable at least one character set.' };
  const n = Math.max(4, Math.min(128, Math.floor(length) || 20));
  const rnd = new Uint32Array(n);
  (globalThis.crypto || window.crypto).getRandomValues(rnd);
  let out = '';
  for (let i = 0; i < n; i++) out += set[rnd[i] % set.length];
  return { ok: true, out };
}

/* ---------------- Word count ---------------- */

export function countWords(text) {
  const s = String(text);
  const chars = s.length;
  const charsNoSpaces = s.replace(/\s/g, '').length;
  const words = (s.trim().match(/\S+/g) || []).length;
  const lines = s ? s.split('\n').length : 0;
  return { chars, charsNoSpaces, words, lines, minutes: Math.max(1, Math.ceil(words / 200)) };
}

/* ---------------- Line diff (LCS, capped) ---------------- */

export const DIFF_MAX_LINES = 2000;

/**
 * Line-based diff via LCS dynamic programming. Returns
 * { ok, rows: [{ t: ' ' | '-' | '+', text }] } or { ok: false, error } when
 * the inputs are too big for the O(n*m) table.
 */
export function diffLines(a, b) {
  const A = String(a).split('\n');
  const B = String(b).split('\n');
  if (A.length > DIFF_MAX_LINES || B.length > DIFF_MAX_LINES) {
    return { ok: false, error: `Too big for an in-browser diff (limit ${DIFF_MAX_LINES} lines per side).` };
  }
  const n = A.length, m = B.length;
  // lengths table, rolling two rows to stay small
  let prev = new Uint32Array(m + 1);
  let curr = new Uint32Array(m + 1);
  const trace = [];
  for (let i = 1; i <= n; i++) {
    trace.push(Uint32Array.from(prev));
    for (let j = 1; j <= m; j++) {
      curr[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  trace.push(Uint32Array.from(prev));
  const rows = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) { rows.push({ t: ' ', text: A[i - 1] }); i--; j--; }
    else if (j > 0 && (i === 0 || trace[i][j - 1] >= trace[i - 1][j])) { rows.push({ t: '+', text: B[j - 1] }); j--; }
    else { rows.push({ t: '-', text: A[i - 1] }); i--; }
  }
  rows.reverse();
  return { ok: true, rows };
}

/* ---------------- Unit conversion ---------------- */

export const UNIT_CATEGORIES = {
  length: {
    label: 'Length (base: metre)',
    units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  },
  mass: {
    label: 'Mass (base: kilogram)',
    units: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237 },
  },
  data: {
    label: 'Data (base: byte, 1024 steps)',
    units: { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 },
  },
  temp: { label: 'Temperature', units: { C: 'c', F: 'f', K: 'k' } },
};

export function convertUnit(value, from, to, category) {
  const v = Number(value);
  if (!Number.isFinite(v)) return { ok: false, error: 'Enter a number first.' };
  const cat = UNIT_CATEGORIES[category];
  if (!cat || !(from in cat.units) || !(to in cat.units)) return { ok: false, error: 'Unknown unit.' };
  if (category === 'temp') return { ok: true, out: convertTemp(v, from, to) };
  return { ok: true, out: (v * cat.units[from]) / cat.units[to] };
}

function toCelsius(v, u) {
  if (u === 'C') return v;
  if (u === 'F') return ((v - 32) * 5) / 9;
  return v - 273.15;
}

function convertTemp(v, from, to) {
  const c = toCelsius(v, from);
  if (to === 'C') return c;
  if (to === 'F') return (c * 9) / 5 + 32;
  return c + 273.15;
}

/* ---------------- Timestamps ---------------- */

/** Seconds or milliseconds since epoch -> ISO string (auto-detects by magnitude). */
export function tsToDate(ts) {
  const n = Number(String(ts).trim());
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a Unix timestamp (seconds or milliseconds).' };
  const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'That timestamp is out of range.' };
  return { ok: true, out: d.toISOString(), local: d.toString() };
}

/** ISO / common date string -> { s, ms }. */
export function dateToTs(str) {
  const d = new Date(String(str).trim());
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'Could not parse that date (try 2026-05-01 or an ISO string).' };
  return { ok: true, s: Math.floor(d.getTime() / 1000), ms: d.getTime() };
}

/* ---------------- Regex tester ---------------- */

/** Find all matches (capped) with indices and capture groups. */
export function testRegex(pattern, flags, text) {
  let re;
  try {
    re = new RegExp(String(pattern), String(flags || '').replace(/[^gimsuy]/g, ''));
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  const src = String(text);
  const matches = [];
  if (re.global || re.sticky) {
    re.lastIndex = 0;
    let m;
    while (matches.length < 50 && (m = re.exec(src)) !== null) {
      matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
      if (m[0] === '') re.lastIndex++;
    }
  } else {
    const m = re.exec(src);
    if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
  }
  return { ok: true, matches };
}

/* ---------------- Color conversion ---------------- */

/** Accepts #rgb, #rrggbb, rgb(r,g,b). Returns { ok, r, g, b } or { ok:false }. */
export function parseColor(str) {
  const s = String(str).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) {
    const [r, g, b] = [...m[1]].map((c) => parseInt(c + c, 16));
    return { ok: true, r, g, b };
  }
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) {
    return {
      ok: true,
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
    };
  }
  m = s.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if ([r, g, b].every((v) => v >= 0 && v <= 255)) return { ok: true, r, g, b };
    return { ok: false, error: 'RGB channels run 0-255.' };
  }
  m = s.match(/^hsl\(\s*(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*\)$/);
  if (m) {
    const h = Number(m[1]), sat = Number(m[2]), li = Number(m[3]);
    if (h >= 0 && h <= 360 && sat >= 0 && sat <= 100 && li >= 0 && li <= 100) {
      return { ok: true, ...hslToRgb(h, sat, li) };
    }
    return { ok: false, error: 'HSL ranges: H 0-360, S/L 0-100%.' };
  }
  return { ok: false, error: 'Use #rgb, #rrggbb, rgb(r,g,b) or hsl(h,s%,l%).' };
}

export function rgbToHex(r, g, b) {
  const h = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: +(l * 100).toFixed(1) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: +((h * 360).toFixed(1)), s: +(s * 100).toFixed(1), l: +(l * 100).toFixed(1) };
}

export function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

/** One input color -> all three notations + swatch hex. */
export function convertColor(str) {
  const p = parseColor(str);
  if (!p.ok) return p;
  const hsl = rgbToHsl(p.r, p.g, p.b);
  return {
    ok: true,
    r: p.r, g: p.g, b: p.b,
    hex: rgbToHex(p.r, p.g, p.b),
    rgb: `rgb(${p.r}, ${p.g}, ${p.b})`,
    hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
  };
}
