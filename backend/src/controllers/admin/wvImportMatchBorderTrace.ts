/**
 * Border path extraction from pixel label maps using OpenCV findContours.
 *
 * For each cluster label in pixelLabels, creates a binary mask and runs
 * cv.findContours() to get the exact contour polygon. This produces clean,
 * smooth borders that match the "Detected clusters" preview exactly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenCV.js (__cv global) has no TypeScript types
const G = globalThis as unknown as { __cv?: any };

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

function perpendicularDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(dx * dx + dy * dy);
}

export function douglasPeucker(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

// =============================================================================
// OpenCV contour-based border extraction
// =============================================================================

const DP_TOLERANCE = 1.5;

function collectClusterLabels(pixelLabels: Uint8Array): Set<number> {
  const labels = new Set<number>();
  for (let i = 0; i < pixelLabels.length; i++) {
    if (pixelLabels[i] !== 255) labels.add(pixelLabels[i]);
  }
  return labels;
}

function buildBinaryMask(pixelLabels: Uint8Array, label: number): Uint8Array {
  const mask = new Uint8Array(pixelLabels.length);
  for (let i = 0; i < pixelLabels.length; i++) {
    mask[i] = pixelLabels[i] === label ? 255 : 0;
  }
  return mask;
}

function readContourPoints(contour: { intAt: (i: number) => number; rows: number }): Array<[number, number]> {
  const raw: Array<[number, number]> = [];
  for (let p = 0; p < contour.rows; p++) {
    raw.push([contour.intAt(p * 2), contour.intAt(p * 2 + 1)]);
  }
  return raw;
}

const NEIGHBOR_OFFSETS: Array<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

interface ClassifyResult {
  hasExternal: boolean;
  neighborLabel: number;
}

function classifyContourNeighbors(
  raw: Array<[number, number]>,
  pixelLabels: Uint8Array,
  TW: number,
  TH: number,
  selfLabel: number,
): ClassifyResult {
  let hasExternal = false;
  let neighborLabel = -1;
  const sampleStep = Math.max(1, Math.floor(raw.length / 10));
  const sampleCount = Math.min(10, raw.length);
  for (let i = 0; i < sampleCount; i++) {
    const si = Math.min(i * sampleStep, raw.length - 1);
    const [cx, cy] = raw[si];
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
      const nLabel = pixelLabels[ny * TW + nx];
      if (nLabel === selfLabel) continue;
      if (nLabel === 255) {
        hasExternal = true;
      } else if (neighborLabel === -1) {
        neighborLabel = nLabel;
      }
    }
  }
  return { hasExternal, neighborLabel };
}

interface ContourBuildContext {
  pixelLabels: Uint8Array;
  TW: number;
  TH: number;
  minPathPoints: number;
  label: number;
}

function buildBorderPathFromContour(
  contour: { intAt: (i: number) => number; rows: number },
  ctx: ContourBuildContext,
  pathId: string,
): BorderPath | null {
  if (contour.rows < 4) return null;
  const raw = readContourPoints(contour);
  const simplified = douglasPeucker(raw, DP_TOLERANCE);
  if (simplified.length < ctx.minPathPoints) return null;

  const { hasExternal, neighborLabel } = classifyContourNeighbors(
    raw,
    ctx.pixelLabels,
    ctx.TW,
    ctx.TH,
    ctx.label,
  );
  const type = hasExternal && neighborLabel === -1 ? 'external' : 'internal';
  const clusterB = neighborLabel >= 0 ? neighborLabel : 255;
  return {
    id: pathId,
    points: simplified,
    type,
    clusters: [Math.min(ctx.label, clusterB), Math.max(ctx.label, clusterB)],
  };
}

function processClusterContours(
  ctx: ContourBuildContext,
  paths: BorderPath[],
  nextIdRef: { value: number },
): void {
  const cv = G.__cv;
  if (!cv) return;

  const maskData = buildBinaryMask(ctx.pixelLabels, ctx.label);
  // OpenCV.js wraps native WASM memory; every cv.Mat / MatVector / Mat-from-get
  // must be explicitly .delete()'d. The try/finally pairs guarantee release
  // even when findContours or the contour loop throws.
  const mat = new cv.Mat(ctx.TH, ctx.TW, cv.CV_8UC1);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    mat.data.set(maskData);
    cv.findContours(mat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

    for (let c = 0; c < contours.size(); c++) {
      const contour = contours.get(c);
      try {
        const path = buildBorderPathFromContour(contour, ctx, `bp-${nextIdRef.value}`);
        if (path) {
          paths.push(path);
          nextIdRef.value++;
        }
      } finally {
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
    mat.delete();
  }
}

/**
 * Extract border paths using OpenCV findContours on each cluster's binary mask.
 *
 * For each unique cluster label (excluding 255/background), creates a binary
 * mask and runs findContours to get the exact region outline. The contour
 * is classified as internal or external based on whether adjacent pixels
 * at the contour boundary belong to another cluster or to background.
 */
export function traceBorderPaths(
  pixelLabels: Uint8Array,
  TW: number,
  TH: number,
  minPathPoints = 5,
): BorderPath[] {
  if (!G.__cv) {
    console.warn('[Borders] OpenCV not loaded — falling back to empty paths');
    return [];
  }

  const labels = collectClusterLabels(pixelLabels);
  const paths: BorderPath[] = [];
  const nextIdRef = { value: 0 };

  for (const label of labels) {
    processClusterContours({ pixelLabels, TW, TH, minPathPoints, label }, paths, nextIdRef);
  }

  console.log(`  [Borders] Extracted ${paths.length} contour paths from ${labels.size} clusters via OpenCV findContours`);
  return paths;
}
