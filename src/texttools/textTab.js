/**
 * Text & Dev Tools tab - instant utilities, everything local.
 * Pure logic lives in texttools.js (Node-tested); this file is UI only.
 * JsBarcode is lazy-imported so the ~100 KB only downloads when requested.
 */
import { marked } from 'marked';
import {
  formatJSON, b64encode, b64decode, urlEncode, urlDecode, parseJWT,
  genPassword, passwordCharset, countWords, diffLines, UNIT_CATEGORIES,
  convertUnit, tsToDate, dateToTs, testRegex, convertColor,
} from './texttools.js';

const $ = (id) => document.getElementById(id);

export const TEXT_TOOLS = [
  { id: 'json', label: '{} JSON', short: '{} JSON' },
  { id: 'base64', label: '🔣 Base64', short: '🔣 B64' },
  { id: 'url', label: '🔗 URL codec', short: '🔗 URL' },
  { id: 'jwt', label: '🎫 JWT decode', short: '🎫 JWT' },
  { id: 'password', label: '🔑 Passwords', short: '🔑 PW' },
  { id: 'words', label: '📝 Word count', short: '📝 Words' },
  { id: 'diff', label: '🔀 Text diff', short: '🔀 Diff' },
  { id: 'markdown', label: '📄 Markdown', short: '📄 MD' },
  { id: 'barcode', label: '📊 Barcodes', short: '📊 Codes' },
  { id: 'units', label: '📏 Units', short: '📏 Units' },
  { id: 'time', label: '⏱ Timestamps', short: '⏱ Time' },
  { id: 'regex', label: '🧪 Regex', short: '🧪 Regex' },
  { id: 'color', label: '🎨 Colors', short: '🎨 Color' },
];

let activeTool = 'json';

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
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function copyText(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to clipboard`);
  } catch {
    toast('Clipboard blocked by the browser - select and copy manually');
  }
}

export function setupTextTab() {
  $('text-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.audio-tool-btn');
    if (!btn) return;
    activeTool = btn.dataset.tool;
    renderTextTools();
    renderTextPanel();
  });
  // Shorter rail labels on phones (rail only - the open panel is untouched).
  if (window.matchMedia) {
    window.matchMedia('(max-width: 640px)').addEventListener('change', () => renderTextTools());
  }
  renderTextTools();
  renderTextPanel();
}

function renderTextTools() {
  const narrow = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  $('text-toolbar').innerHTML = TEXT_TOOLS.map((t) =>
    `<button type="button" class="audio-tool-btn${activeTool === t.id ? ' active' : ''}" data-tool="${t.id}">${narrow && t.short ? t.short : t.label}</button>`
  ).join('');
}

function outShell(extra = '') {
  return `<div class="editor-actions"><button type="button" class="btn-secondary btn-mini" data-tt-copy style="display:none">Copy output</button></div>
    <pre id="tt-out" class="tt-out${extra}" hidden></pre>`;
}

function showOut(text, isErr = false) {
  const pre = $('tt-out');
  pre.hidden = false;
  pre.textContent = text;
  pre.classList.toggle('tt-err', !!isErr);
  const btn = document.querySelector('[data-tt-copy]');
  btn.style.display = '';
  btn.onclick = () => copyText(text);
}

function renderTextPanel() {
  const el = $('text-panel');
  const t = activeTool;

  if (t === 'json') {
    el.innerHTML = `
      <label class="control-label" for="tt-json-in">JSON</label>
      <textarea id="tt-json-in" class="form-textarea" rows="7" placeholder='{"hello": "world"}'></textarea>
      <div class="editor-actions">
        <button type="button" class="btn-primary btn-mini" id="tt-json-fmt">Format</button>
        <button type="button" class="btn-secondary btn-mini" id="tt-json-min">Minify</button>
      </div>${outShell()}`;
    $('tt-json-fmt').addEventListener('click', () => {
      const r = formatJSON($('tt-json-in').value, 2);
      showOut(r.ok ? r.out : r.error, !r.ok);
    });
    $('tt-json-min').addEventListener('click', () => {
      const r = formatJSON($('tt-json-in').value, 0);
      showOut(r.ok ? r.out : r.error, !r.ok);
    });
    return;
  }

  if (t === 'base64') {
    el.innerHTML = `
      <label class="control-label" for="tt-b64-in">Text</label>
      <textarea id="tt-b64-in" class="form-textarea" rows="5" placeholder="Hello, world!"></textarea>
      <div class="editor-actions">
        <button type="button" class="btn-primary btn-mini" id="tt-b64-e">Encode</button>
        <button type="button" class="btn-secondary btn-mini" id="tt-b64-d">Decode</button>
      </div>${outShell()}`;
    $('tt-b64-e').addEventListener('click', () => showOut(b64encode($('tt-b64-in').value)));
    $('tt-b64-d').addEventListener('click', () => {
      const r = b64decode($('tt-b64-in').value);
      showOut(r.ok ? r.out : r.error, !r.ok);
    });
    return;
  }

  if (t === 'url') {
    el.innerHTML = `
      <label class="control-label" for="tt-url-in">Text / URL</label>
      <textarea id="tt-url-in" class="form-textarea" rows="4" placeholder="hello world & more"></textarea>
      <div class="editor-actions">
        <button type="button" class="btn-primary btn-mini" id="tt-url-e">Encode</button>
        <button type="button" class="btn-secondary btn-mini" id="tt-url-d">Decode</button>
      </div>${outShell()}`;
    $('tt-url-e').addEventListener('click', () => showOut(urlEncode($('tt-url-in').value)));
    $('tt-url-d').addEventListener('click', () => {
      const r = urlDecode($('tt-url-in').value);
      showOut(r.ok ? r.out : r.error, !r.ok);
    });
    return;
  }

  if (t === 'jwt') {
    el.innerHTML = `
      <label class="control-label" for="tt-jwt-in">Token</label>
      <textarea id="tt-jwt-in" class="form-textarea" rows="4" placeholder="eyJhbGciOi..."></textarea>
      <div class="editor-actions">
        <button type="button" class="btn-primary btn-mini" id="tt-jwt-go">Decode</button>
      </div>
      <p class="field-hint">Decodes only - the signature is never verified and your token never leaves this page.</p>${outShell()}`;
    $('tt-jwt-go').addEventListener('click', () => {
      const r = parseJWT($('tt-jwt-in').value);
      showOut(r.ok
        ? `alg: ${r.header.alg || '(missing)'} · signature ${r.signed ? 'present (not verified)' : 'ABSENT'}\n\n--- header ---\n${JSON.stringify(r.header, null, 2)}\n\n--- payload ---\n${JSON.stringify(r.payload, null, 2)}`
        : r.error, !r.ok);
    });
    return;
  }

  if (t === 'password') {
    el.innerHTML = `
      <label class="control-label" for="tt-pw-len">Length (<span id="tt-pw-lenv">20</span>)</label>
      <input type="range" id="tt-pw-len" min="4" max="128" value="20">
      <label class="control-inline"><input type="checkbox" id="tt-pw-lower" checked /> a-z</label>
      <label class="control-inline"><input type="checkbox" id="tt-pw-upper" checked /> A-Z</label>
      <label class="control-inline"><input type="checkbox" id="tt-pw-digits" checked /> 0-9</label>
      <label class="control-inline"><input type="checkbox" id="tt-pw-symbols" /> symbols</label>
      <div class="editor-actions">
        <button type="button" class="btn-primary btn-mini" id="tt-pw-go">Generate</button>
      </div>
      <p class="field-hint">Uses your device's cryptographic RNG - never Math.random.</p>${outShell()}`;
    $('tt-pw-len').addEventListener('input', (e) => { $('tt-pw-lenv').textContent = e.target.value; });
    const opts = () => ({
      lower: $('tt-pw-lower').checked, upper: $('tt-pw-upper').checked,
      digits: $('tt-pw-digits').checked, symbols: $('tt-pw-symbols').checked,
    });
    $('tt-pw-go').addEventListener('click', () => {
      const set = passwordCharset(opts());
      if (!set) { showOut('Enable at least one character set.', true); return; }
      const r = genPassword(+$('tt-pw-len').value, opts());
      showOut(r.ok ? r.out : r.error, !r.ok);
    });
    return;
  }

  if (t === 'words') {
    el.innerHTML = `
      <label class="control-label" for="tt-wc-in">Text</label>
      <textarea id="tt-wc-in" class="form-textarea" rows="7" placeholder="Paste text here…"></textarea>
      <div id="tt-wc-out" class="tt-stats"></div>`;
    const update = () => {
      const c = countWords($('tt-wc-in').value);
      $('tt-wc-out').innerHTML =
        `<span><b>${c.words}</b> words</span><span><b>${c.chars}</b> chars</span>` +
        `<span><b>${c.charsNoSpaces}</b> no spaces</span><span><b>${c.lines}</b> lines</span>` +
        `<span>~<b>${c.minutes}</b> min read</span>`;
    };
    $('tt-wc-in').addEventListener('input', update);
    update();
    return;
  }

  if (t === 'diff') {
    el.innerHTML = `
      <label class="control-label" for="tt-diff-a">Original</label>
      <textarea id="tt-diff-a" class="form-textarea" rows="5" placeholder="line one&#10;line two"></textarea>
      <label class="control-label" for="tt-diff-b">Changed</label>
      <textarea id="tt-diff-b" class="form-textarea" rows="5" placeholder="line one&#10;line 2"></textarea>
      <div class="editor-actions">
        <button type="button" class="btn-primary btn-mini" id="tt-diff-go">Compare</button>
      </div>
      <div id="tt-diff-out" class="tt-diff" hidden></div>`;
    $('tt-diff-go').addEventListener('click', () => {
      const r = diffLines($('tt-diff-a').value, $('tt-diff-b').value);
      const box = $('tt-diff-out');
      box.hidden = false;
      box.innerHTML = r.ok
        ? r.rows.map((row) => `<div class="tt-d${row.t === ' ' ? 's' : row.t === '+' ? 'a' : 'd'}">${row.t} ${escapeHtml(row.text) || ' '}</div>`).join('')
        : `<div class="tt-err">${escapeHtml(r.error)}</div>`;
    });
    return;
  }

  if (t === 'markdown') {
    el.innerHTML = `
      <label class="control-label" for="tt-md-in">Markdown</label>
      <textarea id="tt-md-in" class="form-textarea" rows="7" placeholder="# Hello&#10;&#10;**bold** and *italic*"></textarea>
      <label class="control-label">Preview</label>
      <div id="tt-md-out" class="tt-md"></div>`;
    const update = () => { $('tt-md-out').innerHTML = marked($('tt-md-in').value); };
    $('tt-md-in').addEventListener('input', update);
    update();
    return;
  }

  if (t === 'barcode') {
    el.innerHTML = `
      <label class="control-label" for="tt-bc-val">Value</label>
      <input type="text" id="tt-bc-val" class="form-input" value="590123412345" maxlength="48" />
      <label class="control-label" for="tt-bc-fmt">Format</label>
      <select id="tt-bc-fmt" class="form-select">
        <option value="CODE128" selected>CODE128 (any text)</option>
        <option value="EAN13">EAN-13 (12-13 digits)</option>
      </select>
      <p class="editor-hint" id="tt-bc-msg"></p>
      <div id="tt-bc-wrap" class="tt-barcode"></div>
      <div class="editor-actions">
        <button type="button" class="btn-secondary btn-mini" id="tt-bc-dl">Download SVG</button>
      </div>`;
    let svgEl = null;
    const render = async () => {
      const val = $('tt-bc-val').value.trim();
      const fmt = $('tt-bc-fmt').value;
      const msg = $('tt-bc-msg');
      const wrap = $('tt-bc-wrap');
      wrap.innerHTML = '';
      if (!val) { msg.textContent = 'Type a value first.'; return; }
      if (fmt === 'EAN13' && !/^\d{12,13}$/.test(val)) {
        msg.textContent = 'EAN-13 needs exactly 12 or 13 digits.';
        return;
      }
      msg.textContent = '';
      try {
        const { default: JsBarcode } = await import('jsbarcode');
        svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        JsBarcode(svgEl, val, { format: fmt, displayValue: true, fontSize: 16, margin: 8 });
        wrap.appendChild(svgEl);
      } catch (err) {
        msg.textContent = 'Cannot encode that value: ' + (err && err.message ? err.message : err);
      }
    };
    $('tt-bc-val').addEventListener('input', render);
    $('tt-bc-fmt').addEventListener('change', render);
    $('tt-bc-dl').addEventListener('click', () => {
      if (!svgEl) { toast('Render a barcode first'); return; }
      const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `barcode-${$('tt-bc-val').value.trim()}.svg`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    });
    render();
    return;
  }

  if (t === 'units') {
    const cats = Object.entries(UNIT_CATEGORIES).map(([v, c]) => `<option value="${v}">${c.label}</option>`).join('');
    el.innerHTML = `
      <label class="control-label" for="tt-u-cat">Category</label>
      <select id="tt-u-cat" class="form-select">${cats}</select>
      <label class="control-label" for="tt-u-val">Value</label>
      <input type="number" id="tt-u-val" class="form-input" value="1" step="any" />
      <div class="sliders-row">
        <div><label class="control-label" for="tt-u-from">From</label><select id="tt-u-from" class="form-select"></select></div>
        <div><label class="control-label" for="tt-u-to">To</label><select id="tt-u-to" class="form-select"></select></div>
      </div>${outShell()}`;
    const syncUnits = () => {
      const units = Object.keys(UNIT_CATEGORIES[$('tt-u-cat').value].units);
      $('tt-u-from').innerHTML = units.map((u) => `<option>${u}</option>`).join('');
      $('tt-u-to').innerHTML = units.map((u) => `<option${u === units[1] ? ' selected' : ''}>${u}</option>`).join('');
      convert();
    };
    const convert = () => {
      const r = convertUnit($('tt-u-val').value, $('tt-u-from').value, $('tt-u-to').value, $('tt-u-cat').value);
      showOut(r.ok ? `${$('tt-u-val').value} ${$('tt-u-from').value} = ${+r.out.toFixed(6)} ${$('tt-u-to').value}` : r.error, !r.ok);
    };
    $('tt-u-cat').addEventListener('change', syncUnits);
    ['tt-u-val', 'tt-u-from', 'tt-u-to'].forEach((id) => $(id).addEventListener('input', convert));
    syncUnits();
    return;
  }

  if (t === 'time') {
    el.innerHTML = `
      <label class="control-label" for="tt-ts-in">Unix timestamp (s or ms)</label>
      <input type="text" id="tt-ts-in" class="form-input" inputmode="numeric" placeholder="1718450000" />
      <div class="editor-actions">
        <button type="button" class="btn-secondary btn-mini" id="tt-ts-now">Use now</button>
        <button type="button" class="btn-primary btn-mini" id="tt-ts-go">To date</button>
      </div>
      <label class="control-label" for="tt-ts-date">Date</label>
      <input type="text" id="tt-ts-date" class="form-input" placeholder="2026-05-01T12:00:00Z" />
      <div class="editor-actions">
        <button type="button" class="btn-primary btn-mini" id="tt-ts-back">To timestamp</button>
      </div>${outShell()}`;
    $('tt-ts-now').addEventListener('click', () => { $('tt-ts-in').value = String(Math.floor(Date.now() / 1000)); });
    $('tt-ts-go').addEventListener('click', () => {
      const r = tsToDate($('tt-ts-in').value);
      showOut(r.ok ? `${r.out}\n${r.local}` : r.error, !r.ok);
    });
    $('tt-ts-back').addEventListener('click', () => {
      const r = dateToTs($('tt-ts-date').value);
      showOut(r.ok ? `seconds: ${r.s}\nms: ${r.ms}` : r.error, !r.ok);
    });
    return;
  }

  if (t === 'regex') {
    el.innerHTML = `
      <label class="control-label" for="tt-rx-pat">Pattern</label>
      <input type="text" id="tt-rx-pat" class="form-input" value="\\b\\w+@\\w+\\.\\w+\\b" />
      <label class="control-inline"><input type="checkbox" id="tt-rx-g" checked /> g <input type="checkbox" id="tt-rx-i" /> i <input type="checkbox" id="tt-rx-m" /> m</label>
      <label class="control-label" for="tt-rx-text">Test text</label>
      <textarea id="tt-rx-text" class="form-textarea" rows="5" placeholder="mail me at test@example.com"></textarea>
      <div id="tt-rx-out" class="tt-diff" hidden></div>`;
    const run = () => {
      const flags = ($('tt-rx-g').checked ? 'g' : '') + ($('tt-rx-i').checked ? 'i' : '') + ($('tt-rx-m').checked ? 'm' : '');
      const r = testRegex($('tt-rx-pat').value, flags, $('tt-rx-text').value);
      const box = $('tt-rx-out');
      box.hidden = false;
      if (!r.ok) { box.innerHTML = `<div class="tt-err">${escapeHtml(r.error)}</div>`; return; }
      box.innerHTML = r.matches.length
        ? r.matches.map((m, i) => `<div class="tt-ds"><b>#${i + 1}</b> <code>${escapeHtml(m.match)}</code> at ${m.index}${m.groups.length ? ` <span class="field-hint">groups: ${m.groups.map((g) => escapeHtml(g ?? '')).join(' · ')}</span>` : ''}</div>`).join('')
        : '<div class="field-hint">No matches.</div>';
    };
    ['tt-rx-pat', 'tt-rx-text'].forEach((id) => $(id).addEventListener('input', run));
    ['tt-rx-g', 'tt-rx-i', 'tt-rx-m'].forEach((id) => $(id).addEventListener('change', run));
    run();
    return;
  }

  if (t === 'color') {
    el.innerHTML = `
      <label class="control-label" for="tt-c-in">Color (#rgb, #rrggbb, rgb(), hsl())</label>
      <input type="text" id="tt-c-in" class="form-input" value="#c0392b" />
      <div id="tt-c-out"></div>`;
    const run = () => {
      const r = convertColor($('tt-c-in').value);
      $('tt-c-out').innerHTML = r.ok
        ? `<div class="pal-swatch"><span class="pal-dot" style="background:${r.hex}"></span><span><b>${r.hex}</b><br><span class="field-hint">${r.rgb} · ${r.hsl}</span></span></div>
           <div class="editor-actions"><button type="button" class="btn-secondary btn-mini" id="tt-c-copy">Copy HEX</button></div>`
        : `<p class="editor-hint">${escapeHtml(r.error)}</p>`;
      const btn = $('tt-c-copy');
      if (btn) btn.addEventListener('click', () => copyText(r.hex, 'HEX copied'));
    };
    $('tt-c-in').addEventListener('input', run);
    run();
  }
}
