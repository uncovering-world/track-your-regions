import type { BorderPath } from '../../api/adminWvImportCvMatch';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OpenEndpoint {
  pathId: string;
  end: 'start' | 'end';
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// pointsToSmoothSvgPath
// Converts ordered points to a smooth SVG `d` attribute using
// Catmull-Rom → cubic Bezier conversion.
// ---------------------------------------------------------------------------

export function pointsToSmoothSvgPath(points: Array<[number, number]>): string {
  if (points.length < 2) return '';

  if (points.length === 2) {
    const [x0, y0] = points[0];
    const [x1, y1] = points[1];
    return `M ${x0} ${y0} L ${x1} ${y1}`;
  }

  // Catmull-Rom to cubic Bezier:
  // For segment from p1 to p2 (with neighbours p0 and p3):
  //   cp1 = p1 + (p2 - p0) / 6
  //   cp2 = p2 - (p3 - p1) / 6
  // For out-of-bounds neighbours we clamp to the first/last point.
  const n = points.length;
  const [x0, y0] = points[0];
  let d = `M ${x0} ${y0}`;

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, n - 1)];

    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;

    d += ` C ${round(cp1x)} ${round(cp1y)}, ${round(cp2x)} ${round(cp2y)}, ${p2[0]} ${p2[1]}`;
  }

  return d;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// findOpenEndpoints
// Finds path start/end points that are NOT junctions (not close to another
// path's endpoint).
// ---------------------------------------------------------------------------

export function findOpenEndpoints(
  paths: BorderPath[],
  junctionThreshold = 2,
): OpenEndpoint[] {
  // Collect all valid endpoints (paths with ≥ 2 points)
  const all: OpenEndpoint[] = [];
  for (const path of paths) {
    if (path.points.length < 2) continue;
    const first = path.points[0];
    const last = path.points[path.points.length - 1];
    all.push({ pathId: path.id, end: 'start', x: first[0], y: first[1] });
    all.push({ pathId: path.id, end: 'end',   x: last[0],  y: last[1] });
  }

  // An endpoint is "open" if no OTHER endpoint is within junctionThreshold
  return all.filter(ep => {
    return !all.some(other => {
      if (other.pathId === ep.pathId && other.end === ep.end) return false;
      const dx = other.x - ep.x;
      const dy = other.y - ep.y;
      return Math.sqrt(dx * dx + dy * dy) <= junctionThreshold;
    });
  });
}

// ---------------------------------------------------------------------------
// pointToSegmentDistance
// Distance from point (px, py) to line segment (ax, ay)–(bx, by),
// clamped to segment endpoints.
// ---------------------------------------------------------------------------

export function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment — return distance to the single point
    return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  }

  // Project point onto the line, clamped to [0, 1]
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

// ---------------------------------------------------------------------------
// rasterizeBorderPaths
// Creates a temporary canvas, strokes all border paths scaled from pipeline
// to display coords. Returns ImageData for flood fill.
// Not tested (requires browser canvas environment).
// ---------------------------------------------------------------------------

export function rasterizeBorderPaths(
  paths: BorderPath[],
  displayWidth: number,
  displayHeight: number,
  pipelineWidth: number,
  pipelineHeight: number,
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = displayWidth;
  canvas.height = displayHeight;
  const ctx = canvas.getContext('2d')!;

  const scaleX = displayWidth / pipelineWidth;
  const scaleY = displayHeight / pipelineHeight;

  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.strokeStyle = 'rgb(21, 101, 192)';
  ctx.lineWidth = Math.max(2, 3 * scaleX);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const path of paths) {
    if (path.points.length < 2) continue;

    // Build scaled SVG path and draw via Path2D
    const scaled = path.points.map(([x, y]): [number, number] => [x * scaleX, y * scaleY]);
    const d = pointsToSmoothSvgPath(scaled);
    ctx.stroke(new Path2D(d));
  }

  return ctx.getImageData(0, 0, displayWidth, displayHeight);
}

// ---------------------------------------------------------------------------
// findEraserIntersection
// Check if eraser circle intersects any segment of a path.
// Returns the index of the first hit segment, or null.
// ---------------------------------------------------------------------------

export function findEraserIntersection(
  eraserX: number,
  eraserY: number,
  eraserRadius: number,
  pathPoints: Array<[number, number]>,
): number | null {
  for (let i = 0; i < pathPoints.length - 1; i++) {
    const [ax, ay] = pathPoints[i];
    const [bx, by] = pathPoints[i + 1];
    const dist = pointToSegmentDistance(eraserX, eraserY, ax, ay, bx, by);
    if (dist <= eraserRadius) return i;
  }
  return null;
}
