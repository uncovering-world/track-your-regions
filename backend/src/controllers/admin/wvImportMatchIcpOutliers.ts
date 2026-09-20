/**
 * Which divisions the ICP is allowed to fit against.
 *
 * A region's GADM bounding box is only as good as the divisions inside it: an
 * overseas department, an island group or a sliver that overlaps its
 * neighbours stretches the box over open sea, and the alignment that follows
 * is fitted to nothing. These helpers measure the box, say when it has been
 * inflated, and name the divisions to leave out of it.
 *
 * Split out of `wvImportMatchIcp.ts`, which had reached the length the lint
 * draws the line at (#933).
 */

import { parseSvgSubPaths } from './wvImportMatchSvgHelpers.js';

// =============================================================================
// Geometry helpers for ICP adjustment
// =============================================================================

export interface DivisionBbox {
  id: number;
  minX: number; maxX: number;
  minY: number; maxY: number;
  area: number;
}

/** Compute polygon area using the shoelace formula. Returns absolute area. */
export function computeShoelaceArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  return Math.abs(area) / 2;
}

/**
 * Compute polygon area from an SVG path, handling multipolygons correctly.
 * Unlike computeShoelaceArea on concatenated points, this sums per-ring areas
 * so archipelago divisions (Azores, Madeira, etc.) get correct land area
 * instead of inflated phantom-polygon area crossing oceans between islands.
 */
export function computeSvgPathArea(svgPath: string): number {
  const subPaths = parseSvgSubPaths(svgPath);
  let totalArea = 0;
  for (const pts of subPaths) {
    totalArea += computeShoelaceArea(pts);
  }
  return totalArea;
}

/** Compute the tight bounding box enclosing all divisions. */
export function computeBboxFromDivisions(
  divs: DivisionBbox[],
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const d of divs) {
    if (d.minX < minX) minX = d.minX;
    if (d.maxX > maxX) maxX = d.maxX;
    if (d.minY < minY) minY = d.minY;
    if (d.maxY > maxY) maxY = d.maxY;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Detect if ICP alignment likely failed due to bbox inflation (distant islands)
 * or other shape mismatch between GADM and CV bounding boxes.
 *
 * Six detection paths (any one triggers):
 * 1. Aspect ratio mismatch > 1.2 AND overflow > 10%
 * 2. Overflow alone > 15%
 * 3. Scale asymmetry > 1.25 AND overflow > 8%
 * 4. Scale asymmetry > 1.2 AND mean error > 2% of image — catches distorted fits
 * 5. Mean error alone > 3% of image — very poor alignment regardless of cause
 * 6. Scale asymmetry alone > 1.35 — GADM bbox aspect ratio doesn't match CV
 */
export function detectBboxInflation(
  gBbox: { minX: number; maxX: number; minY: number; maxY: number },
  cBbox: { minX: number; maxX: number; minY: number; maxY: number },
  bestOverflow: number,
  bestError: number,
  TW: number, TH: number,
): boolean {
  const gadmW = gBbox.maxX - gBbox.minX;
  const gadmH = gBbox.maxY - gBbox.minY;
  const cvW = cBbox.maxX - cBbox.minX;
  const cvH = cBbox.maxY - cBbox.minY;
  if (gadmW <= 0 || gadmH <= 0 || cvW <= 0 || cvH <= 0) return false;

  const gadmRatio = gadmW / gadmH;
  const cvRatio = cvW / cvH;
  const ratioMismatch = Math.max(gadmRatio, cvRatio) / Math.min(gadmRatio, cvRatio);
  const overflowPct = bestOverflow / Math.max(TW, TH);
  const meanErrorPct = bestError / Math.max(TW, TH);

  // Scale asymmetry: if initSx/initSy differs significantly from 1.0,
  // the GADM bbox shape doesn't match the CV bbox shape
  const scaleRatioX = cvW / gadmW;
  const scaleRatioY = cvH / gadmH;
  const scaleAsymmetry = Math.max(scaleRatioX, scaleRatioY) / Math.min(scaleRatioX, scaleRatioY);

  console.log(`  [ICP Detection] ratioMismatch=${ratioMismatch.toFixed(3)}, overflowPct=${(overflowPct * 100).toFixed(1)}%, scaleAsymmetry=${scaleAsymmetry.toFixed(3)}, meanErrorPct=${(meanErrorPct * 100).toFixed(1)}%`);

  return (ratioMismatch > 1.2 && overflowPct > 0.10)
      || (overflowPct > 0.15)
      || (scaleAsymmetry > 1.25 && overflowPct > 0.08)
      || (scaleAsymmetry > 1.2 && meanErrorPct > 0.02)
      || (meanErrorPct > 0.03)
      // Path 6: High scale asymmetry alone — GADM bbox aspect ratio doesn't match
      // CV bbox, indicating distant features (islands) stretching one axis.
      // Even if overflow/error look moderate, the alignment is distorted.
      || (scaleAsymmetry > 1.35);
}

/** Find connected components of bboxes using union-find with spatial overlap margin. */
function findSpatialComponents(
  divBboxes: DivisionBbox[],
): Map<number, number[]> {
  const spans = divBboxes.map(d => Math.max(d.maxX - d.minX, d.maxY - d.minY));
  spans.sort((a, b) => a - b);
  const margin = spans[Math.floor(spans.length / 2)] * 0.2;

  const n = divBboxes.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = divBboxes[i], b = divBboxes[j];
      if (a.maxX + margin >= b.minX && b.maxX + margin >= a.minX &&
          a.maxY + margin >= b.minY && b.maxY + margin >= a.minY) {
        parent[find(i)] = find(j);
      }
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(i);
  }
  return components;
}

/**
 * Strategy B: Find spatially disconnected island groups that inflate the GADM bbox.
 *
 * Uses connected-component analysis: divisions whose bboxes overlap (with margin)
 * form a spatial cluster. The largest cluster is the "mainland". All smaller
 * clusters whose total area < 10% of the overall area are excluded as outliers.
 * This correctly handles multi-division island groups (e.g., Madeira + Selvagens)
 * that the old per-division iterative approach couldn't remove.
 */
export function findBboxOutliers(
  divBboxes: DivisionBbox[],
  cBbox: { minX: number; maxX: number; minY: number; maxY: number },
): number[] {
  const cvW = cBbox.maxX - cBbox.minX;
  const cvH = cBbox.maxY - cBbox.minY;
  if (cvW <= 0 || cvH <= 0 || divBboxes.length < 2) return [];

  const cvRatio = cvW / cvH;
  const fullRatio = bboxRatio(computeBboxFromDivisions(divBboxes));
  if (fullRatio <= 0) return [];
  const ratioMatch = Math.max(fullRatio, cvRatio) / Math.min(fullRatio, cvRatio);
  if (ratioMatch <= 1.3) return [];

  const components = findSpatialComponents(divBboxes);
  if (components.size <= 1) return [];

  const excluded = collectOutlierIds(divBboxes, components);
  if (excluded.length === 0) return [];

  // Verify that excluding outliers actually improves the ratio match
  const newRatio = bboxRatio(computeBboxFromDivisions(divBboxes.filter(d => !excluded.includes(d.id))));
  if (newRatio <= 0) return [];
  const newMatch = Math.max(newRatio, cvRatio) / Math.min(newRatio, cvRatio);

  const mainlandSize = Math.max(...[...components.values()].map(v => v.length));
  console.log(`  [ICP Adjust B] ${components.size} spatial clusters found, mainland=${mainlandSize} divs, ${excluded.length} outlier divs in ${components.size - 1} island group(s)`);
  console.log(`  [ICP Adjust B] ratio: ${fullRatio.toFixed(3)} → ${newRatio.toFixed(3)} (cvRatio=${cvRatio.toFixed(3)}, match: ${ratioMatch.toFixed(2)} → ${newMatch.toFixed(2)})`);

  if (newMatch >= ratioMatch) {
    console.log(`  [ICP Adjust B] Excluding outliers didn't improve ratio — skipping`);
    return [];
  }

  return excluded;
}

/** Width/height ratio of a bbox, or 0 for degenerate bboxes. */
function bboxRatio(bbox: { minX: number; maxX: number; minY: number; maxY: number }): number {
  const w = bbox.maxX - bbox.minX, h = bbox.maxY - bbox.minY;
  return w > 0 && h > 0 ? w / h : 0;
}

/** Collect division IDs from non-mainland spatial components with small area. */
function collectOutlierIds(
  divBboxes: DivisionBbox[],
  components: Map<number, number[]>,
): number[] {
  const totalArea = divBboxes.reduce((sum, d) => sum + d.area, 0);

  // Largest component by count is the mainland
  let mainlandRoot = -1;
  let mainlandSize = 0;
  for (const [root, indices] of components) {
    if (indices.length > mainlandSize) {
      mainlandSize = indices.length;
      mainlandRoot = root;
    }
  }

  const excluded: number[] = [];
  for (const [root, indices] of components) {
    if (root === mainlandRoot) continue;
    const groupArea = indices.reduce((sum, i) => sum + divBboxes[i].area, 0);
    if (groupArea <= totalArea * 0.1) {
      for (const i of indices) excluded.push(divBboxes[i].id);
    }
  }
  return excluded;
}

/**
 * Strategy C: Find divisions whose centroid doesn't land on the CV mask
 * when projected using the (possibly bad) initial gadmToPixel transform.
 * Accepts pre-parsed points to keep SVG parsing in the caller.
 */
export function findOverlapOutliers(
  divPaths: Array<{ id: number; points: Array<[number, number]> }>,
  gadmToPixel: (gx: number, gy: number) => [number, number],
  icpMask: Uint8Array,
  TW: number, TH: number,
): number[] {
  const excluded: number[] = [];
  for (const d of divPaths) {
    if (d.points.length === 0) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of d.points) { cx += x; cy += y; }
    cx /= d.points.length;
    cy /= d.points.length;
    const [px, py] = gadmToPixel(cx, cy);
    const ix = Math.round(px), iy = Math.round(py);
    if (ix < 0 || ix >= TW || iy < 0 || iy >= TH || !icpMask[iy * TW + ix]) {
      excluded.push(d.id);
    }
  }
  return excluded;
}
