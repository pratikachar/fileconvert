/**
 * Daily tools - pure logic (no DOM), Node-testable. Clock, stopwatch/timer
 * formatting, calendar grids, and the free Open-Meteo weather calls
 * (no API key, CORS-open; needs network, so failures stay honest).
 */

/* ---------------- formatting ---------------- */

/** ms -> "M:SS.d" (stopwatch) or "H:MM:SS" when over an hour. */
export function formatHMS(ms) {
  const t = Math.max(0, ms);
  const d = Math.floor((t % 1000) / 100);
  const s = Math.floor(t / 1000) % 60;
  const m = Math.floor(t / 60000) % 60;
  const h = Math.floor(t / 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}.${d}`;
}

/* ---------------- calendar (Monday-start grids) ---------------- */

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Month grid, weeks start Monday. Returns
 * { year, month, weeks: [[day|null × 7], ...] }.
 */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const days = new Date(year, month + 1, 0).getDate();
  const weeks = [];
  let day = 1 - offset;
  while (day <= days) {
    const week = [];
    for (let i = 0; i < 7; i++, day++) week.push(day >= 1 && day <= days ? day : null);
    weeks.push(week);
  }
  return { year, month, weeks };
}

/* ---------------- world clock (built-in Intl, no data needed) ---------------- */

export const WORLD_CITIES = [
  { city: 'Local', tz: null },
  { city: 'New York', tz: 'America/New_York' },
  { city: 'London', tz: 'Europe/London' },
  { city: 'Dubai', tz: 'Asia/Dubai' },
  { city: 'Mumbai', tz: 'Asia/Kolkata' },
  { city: 'Singapore', tz: 'Asia/Singapore' },
  { city: 'Tokyo', tz: 'Asia/Tokyo' },
];

/** Current time/date per city. Pure w.r.t. Date (uses `now` when given). */
export function worldClock(now = new Date()) {
  return WORLD_CITIES.map(({ city, tz }) => {
    const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    const dateOpts = { weekday: 'short', day: 'numeric', month: 'short' };
    if (tz) {
      opts.timeZone = tz;
      dateOpts.timeZone = tz;
    }
    return {
      city,
      time: new Intl.DateTimeFormat('en-US', opts).format(now),
      date: new Intl.DateTimeFormat('en-US', dateOpts).format(now),
    };
  });
}

/* ---------------- calculator (immediate-execution, like a pocket calc) ---------------- */

/**
 * Tiny calculator state machine - pure, so every key path is unit-tested.
 * Immediate execution: 2 + 3 × 4 = 20 (no precedence, like hardware calcs).
 */
export function createCalc() {
  let cur = '0';
  let acc = null;
  let op = null;
  let fresh = true;
  let lastOp = null;
  let lastVal = null;
  let err = null;

  const num = () => parseFloat(cur);
  const compute = (a, o, b) => {
    if (o === '+') return a + b;
    if (o === '-') return a - b;
    if (o === '*') return a * b;
    if (o === '/') return b === 0 ? NaN : a / b;
    return b;
  };
  const fmt = (v) => {
    if (!Number.isFinite(v)) return 'Error';
    if (v !== 0 && (Math.abs(v) >= 1e12 || Math.abs(v) < 1e-9)) return v.toExponential(6);
    return String(Math.round(v * 1e10) / 1e10);
  };
  const fail = () => {
    err = 'Error';
    acc = null; op = null; lastOp = null; fresh = true;
  };
  const clearErr = () => {
    if (!err) return false;
    err = null; cur = '0'; acc = null; op = null; fresh = true;
    return true;
  };

  return {
    display() { return err || cur; },
    digit(d) {
      if (clearErr()) { /* fall through with fresh entry */ }
      if (!/^[0-9]$/.test(d)) return;
      if (fresh) { cur = d; fresh = false; }
      else if (cur.replace(/[-.]/g, '').length < 12) cur = cur === '0' ? d : cur === '-0' ? '-' + d : cur + d;
    },
    dot() {
      if (clearErr()) { cur = '0.'; fresh = false; return; }
      if (fresh) { cur = '0.'; fresh = false; }
      else if (!cur.includes('.')) cur += '.';
    },
    setOp(o) {
      if (err || !['+', '-', '*', '/'].includes(o)) return;
      if (op && !fresh) {
        const r = compute(acc, op, num());
        if (!Number.isFinite(r)) { fail(); return; }
        acc = r;
        cur = fmt(r);
      } else if (!op) {
        acc = num();
      }
      op = o;
      lastOp = null;
      fresh = true;
    },
    equals() {
      if (err) return;
      let r;
      if (op) {
        r = compute(acc, op, num());
        lastOp = op;
        lastVal = num();
        op = null;
      } else if (lastOp) {
        r = compute(num(), lastOp, lastVal);
      } else {
        return;
      }
      if (!Number.isFinite(r)) { fail(); return; }
      acc = null;
      cur = fmt(r);
      fresh = true;
    },
    clear() {
      err = null; cur = '0'; acc = null; op = null; lastOp = null; fresh = true;
    },
    back() {
      if (clearErr()) return;
      if (fresh) return;
      cur = cur.length > 1 ? cur.slice(0, -1) : '0';
      if (cur === '-' || cur === '') cur = '0';
    },
    negate() {
      if (err) return;
      cur = fmt(-num());
    },
    percent() {
      if (err) return;
      cur = fmt(num() / 100);
    },
  };
}

/* ---------------- currency (ECB rates, with free fallbacks) ---------------- */

export const CURRENCIES = [
  'USD', 'EUR', 'INR', 'GBP', 'JPY', 'AED', 'SAR', 'CAD',
  'AUD', 'SGD', 'CHF', 'CNY', 'KRW', 'BRL', 'ZAR',
];

const FRANKFURTER = 'https://api.frankfurter.dev/v1';

/**
 * Primary rate URL. NOTE: api.frankfurter.app (the host every tutorial still
 * shows) is deprecated - it replies with a `deprecation` header and, in
 * practice, fails in the browser with "Failed to fetch" even when curl gets a
 * clean 200. The .dev host serves the same ECB data.
 */
export function ratesUrl(base) {
  return `${FRANKFURTER}/latest?base=${encodeURIComponent(base)}`;
}

/**
 * Free, keyless, CORS-open rate providers, tried in order.
 *
 * Why a chain: the ECB set covers ~30 currencies and has no AED/SAR, so those
 * pairs need a wider table; and any single free host can be blocked or down.
 * Each provider is normalised to { base, date, rates, source }.
 */
export const RATE_SOURCES = [
  {
    id: 'ecb',
    label: 'European Central Bank',
    url: (base) => ratesUrl(base),
    parse: (d, base) => (d && d.rates ? { base: d.base || base, date: d.date, rates: d.rates } : null),
  },
  {
    id: 'erapi',
    label: 'ExchangeRate-API',
    url: (base) => `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
    parse: (d, base) => {
      if (!d || d.result !== 'success' || !d.rates) return null;
      const unix = Number(d.time_last_update_unix);
      const date = Number.isFinite(unix) && unix > 0
        ? new Date(unix * 1000).toISOString().slice(0, 10)
        : null;
      return { base: d.base_code || base, date, rates: d.rates };
    },
  },
  {
    id: 'cdn',
    label: 'currency-api (CDN)',
    url: (base) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${encodeURIComponent(String(base).toLowerCase())}.json`,
    parse: (d, base) => {
      const table = d && d[String(base).toLowerCase()];
      if (!table) return null;
      const rates = {};
      for (const [code, v] of Object.entries(table)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) rates[code.toUpperCase()] = n;
      }
      return { base, date: d.date, rates };
    },
  },
];

/** Keep only usable numbers and normalise codes. Returns null when unusable. */
export function normalizeRates(raw) {
  if (!raw || !raw.rates || typeof raw.rates !== 'object') return null;
  const rates = {};
  for (const [code, v] of Object.entries(raw.rates)) {
    const n = Number(v);
    if (!code || !Number.isFinite(n) || n <= 0) continue;
    rates[String(code).toUpperCase()] = n;
  }
  if (!Object.keys(rates).length) return null;
  return {
    base: String(raw.base || '').toUpperCase(),
    date: raw.date || null,
    rates,
    source: raw.source || null,
  };
}

const RATES_TTL = 12 * 3600 * 1000;
let ratesCache = { base: null, at: 0, data: null };

/**
 * Exchange table, cached 12h in memory. `need` is the target currency: a table
 * that lacks it (the ECB set has no AED/SAR) is skipped in favour of a wider
 * provider, so picking those still converts instead of failing.
 */
export async function getRatesCached(base, need) {
  const want = String(base || 'USD').toUpperCase();
  const target = need ? String(need).toUpperCase() : null;
  const now = Date.now();
  const cached = ratesCache.base === want && now - ratesCache.at < RATES_TTL ? ratesCache.data : null;
  if (cached && (!target || target === want || cached.rates[target])) return cached;

  const tried = [];
  let partial = null;
  for (const src of RATE_SOURCES) {
    try {
      const raw = await fetchJson(src.url(want));
      const parsed = src.parse(raw, want);
      if (!parsed) throw new Error('unexpected response');
      const table = normalizeRates({ ...parsed, source: src.id });
      if (!table) throw new Error('empty rate table');
      if (table.base && table.base !== want) throw new Error(`table is for ${table.base}`);
      if (!partial) partial = table;
      if (target && target !== want && !table.rates[target]) {
        tried.push(`${src.label} (no ${target})`);
        continue;
      }
      ratesCache = { base: want, at: now, data: table };
      return table;
    } catch (err) {
      tried.push(`${src.label} (${(err && err.message) || err})`);
    }
  }
  // Every provider failed the target but one answered with a usable base
  // table: return it so the UI can say "no AED rate" instead of a network error.
  if (partial) {
    ratesCache = { base: want, at: now, data: partial };
    return partial;
  }
  throw new Error(`no rate feed answered - tried ${tried.join('; ')}. Check your connection and retry.`);
}

/** Human name for a table's provider, for the UI note. */
export function rateSourceLabel(table) {
  const hit = RATE_SOURCES.find((s) => s.id === (table && table.source));
  return hit ? hit.label : 'free FX feed';
}

/** Convert with a fetched table. Returns { ok, out } or { ok:false, error }. */
export function convertMoney(value, from, to, table) {
  const v = Number(value);
  const src = String(from || '').toUpperCase();
  const dst = String(to || '').toUpperCase();
  if (!Number.isFinite(v)) return { ok: false, error: 'Enter an amount first.' };
  if (!table || !table.rates) return { ok: false, error: 'Rates not loaded yet.' };
  if (src === dst) return { ok: true, out: v };
  if (table.base && table.base !== src) return { ok: false, error: 'Rate table is for another currency - retry.' };
  const rate = table.rates[dst];
  if (!Number.isFinite(rate)) return { ok: false, error: `No ${dst} rate in this table.` };
  // Provider tables are quoted FROM base: the value is already in `from`.
  return { ok: true, out: v * rate };
}

export function geoUrl(city) {
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
}

export function forecastUrl(lat, lon) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto';
}

// WMO weather-code table (https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4728.HTM)
export const WMO = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Icy fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Storm + hail', 99: 'Storm + hail',
};

export function wmoText(code) {
  return WMO[code] || `Code ${code}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`request answered HTTP ${res.status}`);
  return res.json();
}

export async function lookupCity(city) {
  const name = String(city || '').trim();
  if (!name) throw new Error('Type a city first.');
  const data = await fetchJson(geoUrl(name));
  const hit = (data.results || [])[0];
  if (!hit) throw new Error(`No place found for "${name}".`);
  return { name: `${hit.name}${hit.country ? ', ' + hit.country : ''}`, lat: hit.latitude, lon: hit.longitude };
}

export async function getWeather(lat, lon) {
  const data = await fetchJson(forecastUrl(lat, lon));
  const c = data.current || {};
  return {
    temp: c.temperature_2m,
    condition: wmoText(c.weather_code),
    wind: c.wind_speed_10m,
    humidity: c.relative_humidity_2m,
    time: c.time,
  };
}
