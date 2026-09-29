/**
 * The divisions drawn onto the pixel grid the clusters live on: their
 * boundaries as a wall mask, their polygons scan-line filled into a
 * per-pixel division index, and the flood fill from a centroid that stops
 * at the walls. `assignment.ts` votes each division into a cluster over them.
 */

import { parseSvgPathPoints, parseSvgSubPaths } from '../geometry/svgPath.js';

/** Rasterize line segment onto a mask buffer */
export function rasterizeLine(x0: number, y0: number, x1: number, y1: number, mask: Uint8Array, TW: number, TH: number) {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3);
  for (let s = 0; s <= steps; s++) {
    const t = steps > 0 ? s / steps : 0;
    const x = Math.round(x0 + t * (x1 - x0));
    const y = Math.round(y0 + t * (y1 - y0));
    if (x >= 0 && x < TW && y >= 0 && y < TH) mask[y * TW + x] = 1;
  }
}

/**
 * Find a free (non-wall, unlabeled) starting pixel within a search radius around (ix, iy).
 * Returns the linear index of a free pixel, or -1 if nothing suitable found.
 */
function findFreeSeedIndex(
  ix: number, iy: number, radius: number,
  walls: Uint8Array, target: Int16Array,
  TW: number, TH: number,
): number {
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = ix + dx, ny = iy + dy;
        if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
        const ni = ny * TW + nx;
        if (!walls[ni] && target[ni] === -1) return ni;
      }
    }
  }
  return -1;
}

/** Push a neighbor into the BFS queue if it is in bounds, not a wall, and unlabeled. */
function tryPushNeighbor(
  n: number, label: number, tp: number,
  walls: Uint8Array, target: Int16Array, queue: number[],
): void {
  if (n >= 0 && n < tp && !walls[n] && target[n] === -1) {
    target[n] = label;
    queue.push(n);
  }
}

/** Flood fill from a start pixel, bounded by walls */
export function floodFillDiv(
  startX: number, startY: number, label: number,
  walls: Uint8Array, target: Int16Array,
  TW: number, TH: number, pxS: (base: number) => number,
): number {
  const tp = TW * TH;
  const ix = Math.round(startX), iy = Math.round(startY);
  if (ix < 0 || ix >= TW || iy < 0 || iy >= TH) return 0;
  let startIdx = iy * TW + ix;
  if (walls[startIdx] || target[startIdx] !== -1) {
    const found = findFreeSeedIndex(ix, iy, pxS(5), walls, target, TW, TH);
    if (found < 0) return 0;
    startIdx = found;
  }
  const queue = [startIdx];
  target[startIdx] = label;
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    const col = p % TW;
    tryPushNeighbor(p - TW, label, tp, walls, target, queue);
    tryPushNeighbor(p + TW, label, tp, walls, target, queue);
    if (col > 0) tryPushNeighbor(p - 1, label, tp, walls, target, queue);
    if (col < TW - 1) tryPushNeighbor(p + 1, label, tp, walls, target, queue);
  }
  return queue.length;
}

export type GadmToPixel = (gx: number, gy: number) => [number, number];

/** Build a wall mask by rasterizing all division sub-path boundaries. */
export function buildWallMaskFromDivisions(
  divPaths: Array<{ id: number; svgPath: string }>,
  gadmToPixel: GadmToPixel,
  TW: number, TH: number,
): Uint8Array {
  const wallMask = new Uint8Array(TW * TH);
  for (const d of divPaths) {
    for (const sp of parseSvgSubPaths(d.svgPath)) {
      for (let i = 0; i < sp.length; i++) {
        const [x0, y0] = gadmToPixel(sp[i][0], sp[i][1]);
        const [x1, y1] = gadmToPixel(sp[(i + 1) % sp.length][0], sp[(i + 1) % sp.length][1]);
        rasterizeLine(x0, y0, x1, y1, wallMask, TW, TH);
      }
    }
  }
  return wallMask;
}

/** Compute the clipped [minY, maxY] vertical extent of a polygon in pixel space. */
function polygonYExtent(polyPts: Array<[number, number]>, TH: number): [number, number] {
  let polyMinY = TH, polyMaxY = 0;
  for (const [, py] of polyPts) {
    const iy = Math.round(py);
    if (iy < polyMinY) polyMinY = iy;
    if (iy > polyMaxY) polyMaxY = iy;
  }
  return [Math.max(0, polyMinY), Math.min(TH - 1, polyMaxY)];
}

/** Fill a single scan-line of a polygon into `divisionMap` with label `ci`. */
function fillScanLine(
  y: number, polyPts: Array<[number, number]>, ci: number,
  divisionMap: Int16Array, TW: number,
): void {
  const intersections: number[] = [];
  for (let i = 0; i < polyPts.length; i++) {
    const [x0, y0] = polyPts[i];
    const [x1, y1] = polyPts[(i + 1) % polyPts.length];
    if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
      intersections.push(x0 + (y - y0) / (y1 - y0) * (x1 - x0));
    }
  }
  intersections.sort((a, b) => a - b);
  for (let j = 0; j + 1 < intersections.length; j += 2) {
    const xStart = Math.max(0, Math.ceil(intersections[j]));
    const xEnd = Math.min(TW - 1, Math.floor(intersections[j + 1]));
    for (let x = xStart; x <= xEnd; x++) {
      divisionMap[y * TW + x] = ci;
    }
  }
}

/** Rasterize a single polygon (as pixel-space points) into `divisionMap` with label `ci`. */
function rasterizeDivisionPolygon(
  polyPts: Array<[number, number]>,
  ci: number,
  divisionMap: Int16Array,
  TW: number, TH: number,
): void {
  const [polyMinY, polyMaxY] = polygonYExtent(polyPts, TH);
  for (let y = polyMinY; y <= polyMaxY; y++) {
    fillScanLine(y, polyPts, ci, divisionMap, TW);
  }
}

/** Build a per-pixel division-index map via scan-line fill on every division polygon. */
export function buildDivisionMap(
  divPaths: Array<{ id: number; svgPath: string }>,
  divIdToIdx: Map<number, number>,
  gadmToPixel: GadmToPixel,
  TW: number, TH: number,
): Int16Array {
  const divisionMap = new Int16Array(TW * TH).fill(-1);
  for (const dp of divPaths) {
    const ci = divIdToIdx.get(dp.id);
    if (ci === undefined) continue;
    const rawPts = parseSvgPathPoints(dp.svgPath);
    if (rawPts.length < 3) continue;
    const polyPts = rawPts.map(([gx, gy]) => gadmToPixel(gx, gy));
    rasterizeDivisionPolygon(polyPts, ci, divisionMap, TW, TH);
  }
  return divisionMap;
}
