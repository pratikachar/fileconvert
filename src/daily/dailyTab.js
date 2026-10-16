/**
 * Daily tab - clock, stopwatch, countdown timer, calendar, weather.
 * Pure logic in daily.js (Node-tested); this file is UI only.
 * All timers are torn down whenever the panel re-renders or the tab hides,
 * so nothing ticks (or beeps) in the background after you leave.
 */
import {
  formatHMS, monthGrid, MONTHS, worldClock,
  lookupCity, getWeather,
} from './daily.js';

const $ = (id) => document.getElementById(id);

export const DAILY_TOOLS = [
  { id: 'clock', label: '🕐 Clock', short: '🕐 Clock' },
  { id: 'watch', label: '⏱ Stopwatch', short: '⏱ Watch' },
  { id: 'timer', label: '⏲ Timer', short: '⏲ Timer' },
  { id: 'calendar', label: '📅 Calendar', short: '📅 Cal' },
  { id: 'weather', label: '⛅ Weather', short: '⛅ Sky' },
];

let activeTool = 'clock';
let clockTimer = null;
let watchTimer = null;
let timerTimer = null;

function stopClocks() {
  for (const t of [clockTimer, watchTimer, timerTimer]) {
    if (t) clearInterval(t);
  }
  clockTimer = watchTimer = timerTimer = null;
}

function toast(msg) {
  let t = $('app-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'app-toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function alarm() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    [0, 0.35, 0.7].forEach((off) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.connect(g);
      g.connect(ac.destination);
      o.frequency.value = 880;
      const t0 = ac.currentTime + off;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.start(t0);
      o.stop(t0 + 0.32);
    });
    setTimeout(() => ac.close(), 1500);
  } catch { /* silent alarm is better than a crash */ }
}

export function setupDailyTab() {
  $('daily-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.audio-tool-btn');
    if (!btn) return;
    activeTool = btn.dataset.tool;
    renderDailyTools();
    renderDailyPanel();
  });
  if (window.matchMedia) {
    window.matchMedia('(max-width: 640px)').addEventListener('change', () => renderDailyTools());
  }
  document.addEventListener('visibilitychange', () => {
    // Background tabs get throttled timers; stop ours rather than lie.
    if (document.hidden) stopClocks();
    else if (!document.getElementById('tab-content-daily').classList.contains('hidden')) renderDailyPanel();
  });
  // Leaving the tab stops the clocks; returning re-renders fresh.
  document.querySelectorAll('.nav-tab').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.tab !== 'daily') stopClocks();
      else renderDailyPanel();
    });
  });
  renderDailyTools();
  renderDailyPanel();
}

function renderDailyTools() {
  const narrow = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  $('daily-toolbar').innerHTML = DAILY_TOOLS.map((t) =>
    `<button type="button" class="audio-tool-btn${activeTool === t.id ? ' active' : ''}" data-tool="${t.id}">${narrow && t.short ? t.short : t.label}</button>`
  ).join('');
}

function renderDailyPanel() {
  stopClocks();
  const el = $('daily-panel');
  const t = activeTool;

  if (t === 'clock') {
    el.innerHTML = `
      <div style="text-align:center;margin:8px 0">
        <div id="dy-clock-big" style="font-size:3rem;font-weight:700;font-variant-numeric:tabular-nums">--:--:--</div>
        <div id="dy-clock-date" class="field-hint" style="font-size:1rem"></div>
      </div>
      <div id="dy-world"></div>`;
    const tick = () => {
      const rows = worldClock();
      const local = rows[0];
      $('dy-clock-big').textContent = local.time;
      $('dy-clock-date').textContent = local.date;
      $('dy-world').innerHTML = rows.slice(1).map((r) =>
        `<div class="audio-result"><span class="ar-name">${r.city}</span><span class="ar-meta">${r.time} · ${r.date}</span></div>`).join('');
    };
    tick();
    clockTimer = setInterval(tick, 1000);
    return;
  }

  if (t === 'watch') {
    el.innerHTML = `
      <div id="dy-sw" style="text-align:center;font-size:2.6rem;font-weight:700;font-variant-numeric:tabular-nums">0:00.0</div>
      <div class="editor-actions" style="justify-content:center">
        <button type="button" class="btn-primary" id="dy-sw-go">Start</button>
        <button type="button" class="btn-secondary" id="dy-sw-lap" disabled>Lap</button>
        <button type="button" class="btn-secondary" id="dy-sw-reset">Reset</button>
      </div>
      <div id="dy-sw-laps"></div>`;
    let base = 0, acc = 0, running = false;
    const laps = [];
    const show = () => { $('dy-sw').textContent = formatHMS(running ? acc + (performance.now() - base) : acc); };
    const tickSw = () => show();
    $('dy-sw-go').addEventListener('click', () => {
      if (running) {
        acc += performance.now() - base;
        running = false;
        clearInterval(watchTimer);
        watchTimer = null;
        $('dy-sw-go').textContent = 'Start';
        $('dy-sw-lap').disabled = true;
      } else {
        base = performance.now();
        running = true;
        watchTimer = setInterval(tickSw, 100);
        $('dy-sw-go').textContent = 'Pause';
        $('dy-sw-lap').disabled = false;
      }
      show();
    });
    $('dy-sw-lap').addEventListener('click', () => {
      if (!running || laps.length >= 20) return;
      laps.unshift(formatHMS(acc + (performance.now() - base)));
      $('dy-sw-laps').innerHTML = laps.map((l, i) => `<div class="audio-result"><span class="ar-name">Lap ${laps.length - i}</span><span class="ar-meta">${l}</span></div>`).join('');
    });
    $('dy-sw-reset').addEventListener('click', () => {
      acc = 0; laps.length = 0; running = false;
      clearInterval(watchTimer);
      watchTimer = null;
      $('dy-sw-go').textContent = 'Start';
      $('dy-sw-lap').disabled = true;
      $('dy-sw-laps').innerHTML = '';
      show();
    });
    show();
    return;
  }

  if (t === 'timer') {
    el.innerHTML = `
      <div class="sliders-row">
        <div><label class="control-label" for="dy-t-min">Minutes</label>
        <input type="number" id="dy-t-min" class="form-input" min="0" max="600" value="5" /></div>
        <div><label class="control-label" for="dy-t-sec">Seconds</label>
        <input type="number" id="dy-t-sec" class="form-input" min="0" max="59" value="0" /></div>
      </div>
      <div id="dy-t-left" style="text-align:center;font-size:2.6rem;font-weight:700;font-variant-numeric:tabular-nums">5:00.0</div>
      <div class="editor-actions" style="justify-content:center">
        <button type="button" class="btn-primary" id="dy-t-go">Start</button>
        <button type="button" class="btn-secondary" id="dy-t-reset">Reset</button>
      </div>
      <p class="editor-hint" id="dy-t-note"></p>`;
    let endAt = 0, total = 0, left = 0;
    const show = () => { $('dy-t-left').textContent = formatHMS(left); };
    const arm = () => {
      total = Math.max(0, (+$('dy-t-min').value || 0) * 60000 + (+$('dy-t-sec').value || 0) * 1000);
      left = total;
      show();
    };
    $('dy-t-min').addEventListener('input', arm);
    $('dy-t-sec').addEventListener('input', arm);
    $('dy-t-go').addEventListener('click', () => {
      if (timerTimer) {
        clearInterval(timerTimer);
        timerTimer = null;
        $('dy-t-go').textContent = 'Start';
        $('dy-t-note').textContent = 'Paused.';
        return;
      }
      if (left <= 0) arm();
      if (left <= 0) { $('dy-t-note').textContent = 'Set a duration first.'; return; }
      $('dy-t-note').textContent = '';
      endAt = performance.now() + left;
      $('dy-t-go').textContent = 'Pause';
      timerTimer = setInterval(() => {
        left = Math.max(0, endAt - performance.now());
        show();
        if (left <= 0) {
          clearInterval(timerTimer);
          timerTimer = null;
          $('dy-t-go').textContent = 'Start';
          $('dy-t-note').textContent = "Time's up!";
          alarm();
          toast("Time's up!");
        }
      }, 200);
    });
    $('dy-t-reset').addEventListener('click', () => {
      clearInterval(timerTimer);
      timerTimer = null;
      $('dy-t-go').textContent = 'Start';
      $('dy-t-note').textContent = '';
      arm();
    });
    arm();
    return;
  }

  if (t === 'calendar') {
    const now = new Date();
    let y = now.getFullYear(), m = now.getMonth();
    el.innerHTML = `
      <div class="audio-head-row">
        <button type="button" class="btn-secondary btn-mini" id="dy-cal-prev">←</button>
        <h3 class="controls-title" id="dy-cal-title"></h3>
        <button type="button" class="btn-secondary btn-mini" id="dy-cal-next">→</button>
      </div>
      <div id="dy-cal-grid" class="tt-cal"></div>
      <div class="editor-actions" style="justify-content:center">
        <button type="button" class="btn-secondary btn-mini" id="dy-cal-today">Today</button>
      </div>`;
    const draw = () => {
      const g = monthGrid(y, m);
      $('dy-cal-title').textContent = `${MONTHS[m]} ${y}`;
      const today = new Date();
      const isThis = today.getFullYear() === y && today.getMonth() === m ? today.getDate() : -1;
      $('dy-cal-grid').innerHTML =
        ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="tt-cal-h">${d}</span>`).join('') +
        g.weeks.flat().map((d) => d == null
          ? '<span></span>'
          : `<span class="tt-cal-d${d === isThis ? ' today' : ''}">${d}</span>`).join('');
    };
    $('dy-cal-prev').addEventListener('click', () => { m--; if (m < 0) { m = 11; y--; } draw(); });
    $('dy-cal-next').addEventListener('click', () => { m++; if (m > 11) { m = 0; y++; } draw(); });
    $('dy-cal-today').addEventListener('click', () => { const n = new Date(); y = n.getFullYear(); m = n.getMonth(); draw(); });
    draw();
    return;
  }

  if (t === 'weather') {
    el.innerHTML = `
      <label class="control-label" for="dy-w-city">City</label>
      <input type="text" id="dy-w-city" class="form-input" value="London" maxlength="60" />
      <div class="editor-actions">
        <button type="button" class="btn-primary btn-mini" id="dy-w-go">Get weather</button>
      </div>
      <div id="dy-w-out"></div>
      <p class="field-hint">Free Open-Meteo data, no account. Needs network, like everything that leaves this page.</p>`;
    const go = async () => {
      const box = $('dy-w-out');
      box.innerHTML = '<p class="editor-hint">Asking the sky…</p>';
      try {
        const place = await lookupCity($('dy-w-city').value);
        const w = await getWeather(place.lat, place.lon);
        box.innerHTML = `
          <div class="audio-result"><span class="ar-name">${place.name}</span>
          <span class="ar-meta">${Math.round(w.temp)}°C · ${w.condition}</span></div>
          <p class="editor-hint">Wind ${Math.round(w.wind)} km/h · humidity ${w.humidity ?? '?'}% · observed ${String(w.time || '').replace('T', ' ')}</p>`;
      } catch (err) {
        box.innerHTML = `<p class="editor-hint">Weather unavailable: ${err && err.message ? err.message : err}</p>`;
      }
    };
    $('dy-w-go').addEventListener('click', go);
  }
}
