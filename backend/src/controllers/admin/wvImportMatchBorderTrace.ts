/**
 * Border path extraction from pixel label maps using OpenCV findContours.
 *
 * For each cluster label in pixelLabels, creates a binary mask and runs
 * cv.findContours() to get the exact contour polygon. This produces clean,
 * smooth borders that match the "Detected clusters" preview exactly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const cv = G.__cv;
  if (!cv) {
    console.warn('[Borders] OpenCV not loaded — falling back to empty paths');
    return [];
  }

  // Collect unique labels (excluding background 255)
  const labels = new Set<number>();
  for (let i = 0; i < pixelLabels.length; i++) {
    if (pixelLabels[i] !== 255) labels.add(pixelLabels[i]);
  }

  const paths: BorderPath[] = [];
  let nextId = 0;

  for (const label of labels) {
    // Create binary mask for this cluster: 255 where label matches, 0 elsewhere
    const maskData = new Uint8Array(TW * TH);
    for (let i = 0; i < pixelLabels.length; i++) {
      maskData[i] = pixelLabels[i] === label ? 255 : 0;
    }

    const mat = new cv.Mat(TH, TW, cv.CV_8UC1);
    mat.data.set(maskData);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();

    cv.findContours(mat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

    for (let c = 0; c < contours.size(); c++) {
      const contour = contours.get(c);
      const numPoints = contour.rows;
      if (numPoints < 4) continue;

      // Extract contour points
      const raw: Array<[number, number]> = [];
      for (let p = 0; p < numPoints; p++) {
        const x = contour.intAt(p * 2);
        const y = contour.intAt(p * 2 + 1);
        raw.push([x, y]);
      }

      // Simplify
      const simplified = douglasPeucker(raw, DP_TOLERANCE);
      if (simplified.length < minPathPoints) continue;

      // Classify: sample a few contour points to see what's on the other side
      let hasExternal = false;
      let neighborLabel = -1;
      for (let si = 0; si < Math.min(10, raw.length); si += Math.max(1, Math.floor(raw.length / 10))) {
        const [cx, cy] = raw[si];
        // Check a pixel just outside the contour in each direction
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
          const nLabel = pixelLabels[ny * TW + nx];
          if (nLabel === label) continue;
          if (nLabel === 255) { hasExternal = true; }
          else if (neighborLabel === -1) { neighborLabel = nLabel; }
        }
      }

      const type = hasExternal && neighborLabel === -1 ? 'external' : 'internal';
      const clusterB = neighborLabel >= 0 ? neighborLabel : 255;

      paths.push({
        id: `bp-${nextId++}`,
        points: simplified,
        type,
        clusters: [Math.min(label, clusterB), Math.max(label, clusterB)],
      });
    }

    // Clean up OpenCV objects
    contours.delete();
    hierarchy.delete();
    mat.delete();
  }

  console.log(`  [Borders] Extracted ${paths.length} contour paths from ${labels.size} clusters via OpenCV findContours`);
  return paths;
}
