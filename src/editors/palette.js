/**
 * Palette extraction - pure functions (no DOM), so they are Node-testable.
 * Buckets RGB into 12-bit (4 bits/channel) space, counts, and returns the
 * most common buckets re-expanded to full 8-bit hex. Skips near-transparent
 * pixels so a circle-cropped PNG does not report "transparent" as a color.
 */

/** [r, g, b] (0-255) -> '#rrggbb'. */
export function rgbToHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * @param {{data: Uint8ClampedArray|number[], width: number, height: number}} img
 * @param {number} maxColors
 * @returns {Array<{hex: string, count: number, fraction: number}>}
 */
export function extractPalette(img, maxColors = 6) {
  const n = Math.max(1, Math.min(12, Math.floor(maxColors) || 6));
  const { data, width, height } = img;
  const total = Math.min(width * height, Math.floor(data.length / 4));
  const buckets = new Map();
  let counted = 0;
  // Sample at most ~40k pixels so a 2400px photo stays instant.
  const step = Math.max(1, Math.floor(total / 40000));
  for (let p = 0; p < total; p += step) {
    const i = p * 4;
    if (data[i + 3] < 128) continue; // transparent - not a real color
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    buckets.set(key, (buckets.get(key) || 0) + 1);
    counted++;
  }
  if (!counted) return [];
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => {
      const r = ((key >> 8) & 0xf) * 17;
      const g = ((key >> 4) & 0xf) * 17;
      const b = (key & 0xf) * 17;
      return { hex: rgbToHex(r, g, b), count, fraction: count / counted };
    });
}
