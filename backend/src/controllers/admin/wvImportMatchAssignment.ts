/**
 * Division-to-cluster assignment phase for division matching.
 *
 * Rasterizes GADM division boundaries onto the pixel grid, flood-fills from
 * centroids to assign pixels to divisions, then votes each division into
 * its dominant color cluster. Handles recursive splitting for divisions
 * that span multiple clusters.
 */

import sharp from 'sharp';
import { pool } from '../../db/index.js';
import { parseSvgPathPoints, parseSvgSubPaths } from './wvImportMatchSvgHelpers.js';

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
}

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

/** Rasterize line segment onto a mask buffer */
function rasterizeLine(x0: number, y0: number, x1: number, y1: number, mask: Uint8Array, TW: number, TH: number) {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3);
  for (let s = 0; s <= steps; s++) {
    const t = steps > 0 ? s / steps : 0;
    const x = Math.round(x0 + t * (x1 - x0));
    const y = Math.round(y0 + t * (y1 - y0));
    if (x >= 0 && x < TW && y >= 0 && y < TH) mask[y * TW + x] = 1;
  }
}

/** Flood fill from a start pixel, bounded by walls */
function floodFillDiv(
  startX: number, startY: number, label: number,
  walls: Uint8Array, target: Int16Array,
  TW: number, TH: number, pxS: (base: number) => number,
): number {
  const tp = TW * TH;
  const ix = Math.round(startX), iy = Math.round(startY);
  if (ix < 0 || ix >= TW || iy < 0 || iy >= TH) return 0;
  let startIdx = iy * TW + ix;
  if (walls[startIdx] || target[startIdx] !== -1) {
    let found = false;
    const WALL_SEARCH_R = pxS(5);
    for (let r = 1; r <= WALL_SEARCH_R && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const nx = ix + dx, ny = iy + dy;
          if (nx >= 0 && nx < TW && ny >= 0 && ny < TH) {
            const ni = ny * TW + nx;
            if (!walls[ni] && target[ni] === -1) { startIdx = ni; found = true; }
          }
        }
      }
    }
    if (!found) return 0;
  }
  const queue = [startIdx];
  target[startIdx] = label;
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    const col = p % TW;
    for (const n of [p - TW, p + TW]) {
      if (n >= 0 && n < tp && !walls[n] && target[n] === -1) {
        target[n] = label;
        queue.push(n);
      }
    }
    if (col > 0 && !walls[p - 1] && target[p - 1] === -1) {
      target[p - 1] = label;
      queue.push(p - 1);
    }
    if (col < TW - 1 && !walls[p + 1] && target[p + 1] === -1) {
      target[p + 1] = label;
      queue.push(p + 1);
    }
  }
  return queue.length;
}

// =============================================================================
// Main assignment function
// =============================================================================

export async function assignDivisionsToClusters(params: AssignmentParams): Promise<AssignmentResult> {
  const {
    divPaths, centroids, divNameMap, gadmToPixel,
    pixelLabels, buf, colorCentroids, countrySize,
    TW, TH, origW, origH,
    pxS, logStep, pushDebugImage,
  } = params;

  const tp = TW * TH;

  // Build wall mask from all division boundaries
  const wallMask = new Uint8Array(tp);
  for (const d of divPaths) {
    for (const sp of parseSvgSubPaths(d.svgPath)) {
      for (let i = 0; i < sp.length; i++) {
        const [x0, y0] = gadmToPixel(sp[i][0], sp[i][1]);
        const [x1, y1] = gadmToPixel(sp[(i + 1) % sp.length][0], sp[(i + 1) % sp.length][1]);
        rasterizeLine(x0, y0, x1, y1, wallMask, TW, TH);
      }
    }
  }

  // Assign pixels to divisions via polygon rasterization: transform each GADM
  // division polygon to pixel space using the ICP transform and scan-line fill it.
  const divisionMap = new Int16Array(tp).fill(-1);
  const cvOutOfBounds: Array<{ id: number; name: string }> = [];

  const divIdToIdx = new Map<number, number>();
  for (let ci = 0; ci < centroids.length; ci++) divIdToIdx.set(centroids[ci].id, ci);

  for (const dp of divPaths) {
    const ci = divIdToIdx.get(dp.id);
    if (ci === undefined) continue;

    const rawPts = parseSvgPathPoints(dp.svgPath);
    if (rawPts.length < 3) continue;
    const polyPts = rawPts.map(([gx, gy]) => gadmToPixel(gx, gy));

    let polyMinY = TH, polyMaxY = 0;
    for (const [, py] of polyPts) {
      const iy = Math.round(py);
      if (iy < polyMinY) polyMinY = iy;
      if (iy > polyMaxY) polyMaxY = iy;
    }
    polyMinY = Math.max(0, polyMinY);
    polyMaxY = Math.min(TH - 1, polyMaxY);

    for (let y = polyMinY; y <= polyMaxY; y++) {
      const intersections: number[] = [];
      for (let i = 0; i < polyPts.length; i++) {
        const [x0, y0] = polyPts[i];
        const [x1, y1] = polyPts[(i + 1) % polyPts.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          const xIntersect = x0 + (y - y0) / (y1 - y0) * (x1 - x0);
          intersections.push(xIntersect);
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
  }
  console.log(`  [CV] Division assignment: polygon rasterization (${divPaths.length} polygons)`);

  // Count cluster votes per division
  const divClusterVotes = new Map<number, Map<number, number>>();
  for (let i = 0; i < tp; i++) {
    const di = divisionMap[i];
    if (di < 0 || pixelLabels[i] === 255) continue;
    if (!divClusterVotes.has(di)) divClusterVotes.set(di, new Map());
    const votes = divClusterVotes.get(di)!;
    votes.set(pixelLabels[i], (votes.get(pixelLabels[i]) || 0) + 1);
  }

  // Total pixel count per cluster — used to check if a division's minority portion
  // covers a significant share of that cluster's area (force split even if >90% dominant)
  const clusterTotalPixels = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === 255) continue;
    const cl = pixelLabels[i];
    clusterTotalPixels.set(cl, (clusterTotalPixels.get(cl) || 0) + 1);
  }

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

  // Assign each division to dominant cluster, detect splits
  const divAssignments: DivAssignment[] = [];
  const splitDivisionIds: number[] = [];

  for (let ci = 0; ci < centroids.length; ci++) {
    const div = centroids[ci];
    const votes = divClusterVotes.get(ci);
    if (!votes || votes.size === 0) {
      // Fallback: sample raw image colors from flood-filled area
      const rawVotes = new Map<number, number>();
      for (let i = 0; i < tp; i++) {
        if (divisionMap[i] !== ci) continue;
        const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
        let bestDist = Infinity, bestK = 0;
        for (let k = 0; k < colorCentroids.length; k++) {
          if (!colorCentroids[k]) continue;
          const d = (r - colorCentroids[k]![0]) ** 2 + (g - colorCentroids[k]![1]) ** 2 + (b - colorCentroids[k]![2]) ** 2;
          if (d < bestDist) { bestDist = d; bestK = k; }
        }
        rawVotes.set(bestK, (rawVotes.get(bestK) || 0) + 1);
      }
      if (rawVotes.size > 0) {
        const total = [...rawVotes.values()].reduce((a, b) => a + b, 0);
        const sorted = [...rawVotes.entries()].sort((a, b) => b[1] - a[1]);
        const [dominantCluster, dominantCount] = sorted[0];
        const confidence = Math.round((dominantCount / total) * 100) / 100;
        const isSplit = (confidence < 0.9 && sorted.length > 1) || hasSignificantMinority(sorted);
        if (isSplit) splitDivisionIds.push(div.id);
        divAssignments.push({
          divisionId: div.id, clusterId: dominantCluster,
          confidence: Math.min(confidence, 0.4),
          isSplit,
          splitClusters: isSplit
            ? sorted.filter(([, c]) => c / total > 0.1).map(([cl, c]) => ({ clusterId: cl, share: Math.round((c / total) * 100) / 100 }))
            : undefined,
        });
      } else {
        // Truly empty — centroid raw-color sample
        const [px, py] = gadmToPixel(div.cx, -div.cy);
        const ix = Math.round(px), iy = Math.round(py);
        let label = -1;
        if (ix >= 0 && ix < TW && iy >= 0 && iy < TH) {
          let bestDist = Infinity;
          const r = buf[(iy * TW + ix) * 3], g = buf[(iy * TW + ix) * 3 + 1], b2 = buf[(iy * TW + ix) * 3 + 2];
          for (let k = 0; k < colorCentroids.length; k++) {
            if (!colorCentroids[k]) continue;
            const d = (r - colorCentroids[k]![0]) ** 2 + (g - colorCentroids[k]![1]) ** 2 + (b2 - colorCentroids[k]![2]) ** 2;
            if (d < bestDist) { bestDist = d; label = k; }
          }
        }
        divAssignments.push({ divisionId: div.id, clusterId: label, confidence: label >= 0 ? 0.3 : 0, isSplit: false });
      }
      continue;
    }
    const total = [...votes.values()].reduce((a, b) => a + b, 0);
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [dominantCluster, dominantCount] = sorted[0];
    const confidence = Math.round((dominantCount / total) * 100) / 100;
    const isSplit = (confidence < 0.9 && sorted.length > 1) || hasSignificantMinority(sorted);
    if (isSplit) splitDivisionIds.push(div.id);
    const divName = divNameMap.get(div.id) ?? `#${div.id}`;
    const voteStr = sorted.slice(0, 4).map(([cl, c]) => `c${cl}:${(c / total * 100).toFixed(0)}%`).join(' ');
    console.log(`  [Assign] ${divName}: ${isSplit ? 'SPLIT' : 'single'} conf=${confidence} votes=[${voteStr}] (${total}px)`);
    divAssignments.push({
      divisionId: div.id, clusterId: dominantCluster, confidence, isSplit,
      splitClusters: isSplit
        ? sorted.filter(([, c]) => c / total > 0.1).map(([cl, c]) => ({
            clusterId: cl, share: Math.round((c / total) * 100) / 100,
          }))
        : undefined,
    });
  }

  // ---- Recursive split resolution ----
  const finalPixelClusters = new Int16Array(tp).fill(-1);
  const finalWallMask = new Uint8Array(wallMask);
  for (let i = 0; i < tp; i++) {
    const ci = divisionMap[i];
    if (ci >= 0 && ci < divAssignments.length && divAssignments[ci].clusterId >= 0) {
      finalPixelClusters[i] = divAssignments[ci].clusterId;
    }
  }

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

    const subResult = await pool.query(`
      SELECT id, parent_id, name,
        ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
        ST_Y(ST_Centroid(geom_simplified_medium)) AS cy,
        ST_AsSVG(geom_simplified_medium, 0, 4) AS svg_path
      FROM administrative_divisions
      WHERE parent_id = ANY($1) AND geom_simplified_medium IS NOT NULL
    `, [splitIds]);

    const childrenByParent = new Map<number, Array<{ id: number; cx: number; cy: number; svgPath: string }>>();
    for (const r of subResult.rows) {
      const pid = r.parent_id as number;
      const childName = r.name as string;
      const parentPath = divNameMap.get(pid) ?? '';
      divNameMap.set(r.id as number, parentPath ? `${parentPath} > ${childName}` : childName);
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid)!.push({
        id: r.id as number, cx: parseFloat(r.cx as string),
        cy: parseFloat(r.cy as string), svgPath: r.svg_path as string,
      });
    }

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
      const childWalls = new Uint8Array(tp);
      for (const child of children) {
        for (const sp of parseSvgSubPaths(child.svgPath)) {
          for (let i = 0; i < sp.length; i++) {
            const [x0, y0] = gadmToPixel(sp[i][0], sp[i][1]);
            const [x1, y1] = gadmToPixel(sp[(i + 1) % sp.length][0], sp[(i + 1) % sp.length][1]);
            rasterizeLine(x0, y0, x1, y1, childWalls, TW, TH);
          }
        }
      }
      const childMap = new Int16Array(tp).fill(-1);
      for (let chi = 0; chi < children.length; chi++) {
        const [px, py] = gadmToPixel(children[chi].cx, -children[chi].cy);
        floodFillDiv(px, py, chi, childWalls, childMap, TW, TH, pxS);
      }
      const childVotes = new Map<number, Map<number, number>>();
      for (let i = 0; i < tp; i++) {
        if (childMap[i] < 0 || pixelLabels[i] === 255) continue;
        if (!childVotes.has(childMap[i])) childVotes.set(childMap[i], new Map());
        const v = childVotes.get(childMap[i])!;
        v.set(pixelLabels[i], (v.get(pixelLabels[i]) || 0) + 1);
      }
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
        const total = [...votes.values()].reduce((a, b) => a + b, 0);
        const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
        const conf = Math.round((sorted[0][1] / total) * 100) / 100;
        const childIsSplit = (conf < 0.9 && sorted.length > 1) || hasSignificantMinority(sorted);
        childClusters[chi] = sorted[0][0];
        if (childIsSplit) {
          nextPending.push({
            divisionId: children[chi].id, clusterId: sorted[0][0], confidence: conf,
            isSplit: true,
            splitClusters: sorted.filter(([, c]) => c / total > 0.1).map(([cl, c]) => ({
              clusterId: cl, share: Math.round((c / total) * 100) / 100,
            })),
          });
        } else {
          finalAssignments.push({
            divisionId: children[chi].id, clusterId: sorted[0][0],
            confidence: conf, depth: splitDepth, parentDivisionId: parentId,
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

  console.log(`  Assignment: ${finalAssignments.length} resolved, ${unsplittableDivs.length} unsplittable, ${splitDepth} depth levels`);

  // Debug image: Final division assignment overlaid on source map
  const assignBuf = Buffer.from(buf);
  for (let i = 0; i < tp; i++) {
    const cl = finalPixelClusters[i];
    if (cl >= 0 && colorCentroids[cl]) {
      const c = colorCentroids[cl]!;
      assignBuf[i * 3] = Math.round(buf[i * 3] * 0.5 + c[0] * 0.5);
      assignBuf[i * 3 + 1] = Math.round(buf[i * 3 + 1] * 0.5 + c[1] * 0.5);
      assignBuf[i * 3 + 2] = Math.round(buf[i * 3 + 2] * 0.5 + c[2] * 0.5);
    }
  }
  for (let i = 0; i < tp; i++) {
    if (finalWallMask[i]) { assignBuf[i * 3] = 40; assignBuf[i * 3 + 1] = 40; assignBuf[i * 3 + 2] = 40; }
  }
  const splitIdSet = new Set(divAssignments.filter(a => a.isSplit).map(a => a.divisionId));
  const unsplittableIdSet = new Set(unsplittableDivs.map(u => u.divisionId));
  for (let ci = 0; ci < centroids.length; ci++) {
    const isUnsplittable = unsplittableIdSet.has(centroids[ci].id);
    const wasSplit = splitIdSet.has(centroids[ci].id);
    if (!isUnsplittable && !wasSplit) continue;
    const [px, py] = gadmToPixel(centroids[ci].cx, -centroids[ci].cy);
    const ix = Math.round(px), iy = Math.round(py);
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy > 16) continue;
        const x = ix + dx, y = iy + dy;
        if (x >= 0 && x < TW && y >= 0 && y < TH) {
          const idx = (y * TW + x) * 3;
          if (isUnsplittable) { assignBuf[idx] = 255; assignBuf[idx + 1] = 200; assignBuf[idx + 2] = 0; }
          else { assignBuf[idx] = 255; assignBuf[idx + 1] = 0; assignBuf[idx + 2] = 0; }
        }
      }
    }
  }
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
