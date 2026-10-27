/**
 * Node checks for the Daily tools pure logic (src/daily/daily.js).
 * Timers/clocks tick in the browser - covered by headless E2E.
 * Run: node scripts/test-daily.mjs
 */

import {
  formatHMS, monthGrid, MONTHS, worldClock, WORLD_CITIES,
  wmoText, geoUrl, forecastUrl, createCalc,
  CURRENCIES, ratesUrl, getRatesCached, convertMoney,
  RATE_SOURCES, normalizeRates, rateSourceLabel,
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
  // calculator state machine
  const t = (keys) => {
    const c = createCalc();
    for (const k of keys) {
      if (/^[0-9]$/.test(k)) c.digit(k);
      else if (k === '.') c.dot();
      else if ('+-*/'.includes(k)) c.setOp(k);
      else if (k === '=') c.equals();
      else if (k === 'C') c.clear();
      else if (k === 'B') c.back();
      else if (k === 'N') c.negate();
      else if (k === '%') c.percent();
    }
    return c.display();
  };
  check('calc: 12+34=46', t(['1', '2', '+', '3', '4', '=']) === '46');
  check('calc: immediate execution 2+3*4=20', t(['2', '+', '3', '*', '4', '=']) === '20');
  check('calc: division by zero errors, then recovers', t(['5', '/', '0', '=']) === 'Error' && (() => { const c = createCalc(); c.digit('5'); c.setOp('/'); c.digit('0'); c.equals(); c.digit('7'); return c.display(); })() === '7');
  check('calc: repeated = repeats', t(['2', '+', '3', '=', '=']) === '8');
  check('calc: percent', t(['5', '0', '%']) === '0.5');
  check('calc: negate', t(['9', 'N']) === '-9');
  check('calc: backspace', t(['1', '2', '3', 'B']) === '12');
  check('calc: single dot', t(['1', '.', '.', '5']) === '1.5');
  check('calc: leading dot', t(['.', '5']) === '0.5');
  check('calc: operator replace', t(['9', '+', '-', '1', '=']) === '8');
  check('calc: clear resets all', t(['9', '+', 'C', '5', '=']) === '5');
  check('calc: float dust trimmed', t(['1', '/', '3', '=']) === '0.3333333333');
}

{
  // currency
  check('fx: majors listed incl INR', CURRENCIES.includes('USD') && CURRENCIES.includes('INR') && CURRENCIES.includes('EUR'));
  check('fx: gulf currencies listed', CURRENCIES.includes('AED') && CURRENCIES.includes('SAR'));
  const u = ratesUrl('USD & co');
  check('fx: primary url is the live .dev host', u.startsWith('https://api.frankfurter.dev/v1/latest') && u.includes('base=USD%20%26%20co'));
  check('fx: no deprecated .app host anywhere', !JSON.stringify(RATE_SOURCES.map((s) => s.url('USD'))).includes('frankfurter.app'));
  check('fx: provider chain has 3 backups', RATE_SOURCES.length === 3 && RATE_SOURCES.every((s) => s.id && s.label && s.url('USD')));
  check('fx: every provider url is https', RATE_SOURCES.every((s) => s.url('INR').startsWith('https://')));

  const table = { base: 'USD', date: '2026-01-01', rates: { INR: 83.5, EUR: 0.92 } };
  check('fx: 100 USD = 8350 INR', convertMoney(100, 'USD', 'INR', table).out === 8350);
  check('fx: same currency is identity', convertMoney(7, 'USD', 'USD', table).out === 7);
  check('fx: lowercase input still matches', convertMoney(10, 'usd', 'inr', table).out === 835);
  check('fx: missing rate refused', !convertMoney(1, 'USD', 'XYZ', table).ok);
  check('fx: stale-base table refused', !convertMoney(1, 'EUR', 'INR', table).ok);
  check('fx: bad amount refused', !convertMoney('lots', 'USD', 'INR', table).ok);
  check('fx: no table refused', !convertMoney(1, 'USD', 'INR', null).ok);

  // provider normalisation
  const ecb = normalizeRates({ base: 'usd', date: '2026-10-26', rates: { inr: 95.18, EUR: '0.89', junk: 'x', zero: 0 }, source: 'ecb' });
  check('fx: codes upper-cased + junk dropped', ecb.base === 'USD' && ecb.rates.INR === 95.18 && ecb.rates.EUR === 0.89 && !('JUNK' in ecb.rates) && !('ZERO' in ecb.rates));
  check('fx: unusable table rejected', normalizeRates({ rates: {} }) === null && normalizeRates(null) === null && normalizeRates({}) === null);
  check('fx: source label resolved', rateSourceLabel(ecb) === 'European Central Bank' && rateSourceLabel({ source: 'erapi' }) === 'ExchangeRate-API' && rateSourceLabel(null) === 'free FX feed');

  // er-api -> normalised shape (what the chain stores)
  const er = RATE_SOURCES[1].parse({ result: 'success', base_code: 'AED', time_last_update_unix: 1793059351, rates: { INR: 24.1 } }, 'AED');
  check('fx: er-api parsed + dated', er.base === 'AED' && er.rates.INR === 24.1 && /^\d{4}-\d{2}-\d{2}$/.test(er.date), JSON.stringify(er));
  check('fx: er-api date matches its unix stamp', er.date === new Date(1793059351 * 1000).toISOString().slice(0, 10), er.date);
  check('fx: er-api error payload rejected', RATE_SOURCES[1].parse({ result: 'error' }, 'AED') === null);
  const cdn = RATE_SOURCES[2].parse({ date: '2026-10-27', usd: { inr: 95.5, eur: 0.9 } }, 'USD');
  check('fx: cdn table parsed + upper-cased', cdn.base === 'USD' && cdn.rates.INR === 95.5 && cdn.rates.EUR === 0.9);
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
