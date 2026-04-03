export interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PaletteEntry {
  label: number;
  color: [number, number, number];
}

/**
 * Flood fill reading boundaries from borderData, writing cluster colors to colorData.
 *
 * Border canvas (user-edited processed image):
 *   - Transparent pixels (alpha < 20) = passable (erased borders)
 *   - Non-transparent pixels: color similarity check vs start pixel (tolerance)
 *
 * Color canvas (existing cluster fills):
 *   - Different-color fills (alpha > 128, color diff > 30) = boundary
 *   - Same-color or transparent = passable
 */
export function floodFillFromSource(
  borderData: PixelData, colorData: PixelData,
  startX: number, startY: number,
  fillColor: [number, number, number, number],
  tolerance: number,
): number {
  const { width: w, height: h } = borderData;
  const bdr = borderData.data;
  const clr = colorData.data;
  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return 0;

  // Sample border canvas color at start point for similarity check
  const si0 = (sy * w + sx) * 4;
  const targetR = bdr[si0], targetG = bdr[si0 + 1], targetB = bdr[si0 + 2];
  const threshold = Math.round((tolerance / 100) * 255);

  const visited = new Uint8Array(w * h);
  const stack: number[] = [sx, sy];
  let filled = 0;

  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const pi = y * w + x;
    if (visited[pi]) continue;
    visited[pi] = 1;
    const si = pi * 4;

    // 1. Color canvas: stop at existing different-color cluster fills
    if (clr[si + 3] > 128) {
      const dr = Math.abs(clr[si] - fillColor[0]);
      const dg = Math.abs(clr[si + 1] - fillColor[1]);
      const db = Math.abs(clr[si + 2] - fillColor[2]);
      if (dr > 30 || dg > 30 || db > 30) continue;
    }

    // 2. Border canvas: transparent = passable, opaque = color boundary check
    if (bdr[si + 3] >= 20) {
      if (Math.abs(bdr[si] - targetR) > threshold || Math.abs(bdr[si + 1] - targetG) > threshold || Math.abs(bdr[si + 2] - targetB) > threshold) continue;
    }

    clr[si] = fillColor[0]; clr[si + 1] = fillColor[1]; clr[si + 2] = fillColor[2]; clr[si + 3] = fillColor[3];
    filled++;

    if (x > 0 && !visited[pi - 1]) stack.push(x - 1, y);
    if (x < w - 1 && !visited[pi + 1]) stack.push(x + 1, y);
    if (y > 0 && !visited[pi - w]) stack.push(x, y - 1);
    if (y < h - 1 && !visited[pi + w]) stack.push(x, y + 1);
  }

  return filled;
}

export function overlayToPixelLabels(
  overlay: PixelData, palette: PaletteEntry[],
): { pixelLabels: Uint8Array; colorCentroids: Array<[number, number, number] | null> } {
  const { width: w, height: h, data } = overlay;
  const pixelLabels = new Uint8Array(w * h);
  pixelLabels.fill(255);
  for (let i = 0; i < w * h; i++) {
    const ri = i * 4;
    if (data[ri + 3] < 128) continue;
    const r = data[ri], g = data[ri + 1], b = data[ri + 2];
    let bestLabel = 255, bestDist = Infinity;
    for (const entry of palette) {
      const dr = r - entry.color[0], dg = g - entry.color[1], db = b - entry.color[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; bestLabel = entry.label; }
    }
    pixelLabels[i] = bestLabel;
  }
  const colorCentroids: Array<[number, number, number] | null> = new Array(32).fill(null);
  for (const { label, color } of palette) colorCentroids[label] = color;
  return { pixelLabels, colorCentroids };
}

export function computeClusterPercentages(overlay: PixelData, palette: PaletteEntry[]): Map<number, number> {
  const counts = new Map<number, number>();
  let total = 0;
  const { data, width: w, height: h } = overlay;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 128) continue;
    total++;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let bestLabel = -1, bestDist = Infinity;
    for (const e of palette) {
      const dr = r - e.color[0], dg = g - e.color[1], db = b - e.color[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { bestDist = d; bestLabel = e.label; }
    }
    if (bestLabel >= 0) counts.set(bestLabel, (counts.get(bestLabel) ?? 0) + 1);
  }
  const pcts = new Map<number, number>();
  if (total > 0) for (const [label, count] of counts) pcts.set(label, Math.round(count / total * 1000) / 10);
  return pcts;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

export function parseRgbString(rgb: string): [number, number, number] {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Invalid rgb string: ${rgb}`);
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

const DISTINCT_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336',
  '#00BCD4', '#FFEB3B', '#795548', '#E91E63', '#3F51B5',
  '#8BC34A', '#FF5722', '#009688', '#CDDC39', '#673AB7',
];

export function getDistinctColor(index: number): string {
  return DISTINCT_COLORS[index % DISTINCT_COLORS.length];
}
