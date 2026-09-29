/**
 * Division-to-cluster assignment phase for division matching.
 *
 * Rasterizes GADM division boundaries onto the pixel grid, flood-fills from
 * centroids to assign pixels to divisions, then votes each division into
 * its dominant color cluster. Handles recursive splitting for divisions
 * that span multiple clusters. The rasterising is `divisionRaster.ts`.
 */

import sharp from 'sharp';
import { parseSvgSubPaths } from '../geometry/svgPath.js';
import {
  buildDivisionMap,
  buildWallMaskFromDivisions,
  floodFillDiv,
  rasterizeLine,
  type GadmToPixel,
} from './divisionRaster.js';

// =============================================================================
// Types
// =============================================================================

export interface AssignmentParams {
  /** Division SVG paths from PostGIS */
  divPaths: Array<{ id: number; svgPath: string }>;
  /** Division centroids with assignment status */
  centroids: Array<{ id: number; cx: number; cy: number; assigned: { regionId: number; regionName: string } | null }>;
  /** Division name lookup */
  divNameMap: Map<number, string>;
  /** Transform GADM coordinates to pixel space */
  gadmToPixel: (gx: number, gy: number) => [number, number];
  /** Pixel labels from clustering */
  pixelLabels: Uint8Array;
  /** Raw image buffer */
  buf: Buffer;
  /** Color centroids per cluster */
  colorCentroids: Array<[number, number, number] | null>;
  /** Country pixel mask */
  /** Country pixel count */
  countrySize: number;
  /** Image dimensions */
  TW: number; TH: number;
  /** Original image dimensions (for upscaling debug images) */
  origW: number; origH: number;
  /** Calibrated pixel scale function */
  pxS: (base: number) => number;
  /** Logging callbacks */
  logStep: (msg: string) => Promise<void>;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
  /** Reads the GADM children of the divisions a split recurses into */
  loadChildDivisions: LoadChildDivisions;
}

/** A GADM child of a division being split, with its centroid and outline. */
export interface ChildDivision {
  id: number; parentId: number; name: string;
  cx: number; cy: number; svgPath: string;
}

/** Reads the children of `parentIds` that have a medium-resolution outline. */
export type LoadChildDivisions = (parentIds: number[]) => Promise<ChildDivision[]>;

export interface DivAssignment {
  divisionId: number;
  clusterId: number;
  confidence: number;
  isSplit: boolean;
  splitClusters?: Array<{ clusterId: number; share: number }>;
}

export interface FinalDivAssignment {
  divisionId: number; clusterId: number; confidence: number;
  depth: number; parentDivisionId?: number;
}

export interface AssignmentResult {
  /** Per-division assignments from initial voting */
  divAssignments: DivAssignment[];
  /** Resolved assignments (including recursive splits) */
  finalAssignments: FinalDivAssignment[];
  /** Divisions that couldn't be split further */
  unsplittableDivs: Array<FinalDivAssignment & { splitClusters: Array<{ clusterId: number; share: number }> }>;
  /** Division IDs that fell outside the map coverage */
  outOfBounds: Array<{ id: number; name: string }>;
  /** Wall mask (rasterized division boundaries + sub-division walls) */
  finalWallMask: Uint8Array;
  /** Per-pixel cluster assignment after recursive resolution */
  finalPixelClusters: Int16Array;
  /** Max split depth reached */
  splitDepth: number;
}

// =============================================================================
// Internal helpers
// =============================================================================

/** Tally per-division counts of pixel cluster labels. */
function tallyDivClusterVotes(
  divisionMap: Int16Array,
  pixelLabels: Uint8Array,
  tp: number,
): Map<number, Map<number, number>> {
  const divClusterVotes = new Map<number, Map<number, number>>();
  for (let i = 0; i < tp; i++) {
    const di = divisionMap[i];
    if (di < 0 || pixelLabels[i] === 255) continue;
    if (!divClusterVotes.has(di)) divClusterVotes.set(di, new Map());
    const votes = divClusterVotes.get(di)!;
    votes.set(pixelLabels[i], (votes.get(pixelLabels[i]) || 0) + 1);
  }
  return divClusterVotes;
}

/** Tally total pixels per cluster (used to gauge whether a minority share is significant). */
function tallyClusterTotals(pixelLabels: Uint8Array, tp: number): Map<number, number> {
  const totals = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === 255) continue;
    const cl = pixelLabels[i];
    totals.set(cl, (totals.get(cl) || 0) + 1);
  }
  return totals;
}

/** Pick the nearest cluster centroid (by RGB Euclidean distance) for a single RGB triple. */
function nearestColorCluster(
  r: number, g: number, b: number,
  colorCentroids: Array<[number, number, number] | null>,
): number {
  let bestDist = Infinity, bestK = -1;
  for (let k = 0; k < colorCentroids.length; k++) {
    if (!colorCentroids[k]) continue;
    const c = colorCentroids[k]!;
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestDist) { bestDist = d; bestK = k; }
  }
  return bestK;
}

/** Find the dominant cluster + whether the division should be split. */
function summarizeVotes(
  votes: Map<number, number>,
  hasSignificantMinority: (sorted: Array<[number, number]>) => boolean,
): {
  total: number;
  sorted: Array<[number, number]>;
  dominantCluster: number;
  confidence: number;
  isSplit: boolean;
  splitClusters: Array<{ clusterId: number; share: number }>;
} {
  const total = [...votes.values()].reduce((a, b) => a + b, 0);
  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const [dominantCluster, dominantCount] = sorted[0];
  const confidence = Math.round((dominantCount / total) * 100) / 100;
  const isSplit = (confidence < 0.9 && sorted.length > 1) || hasSignificantMinority(sorted);
  const splitClusters = isSplit
    ? sorted.filter(([, c]) => c / total > 0.1).map(([cl, c]) => ({
        clusterId: cl, share: Math.round((c / total) * 100) / 100,
      }))
    : [];
  return { total, sorted, dominantCluster, confidence, isSplit, splitClusters };
}

/** Handle a division with zero cluster votes — re-sample by raw color from the polygon area. */
function assignByRawFallback(
  ci: number,
  div: AssignmentParams['centroids'][number],
  divisionMap: Int16Array,
  buf: Buffer,
  colorCentroids: Array<[number, number, number] | null>,
  gadmToPixel: GadmToPixel,
  TW: number, TH: number, tp: number,
  hasSignificantMinority: (sorted: Array<[number, number]>) => boolean,
): DivAssignment {
  const rawVotes = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (divisionMap[i] !== ci) continue;
    const bestK = nearestColorCluster(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2], colorCentroids);
    if (bestK >= 0) rawVotes.set(bestK, (rawVotes.get(bestK) || 0) + 1);
  }
  if (rawVotes.size > 0) {
    const s = summarizeVotes(rawVotes, hasSignificantMinority);
    return {
      divisionId: div.id, clusterId: s.dominantCluster,
      confidence: Math.min(s.confidence, 0.4),
      isSplit: s.isSplit,
      splitClusters: s.isSplit ? s.splitClusters : undefined,
    };
  }
  // Truly empty — centroid raw-color sample
  const [px, py] = gadmToPixel(div.cx, -div.cy);
  const ix = Math.round(px), iy = Math.round(py);
  let label = -1;
  if (ix >= 0 && ix < TW && iy >= 0 && iy < TH) {
    const baseIdx = (iy * TW + ix) * 3;
    label = nearestColorCluster(buf[baseIdx], buf[baseIdx + 1], buf[baseIdx + 2], colorCentroids);
  }
  return { divisionId: div.id, clusterId: label, confidence: label >= 0 ? 0.3 : 0, isSplit: false };
}

interface InitialAssignInput {
  centroids: AssignmentParams['centroids'];
  divNameMap: Map<number, string>;
  divisionMap: Int16Array;
  divClusterVotes: Map<number, Map<number, number>>;
  buf: Buffer;
  colorCentroids: Array<[number, number, number] | null>;
  gadmToPixel: GadmToPixel;
  TW: number; TH: number; tp: number;
  hasSignificantMinority: (sorted: Array<[number, number]>) => boolean;
}

/** Assign each division to its dominant cluster (or split). */
function computeInitialDivAssignments(input: InitialAssignInput): DivAssignment[] {
  const {
    centroids, divNameMap, divisionMap, divClusterVotes,
    buf, colorCentroids, gadmToPixel,
    TW, TH, tp, hasSignificantMinority,
  } = input;

  const divAssignments: DivAssignment[] = [];
  for (let ci = 0; ci < centroids.length; ci++) {
    const div = centroids[ci];
    const votes = divClusterVotes.get(ci);
    if (!votes || votes.size === 0) {
      divAssignments.push(assignByRawFallback(
        ci, div, divisionMap, buf, colorCentroids, gadmToPixel, TW, TH, tp, hasSignificantMinority,
      ));
      continue;
    }
    const s = summarizeVotes(votes, hasSignificantMinority);
    const divName = divNameMap.get(div.id) ?? `#${div.id}`;
    const voteStr = s.sorted.slice(0, 4).map(([cl, c]) => `c${cl}:${(c / s.total * 100).toFixed(0)}%`).join(' ');
    console.log(`  [Assign] ${divName}: ${s.isSplit ? 'SPLIT' : 'single'} conf=${s.confidence} votes=[${voteStr}] (${s.total}px)`);
    divAssignments.push({
      divisionId: div.id, clusterId: s.dominantCluster, confidence: s.confidence, isSplit: s.isSplit,
      splitClusters: s.isSplit ? s.splitClusters : undefined,
    });
  }
  return divAssignments;
}

/** Build initial pixel→cluster map from division-level assignments. */
function fillInitialPixelClusters(
  divisionMap: Int16Array,
  divAssignments: DivAssignment[],
  tp: number,
): Int16Array {
  const finalPixelClusters = new Int16Array(tp).fill(-1);
  for (let i = 0; i < tp; i++) {
    const ci = divisionMap[i];
    if (ci >= 0 && ci < divAssignments.length && divAssignments[ci].clusterId >= 0) {
      finalPixelClusters[i] = divAssignments[ci].clusterId;
    }
  }
  return finalPixelClusters;
}

interface ChildData { id: number; cx: number; cy: number; svgPath: string }

/** Fetch children for pending-split parents, update `divNameMap`, and return children grouped by parent. */
async function fetchChildrenForSplits(
  splitIds: number[],
  divNameMap: Map<number, string>,
  loadChildDivisions: LoadChildDivisions,
): Promise<Map<number, ChildData[]>> {
  const rows = await loadChildDivisions(splitIds);

  const childrenByParent = new Map<number, ChildData[]>();
  for (const r of rows) {
    const pid = r.parentId;
    const childName = r.name;
    const parentPath = divNameMap.get(pid) ?? '';
    divNameMap.set(r.id, parentPath ? `${parentPath} > ${childName}` : childName);
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid)!.push({ id: r.id, cx: r.cx, cy: r.cy, svgPath: r.svgPath });
  }
  return childrenByParent;
}

/** Rasterize a list of children's boundaries into `childWalls`. */
function buildChildWalls(
  children: ChildData[],
  gadmToPixel: GadmToPixel,
  TW: number, TH: number,
): Uint8Array {
  const childWalls = new Uint8Array(TW * TH);
  for (const child of children) {
    for (const sp of parseSvgSubPaths(child.svgPath)) {
      for (let i = 0; i < sp.length; i++) {
        const [x0, y0] = gadmToPixel(sp[i][0], sp[i][1]);
        const [x1, y1] = gadmToPixel(sp[(i + 1) % sp.length][0], sp[(i + 1) % sp.length][1]);
        rasterizeLine(x0, y0, x1, y1, childWalls, TW, TH);
      }
    }
  }
  return childWalls;
}

/** Tally per-child cluster votes from a child-index map. */
function tallyChildVotes(
  childMap: Int16Array,
  pixelLabels: Uint8Array,
  tp: number,
): Map<number, Map<number, number>> {
  const childVotes = new Map<number, Map<number, number>>();
  for (let i = 0; i < tp; i++) {
    if (childMap[i] < 0 || pixelLabels[i] === 255) continue;
    if (!childVotes.has(childMap[i])) childVotes.set(childMap[i], new Map());
    const v = childVotes.get(childMap[i])!;
    v.set(pixelLabels[i], (v.get(pixelLabels[i]) || 0) + 1);
  }
  return childVotes;
}

/**
 * Process one parent's children at a split depth:
 *  - build walls + flood-fill into a child-index map
 *  - tally votes per child
 *  - decide each child as resolved or needing further split
 *  - merge cluster choices into the global pixel-cluster + wall maps
 */
function resolveOneParentSplit(
  parentId: number,
  parentSplit: DivAssignment | undefined,
  children: ChildData[],
  params: {
    pixelLabels: Uint8Array;
    gadmToPixel: GadmToPixel;
    TW: number; TH: number; tp: number;
    pxS: (base: number) => number;
    hasSignificantMinority: (sorted: Array<[number, number]>) => boolean;
    splitDepth: number;
    finalAssignments: FinalDivAssignment[];
    nextPending: DivAssignment[];
    finalPixelClusters: Int16Array;
    finalWallMask: Uint8Array;
  },
): void {
  const {
    pixelLabels, gadmToPixel, TW, TH, tp, pxS, hasSignificantMinority,
    splitDepth, finalAssignments, nextPending, finalPixelClusters, finalWallMask,
  } = params;

  const childWalls = buildChildWalls(children, gadmToPixel, TW, TH);
  const childMap = new Int16Array(tp).fill(-1);
  for (let chi = 0; chi < children.length; chi++) {
    const [px, py] = gadmToPixel(children[chi].cx, -children[chi].cy);
    floodFillDiv(px, py, chi, childWalls, childMap, TW, TH, pxS);
  }
  const childVotes = tallyChildVotes(childMap, pixelLabels, tp);
  const childClusters: number[] = new Array(children.length).fill(-1);

  for (let chi = 0; chi < children.length; chi++) {
    const votes = childVotes.get(chi);
    if (!votes || votes.size === 0) {
      const cl = parentSplit?.clusterId ?? -1;
      childClusters[chi] = cl;
      finalAssignments.push({
        divisionId: children[chi].id, clusterId: cl,
        confidence: 0, depth: splitDepth, parentDivisionId: parentId,
      });
      continue;
    }
    const s = summarizeVotes(votes, hasSignificantMinority);
    childClusters[chi] = s.dominantCluster;
    if (s.isSplit) {
      nextPending.push({
        divisionId: children[chi].id, clusterId: s.dominantCluster, confidence: s.confidence,
        isSplit: true, splitClusters: s.splitClusters,
      });
    } else {
      finalAssignments.push({
        divisionId: children[chi].id, clusterId: s.dominantCluster,
        confidence: s.confidence, depth: splitDepth, parentDivisionId: parentId,
      });
    }
  }

  for (let i = 0; i < tp; i++) {
    if (childMap[i] >= 0 && childClusters[childMap[i]] >= 0) {
      finalPixelClusters[i] = childClusters[childMap[i]];
    }
    if (childWalls[i]) finalWallMask[i] = 1;
  }
}

interface RecursiveSplitParams {
  divAssignments: DivAssignment[];
  wallMask: Uint8Array;
  divisionMap: Int16Array;
  divNameMap: Map<number, string>;
  pixelLabels: Uint8Array;
  gadmToPixel: GadmToPixel;
  TW: number; TH: number; tp: number;
  pxS: (base: number) => number;
  hasSignificantMinority: (sorted: Array<[number, number]>) => boolean;
  logStep: (msg: string) => Promise<void>;
  loadChildDivisions: LoadChildDivisions;
}

interface RecursiveSplitResult {
  finalAssignments: FinalDivAssignment[];
  unsplittableDivs: Array<FinalDivAssignment & { splitClusters: Array<{ clusterId: number; share: number }> }>;
  finalPixelClusters: Int16Array;
  finalWallMask: Uint8Array;
  splitDepth: number;
}

/** Resolve divisions that span multiple clusters by recursing into their GADM children. */
async function resolveRecursiveSplits(p: RecursiveSplitParams): Promise<RecursiveSplitResult> {
  const {
    divAssignments, wallMask, divisionMap, divNameMap,
    pixelLabels, gadmToPixel, TW, TH, tp, pxS, hasSignificantMinority, logStep, loadChildDivisions,
  } = p;

  const finalPixelClusters = fillInitialPixelClusters(divisionMap, divAssignments, tp);
  const finalWallMask = new Uint8Array(wallMask);
  const finalAssignments: FinalDivAssignment[] = [];
  const unsplittableDivs: Array<FinalDivAssignment & {
    splitClusters: Array<{ clusterId: number; share: number }>;
  }> = [];

  for (const a of divAssignments) {
    if (!a.isSplit) {
      finalAssignments.push({ divisionId: a.divisionId, clusterId: a.clusterId, confidence: a.confidence, depth: 0 });
    }
  }

  let pendingSplits = divAssignments.filter(a => a.isSplit);
  let splitDepth = 0;
  while (pendingSplits.length > 0 && splitDepth < 4) {
    splitDepth++;
    const splitIds = pendingSplits.map(s => s.divisionId);
    await logStep(`Split depth ${splitDepth}: resolving ${splitIds.length} divisions...`);

    const childrenByParent = await fetchChildrenForSplits(splitIds, divNameMap, loadChildDivisions);

    // Capture parents that have no GADM children — they can't be split further
    for (const s of pendingSplits) {
      if (!childrenByParent.has(s.divisionId)) {
        unsplittableDivs.push({
          divisionId: s.divisionId, clusterId: s.clusterId,
          confidence: s.confidence, depth: splitDepth - 1,
          splitClusters: s.splitClusters ?? [],
        });
      }
    }

    const nextPending: DivAssignment[] = [];
    for (const [parentId, children] of childrenByParent) {
      const parentSplit = pendingSplits.find(s => s.divisionId === parentId);
      resolveOneParentSplit(parentId, parentSplit, children, {
        pixelLabels, gadmToPixel, TW, TH, tp, pxS, hasSignificantMinority,
        splitDepth, finalAssignments, nextPending, finalPixelClusters, finalWallMask,
      });
    }
    pendingSplits = nextPending;
  }

  // Remaining unresolved splits
  for (const s of pendingSplits) {
    unsplittableDivs.push({
      divisionId: s.divisionId, clusterId: s.clusterId,
      confidence: s.confidence, depth: splitDepth,
      splitClusters: s.splitClusters ?? [],
    });
  }

  return { finalAssignments, unsplittableDivs, finalPixelClusters, finalWallMask, splitDepth };
}

/** Blend cluster colors into the base buffer (50% base / 50% centroid). */
function blendClusterColorsIntoBuffer(
  assignBuf: Buffer, buf: Buffer,
  finalPixelClusters: Int16Array,
  colorCentroids: Array<[number, number, number] | null>,
  tp: number,
): void {
  for (let i = 0; i < tp; i++) {
    const cl = finalPixelClusters[i];
    if (cl >= 0 && colorCentroids[cl]) {
      const c = colorCentroids[cl]!;
      assignBuf[i * 3] = Math.round(buf[i * 3] * 0.5 + c[0] * 0.5);
      assignBuf[i * 3 + 1] = Math.round(buf[i * 3 + 1] * 0.5 + c[1] * 0.5);
      assignBuf[i * 3 + 2] = Math.round(buf[i * 3 + 2] * 0.5 + c[2] * 0.5);
    }
  }
}

/** Paint wall pixels dark gray directly onto the assign buffer. */
function paintWallsIntoBuffer(assignBuf: Buffer, finalWallMask: Uint8Array, tp: number): void {
  for (let i = 0; i < tp; i++) {
    if (finalWallMask[i]) {
      assignBuf[i * 3] = 40; assignBuf[i * 3 + 1] = 40; assignBuf[i * 3 + 2] = 40;
    }
  }
}

/** Draw a solid disc at (ix, iy) with the given color. */
function paintCentroidMarker(
  assignBuf: Buffer, ix: number, iy: number,
  color: [number, number, number], TW: number, TH: number,
): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dy * dy > 16) continue;
      const x = ix + dx, y = iy + dy;
      if (x < 0 || x >= TW || y < 0 || y >= TH) continue;
      const idx = (y * TW + x) * 3;
      assignBuf[idx] = color[0]; assignBuf[idx + 1] = color[1]; assignBuf[idx + 2] = color[2];
    }
  }
}

/** Mark split (red) and unsplittable (orange) centroids. */
function paintCentroidMarkers(
  assignBuf: Buffer,
  centroids: AssignmentParams['centroids'],
  gadmToPixel: GadmToPixel,
  splitIdSet: Set<number>,
  unsplittableIdSet: Set<number>,
  TW: number, TH: number,
): void {
  for (let ci = 0; ci < centroids.length; ci++) {
    const isUnsplittable = unsplittableIdSet.has(centroids[ci].id);
    const wasSplit = splitIdSet.has(centroids[ci].id);
    if (!isUnsplittable && !wasSplit) continue;
    const [px, py] = gadmToPixel(centroids[ci].cx, -centroids[ci].cy);
    const ix = Math.round(px), iy = Math.round(py);
    const color: [number, number, number] = isUnsplittable ? [255, 200, 0] : [255, 0, 0];
    paintCentroidMarker(assignBuf, ix, iy, color, TW, TH);
  }
}

/** Blend cluster colors, overlay walls, and mark split/unsplittable centroids. */
function drawAssignmentDebug(
  buf: Buffer,
  finalPixelClusters: Int16Array,
  finalWallMask: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  centroids: AssignmentParams['centroids'],
  gadmToPixel: GadmToPixel,
  splitIdSet: Set<number>,
  unsplittableIdSet: Set<number>,
  TW: number, TH: number, tp: number,
): Buffer {
  const assignBuf = Buffer.from(buf);
  blendClusterColorsIntoBuffer(assignBuf, buf, finalPixelClusters, colorCentroids, tp);
  paintWallsIntoBuffer(assignBuf, finalWallMask, tp);
  paintCentroidMarkers(assignBuf, centroids, gadmToPixel, splitIdSet, unsplittableIdSet, TW, TH);
  return assignBuf;
}

// =============================================================================
// Main assignment function
// =============================================================================

export async function assignDivisionsToClusters(params: AssignmentParams): Promise<AssignmentResult> {
  const {
    divPaths, centroids, divNameMap, gadmToPixel,
    pixelLabels, buf, colorCentroids, countrySize,
    TW, TH, origW, origH,
    pxS, logStep, pushDebugImage, loadChildDivisions,
  } = params;

  const tp = TW * TH;

  const wallMask = buildWallMaskFromDivisions(divPaths, gadmToPixel, TW, TH);

  const divIdToIdx = new Map<number, number>();
  for (let ci = 0; ci < centroids.length; ci++) divIdToIdx.set(centroids[ci].id, ci);

  const divisionMap = buildDivisionMap(divPaths, divIdToIdx, gadmToPixel, TW, TH);
  console.log(`  [CV] Division assignment: polygon rasterization (${divPaths.length} polygons)`);

  const divClusterVotes = tallyDivClusterVotes(divisionMap, pixelLabels, tp);
  const clusterTotalPixels = tallyClusterTotals(pixelLabels, tp);

  /** Check if any minority cluster would lose a significant portion of its area */
  const hasSignificantMinority = (sorted: Array<[number, number]>) => {
    for (let si = 1; si < sorted.length; si++) {
      const [minCluster, minCount] = sorted[si];
      const clusterTotal = clusterTotalPixels.get(minCluster) || 0;
      if (clusterTotal < countrySize * 0.01) continue;
      if (minCount / clusterTotal > 0.15) return true;
    }
    return false;
  };

  const divAssignments = computeInitialDivAssignments({
    centroids, divNameMap, divisionMap, divClusterVotes,
    buf, colorCentroids, gadmToPixel,
    TW, TH, tp, hasSignificantMinority,
  });

  const cvOutOfBounds: Array<{ id: number; name: string }> = [];

  const splitResult = await resolveRecursiveSplits({
    divAssignments, wallMask, divisionMap, divNameMap,
    pixelLabels, gadmToPixel, TW, TH, tp, pxS, hasSignificantMinority, logStep, loadChildDivisions,
  });
  const { finalAssignments, unsplittableDivs, finalPixelClusters, finalWallMask, splitDepth } = splitResult;

  console.log(`  Assignment: ${finalAssignments.length} resolved, ${unsplittableDivs.length} unsplittable, ${splitDepth} depth levels`);

  // Debug image: Final division assignment overlaid on source map
  const splitIdSet = new Set(divAssignments.filter(a => a.isSplit).map(a => a.divisionId));
  const unsplittableIdSet = new Set(unsplittableDivs.map(u => u.divisionId));
  const assignBuf = drawAssignmentDebug(
    buf, finalPixelClusters, finalWallMask, colorCentroids,
    centroids, gadmToPixel, splitIdSet, unsplittableIdSet,
    TW, TH, tp,
  );
  const assignPng = await sharp(assignBuf, { raw: { width: TW, height: TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await pushDebugImage(
    `Step 4: Division → cluster assignment (${finalAssignments.length} resolved, ${unsplittableDivs.length} unsplittable, depth ${splitDepth})`,
    `data:image/png;base64,${assignPng.toString('base64')}`,
  );

  return {
    divAssignments,
    finalAssignments,
    unsplittableDivs,
    outOfBounds: cvOutOfBounds,
    finalWallMask,
    finalPixelClusters,
    splitDepth,
  };
}
