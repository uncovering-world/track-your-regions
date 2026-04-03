/**
 * Chain-tracing algorithm for extracting border paths from pixel label maps.
 *
 * Given a pixelLabels Uint8Array (one label per pixel, 255=background), detects
 * border pixels (where neighboring pixels have different labels), groups them by
 * cluster pair, traces them into ordered polyline paths via 8-connectivity, and
 * simplifies the result with Douglas-Peucker.
 */

// =============================================================================
// Types
// =============================================================================

export interface BorderPath {
  id: string;                       // unique: "bp-0", "bp-1", etc.
  points: Array<[number, number]>;  // [x, y] at TW x TH resolution
  type: 'internal' | 'external';
  clusters: [number, number];       // sorted: [min, max] of the two adjacent labels
}

// =============================================================================
// Douglas-Peucker simplification
// =============================================================================

/**
 * Perpendicular distance from point P to the line defined by A→B.
 */
function perpendicularDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    // A and B are the same point — use direct distance
    return Math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2);
  }
  // |cross product| / |AB|
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) /
    Math.sqrt(dx * dx + dy * dy);
}

/**
 * Douglas-Peucker polyline simplification.
 *
 * Recursively removes points that are within `tolerance` of the line between
 * the endpoints. Returns a new array with redundant intermediate points removed.
 */
export function douglasPeucker(
  points: Array<[number, number]>,
  tolerance: number,
): Array<[number, number]> {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];

  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIdx), tolerance);
    // Merge: left includes the split point, right starts at it — drop the duplicate
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

// =============================================================================
// Border detection
// =============================================================================

/** 4 cardinal neighbors: [dx, dy] */
const CARDINAL = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

/** 8-connectivity neighbors for chain tracing: [dx, dy] */
const EIGHT_CONNECTED = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
] as const;

/**
 * Build a map from each pixel index to its canonical "cluster pair" key.
 * A border pixel is one where at least one cardinal neighbor has a different label.
 * Edge pixels (x=0, x=TW-1, y=0, y=TH-1) are skipped.
 *
 * The canonical key is "min:max" of the two labels (current + first differing neighbor).
 */
function detectBorderPixels(
  labels: Uint8Array,
  TW: number,
  TH: number,
): Map<number, string> {
  const borderMap = new Map<number, string>();

  for (let y = 1; y < TH - 1; y++) {
    for (let x = 1; x < TW - 1; x++) {
      const idx = y * TW + x;
      const label = labels[idx];

      for (const [dx, dy] of CARDINAL) {
        const nx = x + dx;
        const ny = y + dy;
        const nLabel = labels[ny * TW + nx];
        if (nLabel !== label) {
          const lo = Math.min(label, nLabel);
          const hi = Math.max(label, nLabel);
          borderMap.set(idx, `${lo}:${hi}`);
          break; // first differing neighbor wins
        }
      }
    }
  }

  return borderMap;
}

// =============================================================================
// Chain tracing
// =============================================================================

/**
 * Starting from `startIdx`, walk 8-connected border pixels that share the same
 * cluster-pair key and have not yet been visited. Returns an ordered sequence of
 * pixel coordinates [x, y].
 */
function chainTrace(
  startIdx: number,
  pairKey: string,
  borderMap: Map<number, string>,
  visited: Set<number>,
  TW: number,
): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  const stack: number[] = [startIdx];

  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (visited.has(idx)) continue;
    visited.add(idx);

    const x = idx % TW;
    const y = (idx - x) / TW;
    path.push([x, y]);

    for (const [dx, dy] of EIGHT_CONNECTED) {
      const nIdx = (y + dy) * TW + (x + dx);
      if (!visited.has(nIdx) && borderMap.get(nIdx) === pairKey) {
        stack.push(nIdx);
      }
    }
  }

  return path;
}

// =============================================================================
// Public API
// =============================================================================

const DP_TOLERANCE = 1.5;

/** Group pixel indices from borderMap by their cluster-pair key. */
function groupBorderPixels(borderMap: Map<number, string>): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const [idx, key] of borderMap) {
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(idx);
  }
  return groups;
}

/** Parse a "lo:hi" cluster-pair key and determine border type. */
function parsePairKey(key: string): { lo: number; hi: number; type: 'internal' | 'external' } {
  const [loStr, hiStr] = key.split(':');
  const lo = parseInt(loStr, 10);
  const hi = parseInt(hiStr, 10);
  return { lo, hi, type: hi === 255 ? 'external' : 'internal' };
}

/** Trace all connected components in a single cluster-pair group. */
function traceGroup(
  key: string,
  pixels: number[],
  borderMap: Map<number, string>,
  visited: Set<number>,
  TW: number,
  nextId: { value: number },
): BorderPath[] {
  const paths: BorderPath[] = [];
  const { lo, hi, type } = parsePairKey(key);

  for (const startIdx of pixels) {
    if (visited.has(startIdx)) continue;

    const raw = chainTrace(startIdx, key, borderMap, visited, TW);
    if (raw.length < 2) continue;

    const simplified = douglasPeucker(raw, DP_TOLERANCE);
    if (simplified.length < 2) continue;

    paths.push({
      id: `bp-${nextId.value++}`,
      points: simplified,
      type,
      clusters: [lo, hi],
    });
  }

  return paths;
}

/**
 * Trace all border paths in the pixel label map.
 *
 * Steps:
 * 1. Detect border pixels (excluding edge pixels).
 * 2. Group by canonical cluster-pair key.
 * 3. Chain-trace each connected component within a group.
 * 4. Classify as internal (cluster↔cluster) or external (cluster↔background 255).
 * 5. Simplify each path with Douglas-Peucker (tolerance 1.5).
 */
export function traceBorderPaths(
  pixelLabels: Uint8Array,
  TW: number,
  TH: number,
  minPathPoints = 10,
): BorderPath[] {
  const borderMap = detectBorderPixels(pixelLabels, TW, TH);
  if (borderMap.size === 0) return [];

  const groups = groupBorderPixels(borderMap);
  const visited = new Set<number>();
  const nextId = { value: 0 };
  const paths: BorderPath[] = [];

  for (const [key, pixels] of groups) {
    paths.push(...traceGroup(key, pixels, borderMap, visited, TW, nextId));
  }

  // Filter out tiny fragments — real borders are long paths, artifacts are short
  if (minPathPoints > 0) {
    const filtered = paths.filter(p => p.points.length >= minPathPoints);
    console.log(`  [Borders] Filtered: ${paths.length} → ${filtered.length} paths (removed ${paths.length - filtered.length} short fragments < ${minPathPoints} pts)`);
    return filtered;
  }
  return paths;
}
