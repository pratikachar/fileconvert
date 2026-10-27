/**
 * Scroll a freshly rendered tool panel into view when the user picks a tool.
 *
 * Phones show the tool rail as a multi-row block; selecting a tool changes a
 * panel that lives BELOW the rail and can be entirely off-screen - it looks
 * like the button did nothing. This nudges the page only when the panel is
 * actually out of sight, and never scrolls backwards.
 */

const FALLBACK_NAV = 56;

function navHeight() {
  // Measure the sticky tab bar itself: it is taller than the fallback once the
  // labels wrap onto a second row (641-900px viewports).
  const bar = document.querySelector('.nav-tabs');
  const measured = bar ? bar.getBoundingClientRect().height : 0;
  if (measured > 0) return measured;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--nav-h');
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : FALLBACK_NAV;
}

/**
 * @param {HTMLElement|null} el - panel that was just rendered
 * @param {{force?: boolean}} [opts] - force scrolls even if partly visible
 */
export function revealPanel(el, opts = {}) {
  if (!el || typeof window === 'undefined') return;
  // Let the browser lay the new panel out before measuring it.
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    if (!rect.height) return;
    const nav = navHeight() + 12;
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    const visible = rect.top >= nav && rect.top <= viewport - 80;
    if (visible && !opts.force) return;
    // Above the viewport means the user scrolled up deliberately - leave it.
    if (rect.bottom < nav) return;
    const target = Math.max(0, window.scrollY + rect.top - nav);
    try {
      window.scrollTo({ top: target, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, target);
    }
  });
}
