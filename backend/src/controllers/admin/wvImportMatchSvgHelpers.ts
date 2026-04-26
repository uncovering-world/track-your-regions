/**
 * SVG path parsing and resampling helpers for division matching.
 *
 * Pure functions for converting PostGIS ST_AsSVG output into coordinate arrays.
 * Used by the ICP alignment and division assignment phases.
 */

/** Parse SVG path string (from ST_AsSVG) into [x, y] coordinates */
export function parseSvgPathPoints(d: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const parts = d.replace(/[MLZmlz]/g, ' ').trim().split(/\s+/);
  for (let i = 0; i < parts.length - 1; i += 2) {
    const x = parseFloat(parts[i]), y = parseFloat(parts[i + 1]);
    if (!isNaN(x) && !isNaN(y)) points.push([x, y]);
  }
  return points;
}

/** Parse SVG path into separate subpaths (handles multipolygons: M...Z M...Z) */
export function parseSvgSubPaths(d: string): Array<Array<[number, number]>> {
  const subPaths: Array<Array<[number, number]>> = [];
  for (const seg of d.split(/(?=[Mm])/)) {
    const parts = seg.replace(/[MLZmlz]/g, ' ').trim().split(/\s+/);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < parts.length - 1; i += 2) {
      const x = parseFloat(parts[i]), y = parseFloat(parts[i + 1]);
      if (!isNaN(x) && !isNaN(y)) pts.push([x, y]);
    }
    if (pts.length >= 2) subPaths.push(pts);
  }
  return subPaths;
}

/** Resample a polyline to targetCount evenly-spaced points */
export function resamplePath(points: Array<[number, number]>, targetCount: number): Array<[number, number]> {
  if (points.length < 2) return points;
  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1];
    segLens.push(Math.sqrt(dx * dx + dy * dy));
    totalLen += segLens[segLens.length - 1];
  }
  const step = totalLen / targetCount;
  const result: Array<[number, number]> = [points[0]];
  let segIdx = 0, segOff = 0, dist = step;
  while (result.length < targetCount && segIdx < segLens.length) {
    const remaining = segLens[segIdx] - segOff;
    if (dist <= remaining) {
      const t = (segOff + dist) / segLens[segIdx];
      result.push([
        points[segIdx][0] + t * (points[segIdx + 1][0] - points[segIdx][0]),
        points[segIdx][1] + t * (points[segIdx + 1][1] - points[segIdx][1]),
      ]);
      segOff += dist;
      dist = step;
    } else {
      dist -= remaining;
      segIdx++;
      segOff = 0;
    }
  }
  return result;
}
