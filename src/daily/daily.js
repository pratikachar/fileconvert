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

/* ---------------- weather (Open-Meteo: free, keyless, CORS-open) ---------------- */

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
  if (!res.ok) throw new Error(`Weather service answered HTTP ${res.status}.`);
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
