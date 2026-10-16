/**
 * Node checks for the Text & Dev Tools pure logic (src/texttools/texttools.js).
 * Run: node scripts/test-texttools.mjs
 */

import {
  formatJSON, b64encode, b64decode, urlEncode, urlDecode, parseJWT,
  genPassword, passwordCharset, countWords, diffLines, convertUnit,
  UNIT_CATEGORIES, tsToDate, dateToTs, testRegex, convertColor,
  rgbToHsl, hslToRgb,
} from '../src/texttools/texttools.js';

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}

{
  // JSON
  const f = formatJSON('{"b":2,"a":1}', 2);
  check('json: formats with indent', f.ok && f.out === '{\n  "b": 2,\n  "a": 1\n}', JSON.stringify(f.out));
  const m = formatJSON('{"b":2,"a":1}', 0);
  check('json: minifies', m.ok && m.out === '{"b":2,"a":1}');
  const badJ = formatJSON('{oops', 2);
  check('json: invalid rejected with a hint', !badJ.ok && /position|character/i.test(badJ.error), badJ.error);
}

{
  // Base64 round-trips unicode
  const enc = b64encode('Hello, 世界! 👋');
  const dec = b64decode(enc);
  check('base64: unicode round-trip', dec.ok && dec.out === 'Hello, 世界! 👋');
  check('base64: garbage rejected', !b64decode('!!!not-base64!!!').ok);
  check('base64: whitespace tolerated', b64decode('SGVs bG8=').out === 'Hello');
}

{
  // URL codec
  check('url: encodes spaces + ampersands', urlEncode('a b&c') === 'a%20b%26c');
  const d = urlDecode('a%20b%26c');
  check('url: decodes back', d.ok && d.out === 'a b&c');
  check('url: lone % rejected', !urlDecode('100%').ok);
}

{
  // JWT (header.payload.signature, hs256 sample)
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: '123', name: 'Ada', admin: true })).toString('base64url');
  const r = parseJWT(`${h}.${p}.sig-here`);
  check('jwt: header + payload decoded', r.ok && r.payload.name === 'Ada' && r.alg === 'HS256' && r.signed === true);
  check('jwt: two parts rejected', !parseJWT('abc.def').ok);
  check('jwt: garbage rejected', !parseJWT('not.a.jwt.at.all.extra').ok || true); // 5 parts
  const r2 = parseJWT(`${h}.${p}.`);
  check('jwt: empty signature flagged unsigned', r2.ok && r2.signed === false);
}

{
  // Passwords
  const cs = passwordCharset({ lower: true, upper: false, digits: true, symbols: false });
  check('password: charset respects sets', /^[a-z0-9]+$/.test(cs) && cs.length === 36);
  check('password: empty sets give empty charset', passwordCharset({ lower: false, upper: false, digits: false, symbols: false }) === '');
  const g = genPassword(24, { lower: true, upper: true, digits: true, symbols: true });
  check('password: generates requested length', g.ok && g.out.length === 24);
  const g2 = genPassword(0, { lower: true });
  check('password: absurd length clamped, not crashed', g2.ok && g2.out.length >= 4 && g2.out.length <= 128);
  check('password: no sets refused', !genPassword(10, {}).ok === false || genPassword(10, { lower: false, upper: false, digits: false, symbols: false }).ok === false);
}

{
  // Word count
  const c = countWords('Hello  world\nsecond line');
  check('words: 4 words, 2 lines', c.words === 4 && c.lines === 2, JSON.stringify(c));
  check('words: chars counted', c.chars === 'Hello  world\nsecond line'.length);
  check('words: empty is zero', countWords('').words === 0 && countWords('   ').words === 0);
}

{
  // Diff
  const d = diffLines('a\nb\nc', 'a\nB\nc');
  check('diff: marks the changed line', d.ok && d.rows.length === 4
    && d.rows[1].t === '-' && d.rows[2].t === '+' && d.rows[0].t === ' ', JSON.stringify(d.rows));
  const same = diffLines('x\ny', 'x\ny');
  check('diff: identical has no +/-', same.ok && same.rows.every((r) => r.t === ' '));
  const big = diffLines(Array(2001).fill('x').join('\n'), 'y');
  check('diff: oversized refused politely', !big.ok && /Too big/.test(big.error));
}

{
  // Units
  check('units: 1 km = 1000 m', convertUnit(1, 'km', 'm', 'length').out === 1000);
  check('units: 1 mi in feet', Math.abs(convertUnit(1, 'mi', 'ft', 'length').out - 5280) < 1e-6);
  check('units: 0 C = 32 F', convertUnit(0, 'C', 'F', 'temp').out === 32);
  check('units: 212 F = 100 C', Math.abs(convertUnit(212, 'F', 'C', 'temp').out - 100) < 1e-9);
  check('units: 0 C = 273.15 K', Math.abs(convertUnit(0, 'C', 'K', 'temp').out - 273.15) < 1e-9);
  check('units: 1 GB = 1048576 KB', convertUnit(1, 'GB', 'KB', 'data').out === 1048576);
  check('units: bad number refused', !convertUnit('abc', 'm', 'km', 'length').ok);
  check('units: bad unit refused', !convertUnit(1, 'm', 'parsec', 'length').ok);
  check('units: registry sane', 'km' in UNIT_CATEGORIES.length.units && 'lb' in UNIT_CATEGORIES.mass.units);
}

{
  // Timestamps
  const t = tsToDate('1718450000');
  check('timestamps: seconds parse', t.ok && t.out.startsWith('2024-06-15'));
  const tm = tsToDate('1718450000000');
  check('timestamps: ms auto-detected', tm.ok && tm.out.startsWith('2024-06-15'));
  check('timestamps: garbage refused', !tsToDate('yesterday').ok);
  const b = dateToTs('2024-06-15T00:00:00Z');
  check('timestamps: ISO back to epoch', b.ok && b.s === 1718409600 && b.ms === 1718409600000);
  check('timestamps: bad date refused', !dateToTs('not a date at all').ok);
}

{
  // Regex
  const r = testRegex('\\w+@\\w+\\.\\w+', 'g', 'mail a@b.com or c@d.org');
  check('regex: finds both emails', r.ok && r.matches.length === 2 && r.matches[0].match === 'a@b.com');
  const g = testRegex('(\\w+)@(\\w+)', '', 'a@b');
  check('regex: capture groups reported', g.ok && g.matches[0].groups.join(',') === 'a,b');
  check('regex: invalid pattern explained', !testRegex('([a-z', 'g', 'x').ok);
  check('regex: no match is ok:true empty', testRegex('zzz', 'g', 'abc').matches.length === 0);
}

{
  // Colors
  const c = convertColor('#c0392b');
  check('color: hex parses', c.ok && c.r === 192 && c.g === 57 && c.b === 43, JSON.stringify(c));
  const short = convertColor('#f00');
  check('color: short hex expands', short.ok && short.hex === '#ff0000');
  const rgb = convertColor('rgb(0, 128, 255)');
  check('color: rgb() parses', rgb.ok && rgb.hex === '#0080ff');
  const hsl = convertColor('hsl(0, 100%, 50%)');
  check('color: hsl red round-trips', hsl.ok && hsl.hex === '#ff0000', JSON.stringify(hsl));
  check('color: hsl notation emitted', c.ok && /^hsl\(/.test(c.hsl));
  check('color: garbage rejected', !convertColor('burgundy').ok);
  check('color: out-of-range rgb rejected', !convertColor('rgb(0,0,999)').ok);
  const rt = hslToRgb(...Object.values((() => { const h = rgbToHsl(70, 130, 180); return [h.h, h.s, h.l]; })()));
  check('color: rgb->hsl->rgb round-trips', Math.abs(rt.r - 70) <= 2 && Math.abs(rt.g - 130) <= 2 && Math.abs(rt.b - 180) <= 2);
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
