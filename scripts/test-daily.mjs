/**
 * Node checks for the Daily tools pure logic (src/daily/daily.js).
 * Timers/clocks tick in the browser - covered by headless E2E.
 * Run: node scripts/test-daily.mjs
 */

import {
  formatHMS, monthGrid, MONTHS, worldClock, WORLD_CITIES,
  wmoText, geoUrl, forecastUrl,
} from '../src/daily/daily.js';

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ' :: ' + extra : ''}`);
}

{
  check('format: stopwatch style', formatHMS(61500) === '1:01.5', formatHMS(61500));
  check('format: zero', formatHMS(0) === '0:00.0');
  check('format: hour style', formatHMS(3723000) === '1:02:03', formatHMS(3723000));
  check('format: negative clamps', formatHMS(-500) === '0:00.0');
}

{
  // Feb 2024: leap year, 29 days, starts Thursday -> Monday-start offset 3
  const feb = monthGrid(2024, 1);
  check('calendar: leap feb has 29 days', feb.weeks.flat().filter(Boolean).length === 29);
  check('calendar: starts with 3 blanks (Thu)', JSON.stringify(feb.weeks[0].slice(0, 3)) === '[null,null,null]' && feb.weeks[0][3] === 1);
  check('calendar: 7 columns every row', feb.weeks.every((w) => w.length === 7));
  // Jan 2026: 31 days, starts Thursday as well
  const jan = monthGrid(2026, 0);
  check('calendar: jan26 has 31 days', jan.weeks.flat().filter(Boolean).length === 31);
  // June 2026: starts Monday -> no leading blanks
  const jun = monthGrid(2026, 5);
  check('calendar: monday-start month has no blanks first', jun.weeks[0][0] === 1, JSON.stringify(jun.weeks[0]));
  check('months: 12 names', MONTHS.length === 12 && MONTHS[0] === 'January');
}

{
  const rows = worldClock(new Date('2026-06-15T12:00:00Z'));
  check('clock: local + 6 cities', rows.length === WORLD_CITIES.length && rows[0].city === 'Local');
  const london = rows.find((r) => r.city === 'London');
  check('clock: london shows BST hour', /1:00/.test(london.time), london.time);
  const tokyo = rows.find((r) => r.city === 'Tokyo');
  check('clock: tokyo is +9', /9:00/.test(tokyo.time), tokyo.time);
}

{
  check('wmo: clear + storm known', wmoText(0) === 'Clear sky' && wmoText(95) === 'Thunderstorm');
  check('wmo: unknown degrades gracefully', wmoText(999) === 'Code 999');
  const g = geoUrl('New York');
  check('geo url: encodes city', g.includes('name=New%20York') && g.includes('geocoding-api.open-meteo.com'));
  const f = forecastUrl(51.5, -0.12);
  check('forecast url: coords + fields', f.includes('latitude=51.5') && f.includes('weather_code') && f.includes('api.open-meteo.com'));
}

console.log(`${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  console.log('FAILURES:\n- ' + fails.join('\n- '));
  process.exit(1);
}
