/**
 * Node checks for Magic Remove's DOM-free logic (src/editors/magicRemove.js).
 * The wasm inpaint itself needs a browser - scripts/ browser E2E covers that
 * with a quantitative gradient test. Run: node scripts/test-magic-remove.mjs
 */

import { maskToArray, maskCoverage, opencvSizeMB } from '../src/editors/magicRemove.js';

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}

{
  // maskToArray: any non-zero alpha becomes full 255 (OpenCV wants 0/255).
  const m = new Uint8ClampedArray(10);
  m[0] = 1;
  m[3] = 200;
  const a = maskToArray(m, 5, 2);
  check('mask: length = w*h', a.length === 10, String(a.length));
  check('mask: painted -> 255', a[0] === 255 && a[3] === 255);
  check('mask: unpainted -> 0', a[1] === 0 && a[2] === 0 && a[9] === 0);
  check('mask: value type is byte array', a instanceof Uint8Array);
}

{
  // Coverage drives the "that is a lot, expect smearing" warning.
  check('coverage: empty mask is 0', maskCoverage(new Uint8ClampedArray(100), 10, 10) === 0);
  const quarter = new Uint8ClampedArray(100);
  quarter.fill(255, 0, 25);
  check('coverage: 25/100 = 0.25', Math.abs(maskCoverage(quarter, 10, 10) - 0.25) < 1e-9);
  const full = new Uint8ClampedArray(100).fill(255);
  check('coverage: full mask = 1', maskCoverage(full, 10, 10) === 1);
  check('coverage: guards junk input', maskCoverage(null, 10, 10) === 0 && maskCoverage(quarter, 0, 10) === 0);
}

{
  // The UI quotes this number, so it must stay in the honest 10-12 MB range.
  const mb = opencvSizeMB();
  check('engine size quoted to the user is plausible', mb > 9 && mb < 13, mb + ' MB');
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}