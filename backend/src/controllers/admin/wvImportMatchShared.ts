/**
 * Shared division-matching logic for CV color match.
 *
 * Extracted from wvImportMatchController.ts so both the auto handler
 * (colorMatchDivisionsSSE) and the guided handler can reuse the
 * spatial-split → cluster-merge → ICP → division-assignment → OCR pipeline.
 */

import sharp from 'sharp';
import { pool } from '../../db/index.js';
import {
  pendingClusterReviews,
  clusterPreviewImages,
} from './wvImportMatchReview.js';

// =============================================================================
// Shared SVG helpers (also used by wvImportMatchController for pre-3230 code)
// =============================================================================

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

// =============================================================================
// matchDivisionsFromClusters — shared pipeline
// =============================================================================

export interface MatchDivisionsParams {
  worldViewId: number;
  regionId: number;
  knownDivisionIds: Set<number>;
  buf: Buffer;
  mapBuffer: Buffer;
  countryMask: Uint8Array;
  waterGrown: Uint8Array;
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number] | null>;
  TW: number;
  TH: number;
  origW: number;
  origH: number;
  skipClusterReview: boolean;
  sendEvent: (event: Record<string, unknown>) => void;
  logStep: (msg: string) => Promise<void>;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;
}

export interface ReclusterSignal {
  recluster: true;
  preset: 'more_clusters' | 'different_seed' | 'boost_chroma';
}

/**
 * Run the spatial-split → merge → cluster-review → ICP → rasterization →
 * division-voting → recursive-split → OCR → geo-preview pipeline.
 *
 * Sends `complete` event via `sendEvent` at the end.
 * Returns a ReclusterSignal if the user requests re-clustering during review.
 */
export async function matchDivisionsFromClusters(params: MatchDivisionsParams): Promise<ReclusterSignal | void> {
  const {
    worldViewId, regionId, knownDivisionIds,
    buf, mapBuffer, countryMask, waterGrown: _waterGrown,
    pixelLabels, colorCentroids,
    TW, TH, origW, origH,
    skipClusterReview,
    sendEvent, logStep, pushDebugImage, debugImages,
    startTime,
  } = params;

  const tp = TW * TH;

  /** Scale pixel constant (calibrated at 500px base resolution) */
  const pxS = (base: number) => Math.round(base * TW / 500);

  // Compute countrySize from mask
  let countrySize = 0;
  for (let i = 0; i < tp; i++) {
    if (countryMask[i]) countrySize++;
  }

  // ── Load division data from DB ──
  const sampleDivId = [...knownDivisionIds][0];

  const countryResult = await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id, 0 AS depth FROM administrative_divisions WHERE id = $1
      UNION ALL
      SELECT ad.id, ad.name, ad.parent_id, a.depth + 1 FROM administrative_divisions ad
      JOIN ancestors a ON a.parent_id = ad.id
    )
    SELECT a.id, a.name, a.depth FROM ancestors a
    JOIN administrative_divisions p ON a.parent_id = p.id
    WHERE p.parent_id IS NULL
    LIMIT 1
  `, [sampleDivId]);

  const countryId = countryResult.rows[0]?.id as number | undefined;
  const countryName = countryResult.rows[0]?.name as string | undefined;
  const countryDepth = countryResult.rows[0]?.depth as number | undefined;
  if (!countryId || countryDepth === undefined) {
    sendEvent({ type: 'error', message: 'Could not find country ancestor' });
    return;
  }

  let targetDepth = countryDepth === 0 ? 1 : countryDepth;
  let allDivsResult = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT id, 0 AS depth FROM administrative_divisions WHERE id = $1
      UNION ALL
      SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
      JOIN descendants d ON ad.parent_id = d.id
      WHERE d.depth < $2
    )
    SELECT id FROM descendants WHERE depth = $2
  `, [countryId, targetDepth]);

  if (allDivsResult.rows.length <= 1 && targetDepth === countryDepth) {
    targetDepth = countryDepth + 1;
    allDivsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT id, 0 AS depth FROM administrative_divisions WHERE id = $1
        UNION ALL
        SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
        JOIN descendants d ON ad.parent_id = d.id
        WHERE d.depth < $2
      )
      SELECT id FROM descendants WHERE depth = $2
    `, [countryId, targetDepth]);
  }

  const allDivisionIdSet = new Set<number>();
  for (const r of allDivsResult.rows) allDivisionIdSet.add(r.id as number);
  for (const id of knownDivisionIds) allDivisionIdSet.add(id);
  const allDivisionIds = [...allDivisionIdSet];

  if (allDivisionIds.length === 0) {
    sendEvent({ type: 'error', message: 'No divisions found at this level' });
    return;
  }

  // Get which divisions are already assigned to which child region
  const assignedResult = await pool.query(`
    SELECT rm.division_id, rm.region_id, r.name AS region_name
    FROM region_members rm
    JOIN regions r ON r.id = rm.region_id
    WHERE rm.region_id IN (
      SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
    )
  `, [regionId, worldViewId]);

  const assignedMap = new Map<number, { regionId: number; regionName: string }>();
  for (const r of assignedResult.rows) {
    assignedMap.set(r.division_id as number, {
      regionId: r.region_id as number,
      regionName: r.region_name as string,
    });
  }

  // Map division ID → display name
  const divNameMap = new Map<number, string>();

  // Fetch centroids + names for all divisions
  const centroidResult = await pool.query(`
    SELECT id, name,
      ST_X(ST_Centroid(geom_simplified_medium)) AS cx,
      ST_Y(ST_Centroid(geom_simplified_medium)) AS cy
    FROM administrative_divisions
    WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
  `, [allDivisionIds]);

  const centroids = centroidResult.rows.map(r => {
    const name = r.name as string;
    divNameMap.set(r.id as number, name);
    return {
      id: r.id as number,
      cx: parseFloat(r.cx as string),
      cy: parseFloat(r.cy as string),
      assigned: assignedMap.get(r.id as number) ?? null,
    };
  });

  // Fetch division SVG paths + borders
  const [divPathsResult, borderResult] = await Promise.all([
    pool.query(`
      SELECT id, ST_AsSVG(geom_simplified_medium, 0, 4) AS svg_path
      FROM administrative_divisions
      WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
    `, [allDivisionIds]),
    pool.query(`
      WITH subset AS (
        SELECT ST_Union(geom_simplified_medium) AS geom
        FROM administrative_divisions
        WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
      ),
      all_borders AS (
        SELECT ST_Union(ST_Boundary(geom_simplified_medium)) AS geom
        FROM administrative_divisions
        WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
      )
      SELECT
        ST_AsSVG(subset.geom, 0, 4) AS country_path,
        ST_AsSVG(
          ST_Intersection(
            all_borders.geom,
            ST_Buffer(ST_Boundary(subset.geom), 0.001)
          ), 0, 4
        ) AS external_border,
        ST_AsSVG(
          ST_Difference(
            all_borders.geom,
            ST_Buffer(ST_Boundary(subset.geom), 0.001)
          ), 0, 4
        ) AS internal_border,
        ST_XMin(subset.geom) AS country_min_x,
        ST_YMin(subset.geom) AS country_min_y,
        ST_XMax(subset.geom) AS country_max_x,
        ST_YMax(subset.geom) AS country_max_y
      FROM subset, all_borders
    `, [allDivisionIds]),
  ]);

  if (borderResult.rows.length === 0) {
    sendEvent({ type: 'error', message: 'Could not compute borders' });
    return;
  }

  const divPaths = divPathsResult.rows.map(r => ({
    id: r.id as number,
    svgPath: r.svg_path as string,
  }));

  const row = borderResult.rows[0];
  const countryPath = row.country_path as string;
  const cMinX = parseFloat(row.country_min_x as string);
  const cMinY = parseFloat(row.country_min_y as string);
  const cMaxX = parseFloat(row.country_max_x as string);
  const cMaxY = parseFloat(row.country_max_y as string);

  // Region name for logging
  const regionNameResult = await pool.query(
    `SELECT name FROM regions WHERE id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  const regionName = (regionNameResult.rows[0]?.name as string) ?? `Region#${regionId}`;

  // ── Cluster result variables (populated during the pipeline) ──
  let cvClusterResult: Array<{
    clusterId: number; color: string; pixelShare: number;
    suggestedRegion: { id: number; name: string } | null;
    divisions: Array<{ id: number; name: string; confidence: number; depth: number; parentDivisionId?: number }>;
    unsplittable: Array<{ id: number; name: string; confidence: number; splitClusters: Array<{ clusterId: number; share: number }> }>;
  }> = [];
  let cvChildRegions: Array<{ id: number; name: string }> = [];
  const cvOutOfBounds: Array<{ id: number; name: string }> = [];
  let geoPreview: {
    featureCollection: GeoJSON.FeatureCollection;
    clusterInfos: Array<{ clusterId: number; color: string; regionId: number | null; regionName: string | null }>;
  } | null = null;

  // ── Spatial split: break large clusters into spatially disconnected regions ──
  const SPATIAL_SPLIT_MIN_CLUSTER_PCT = 0.15;
  const SPATIAL_SPLIT_MIN_CC_PCT = 0.03;
  const SPATIAL_SPLIT_COLOR_DIST = 8;
  // Compute CK from pixelLabels (max label + 1)
  let CK = 0;
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255 && pixelLabels[i] >= CK) CK = pixelLabels[i] + 1;
  }
  let nextLabel = CK;
  for (let k = 0; k < CK; k++) {
    let clusterCount = 0;
    for (let i = 0; i < tp; i++) { if (pixelLabels[i] === k) clusterCount++; }
    if (clusterCount / countrySize < SPATIAL_SPLIT_MIN_CLUSTER_PCT) continue;
    // Find connected components of this cluster
    const ccVisited = new Uint8Array(tp);
    const ccs: number[][] = [];
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] !== k || ccVisited[i]) continue;
      const cc: number[] = [];
      const q = [i]; ccVisited[i] = 1; let h = 0;
      while (h < q.length) {
        const p = q[h++]; cc.push(p);
        for (const n of [p - TW, p + TW, p - 1, p + 1]) {
          if (n >= 0 && n < tp && !ccVisited[n] && pixelLabels[n] === k) { ccVisited[n] = 1; q.push(n); }
        }
      }
      ccs.push(cc);
    }
    ccs.sort((a, b) => b.length - a.length);
    const minCCSize = Math.max(pxS(500), Math.round(countrySize * SPATIAL_SPLIT_MIN_CC_PCT));
    const largeCCs = ccs.filter(cc => cc.length >= minCCSize);
    if (largeCCs.length < 2) continue;
    const ccColors: Array<[number, number, number]> = largeCCs.map(cc => {
      let rr = 0, gg = 0, bb = 0;
      for (const p of cc) { rr += buf[p * 3]; gg += buf[p * 3 + 1]; bb += buf[p * 3 + 2]; }
      return [Math.round(rr / cc.length), Math.round(gg / cc.length), Math.round(bb / cc.length)];
    });
    let shouldSplit = false;
    for (let a = 0; a < ccColors.length && !shouldSplit; a++) {
      for (let b = a + 1; b < ccColors.length; b++) {
        const d = Math.sqrt(
          (ccColors[a][0] - ccColors[b][0]) ** 2 +
          (ccColors[a][1] - ccColors[b][1]) ** 2 +
          (ccColors[a][2] - ccColors[b][2]) ** 2,
        );
        if (d >= SPATIAL_SPLIT_COLOR_DIST) { shouldSplit = true; break; }
      }
    }
    if (!shouldSplit) {
      console.log(`  [Spatial] cluster ${k} (${(clusterCount / countrySize * 100).toFixed(1)}%): ${largeCCs.length} large CCs but colors too similar — no split`);
      continue;
    }
    console.log(`  [Spatial] cluster ${k} (${(clusterCount / countrySize * 100).toFixed(1)}%): splitting ${largeCCs.length} CCs:`);
    console.log(`    CC 0: ${largeCCs[0].length}px RGB(${ccColors[0]}) → stays cluster ${k}`);
    colorCentroids[k] = ccColors[0];
    for (let ci = 1; ci < largeCCs.length; ci++) {
      const newLbl = nextLabel++;
      colorCentroids[newLbl] = ccColors[ci];
      console.log(`    CC ${ci}: ${largeCCs[ci].length}px RGB(${ccColors[ci]}) → new cluster ${newLbl}`);
      for (const p of largeCCs[ci]) pixelLabels[p] = newLbl;
    }
  }

  // Debug image: after K-means + spatial split, before merge/cleanup
  const preMergeBuf = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === 255) {
      preMergeBuf[i * 3] = 220; preMergeBuf[i * 3 + 1] = 220; preMergeBuf[i * 3 + 2] = 220;
    } else {
      const c = colorCentroids[pixelLabels[i]];
      if (c) { preMergeBuf[i * 3] = c[0]; preMergeBuf[i * 3 + 1] = c[1]; preMergeBuf[i * 3 + 2] = c[2]; }
    }
  }
  const preMergePng = await sharp(preMergeBuf, {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    `K-means + spatial split (before merge/cleanup)`,
    `data:image/png;base64,${preMergePng.toString('base64')}`,
  );

  // Auto-merge tiny clusters (<2% of country) into nearest large cluster
  const MERGE_SIZE_PCT = 0.02;
  const MERGE_MAX_DIST_SQ = 40 * 40;
  const postSplitCounts = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) postSplitCounts.set(pixelLabels[i], (postSplitCounts.get(pixelLabels[i]) || 0) + 1);
  }
  const allLabels = [...postSplitCounts.keys()];
  for (const k of allLabels) {
    const cnt = postSplitCounts.get(k)!;
    if (cnt / countrySize >= MERGE_SIZE_PCT) continue;
    let minDist = Infinity, minK = k;
    for (const j of allLabels) {
      if (j === k) continue;
      const jCnt = postSplitCounts.get(j)!;
      if (jCnt / countrySize < MERGE_SIZE_PCT) continue;
      const ck = colorCentroids[k], cj = colorCentroids[j];
      if (!ck || !cj) continue;
      const d = (ck[0] - cj[0]) ** 2 + (ck[1] - cj[1]) ** 2 + (ck[2] - cj[2]) ** 2;
      if (d < minDist) { minDist = d; minK = j; }
    }
    const rgbDist = Math.sqrt(minDist);
    if (minDist <= MERGE_MAX_DIST_SQ && minK !== k) {
      console.log(`  [Merge] cluster ${k} (${(cnt / countrySize * 100).toFixed(1)}%) → ${minK} (RGB dist=${rgbDist.toFixed(1)})`);
      for (let i = 0; i < tp; i++) { if (pixelLabels[i] === k) pixelLabels[i] = minK; }
      postSplitCounts.set(minK, postSplitCounts.get(minK)! + cnt);
      postSplitCounts.delete(k);
    } else if (minK !== k) {
      console.log(`  [Merge] cluster ${k} (${(cnt / countrySize * 100).toFixed(1)}%) KEPT — nearest ${minK} too far (RGB dist=${rgbDist.toFixed(1)} > 40)`);
    }
  }

  // Clean up small isolated patches per cluster
  const MIN_PATCH = Math.max(pxS(20), Math.round(countrySize * 0.02));
  const uniqueLabels = new Set<number>();
  for (let i = 0; i < tp; i++) if (pixelLabels[i] < 255) uniqueLabels.add(pixelLabels[i]);

  let patchMergeCount = 0;
  for (const lbl of uniqueLabels) {
    const visited = new Uint8Array(tp);
    const patches: number[][] = [];
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] !== lbl || visited[i]) continue;
      const positions: number[] = [];
      const q = [i]; visited[i] = 1; let h = 0;
      while (h < q.length) {
        const p = q[h++]; positions.push(p);
        for (const n of [p - TW, p + TW, p - 1, p + 1]) {
          if (n >= 0 && n < tp && !visited[n] && pixelLabels[n] === lbl) { visited[n] = 1; q.push(n); }
        }
      }
      patches.push(positions);
    }

    patches.sort((a, b) => b.length - a.length);
    if (patches.length <= 1) continue;

    for (let pi = 1; pi < patches.length; pi++) {
      const patch = patches[pi];
      if (patch.length >= MIN_PATCH) continue;
      const nbrCounts = new Map<number, number>();
      for (const pos of patch) {
        for (const n of [pos - TW, pos + TW, pos - 1, pos + 1]) {
          if (n >= 0 && n < tp && pixelLabels[n] < 255 && pixelLabels[n] !== lbl) {
            nbrCounts.set(pixelLabels[n], (nbrCounts.get(pixelLabels[n]) || 0) + 1);
          }
        }
      }
      if (nbrCounts.size === 0) continue;
      let bestNbr = lbl, bestCnt = 0;
      for (const [nl, cnt] of nbrCounts) { if (cnt > bestCnt) { bestCnt = cnt; bestNbr = nl; } }
      patchMergeCount++;
      for (const pos of patch) pixelLabels[pos] = bestNbr;
    }
  }
  if (patchMergeCount > 0) console.log(`  [Patch] ${patchMergeCount} small patches relabeled (threshold: ${MIN_PATCH}px)`);

  // Auto-exclude noise clusters: desaturated (gray/dark), very small, or boundary fragments.
  // These are background remnants, text residue, or boundary artifacts — not real regions.
  // Same logic ICP uses to clean its silhouette, applied earlier so cluster review is clean.
  const NOISE_MIN_SAT = 25;       // HSV saturation threshold (0-255 scale)
  const NOISE_MIN_VAL = 60;       // HSV value threshold — very dark clusters
  const NOISE_TINY_PCT = 0.5;     // any cluster under this % → noise regardless of color
  {
    const preCounts = new Map<number, number>();
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] < 255) preCounts.set(pixelLabels[i], (preCounts.get(pixelLabels[i]) || 0) + 1);
    }
    const noiseIds: number[] = [];
    const validIds: number[] = [];
    for (const [lbl, cnt] of preCounts) {
      const c = colorCentroids[lbl];
      if (!c) { noiseIds.push(lbl); continue; }
      const pct = cnt / countrySize * 100;
      const maxC = Math.max(c[0], c[1], c[2]);
      const minC = Math.min(c[0], c[1], c[2]);
      const sat = maxC > 0 ? ((maxC - minC) / maxC) * 255 : 0;
      const val = maxC;
      // Ultra-small clusters: colorful ones use a lower threshold (small regions like
      // narrow coastal strips are legitimate), gray/dark ones use the normal threshold
      // (boundary artifacts, text residue).
      const isColorful = sat >= NOISE_MIN_SAT && val >= NOISE_MIN_VAL;
      const tinyThreshold = isColorful ? 0.15 : NOISE_TINY_PCT;
      if (pct < tinyThreshold) { noiseIds.push(lbl); continue; }
      // Gray/dark clusters at any size are noise (background remnants) — real map
      // regions always have color. Only protect very large gray clusters (>15%)
      // in case of unusual monochromatic maps.
      if ((sat < NOISE_MIN_SAT || val < NOISE_MIN_VAL) && pct < 15) {
        noiseIds.push(lbl); continue;
      }
      validIds.push(lbl);
    }
    if (noiseIds.length > 0 && validIds.length >= 3) {
      // Reassign noise pixels to nearest valid cluster
      let reassigned = 0;
      for (let i = 0; i < tp; i++) {
        if (!noiseIds.includes(pixelLabels[i])) continue;
        let bestDist = Infinity, bestLbl = pixelLabels[i];
        const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
        for (const vl of validIds) {
          const vc = colorCentroids[vl];
          if (!vc) continue;
          const d = (r - vc[0]) ** 2 + (g - vc[1]) ** 2 + (b - vc[2]) ** 2;
          if (d < bestDist) { bestDist = d; bestLbl = vl; }
        }
        pixelLabels[i] = bestLbl;
        reassigned++;
      }
      console.log(`  [Noise] Auto-excluded ${noiseIds.length} noise cluster(s) (${reassigned} px reassigned to nearest valid cluster)`);
      for (const nl of noiseIds) {
        const c = colorCentroids[nl];
        const cnt = preCounts.get(nl) || 0;
        console.log(`    excluded ${nl}: RGB(${c?.[0]},${c?.[1]},${c?.[2]}) ${cnt}px (${(cnt / countrySize * 100).toFixed(1)}%)`);
      }
    }
  }

  // Count final clusters
  const finalLabels = new Set<number>();
  for (let i = 0; i < tp; i++) if (pixelLabels[i] < 255) finalLabels.add(pixelLabels[i]);
  console.log(`  [Clustering] Final: ${finalLabels.size} clusters (from ${CK} initial + spatial splits)`);
  for (const lbl of finalLabels) {
    let cnt = 0;
    for (let i = 0; i < tp; i++) if (pixelLabels[i] === lbl) cnt++;
    const c = colorCentroids[lbl];
    console.log(`    cluster ${lbl}: RGB(${c?.[0]},${c?.[1]},${c?.[2]}) ${cnt}px (${(cnt / countrySize * 100).toFixed(1)}%)`);
  }

  // ── Always push a cluster visualization as debug image ──
  {
    const vizBuf = Buffer.alloc(tp * 3, 220);
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] !== 255 && colorCentroids[pixelLabels[i]]) {
        const c = colorCentroids[pixelLabels[i]]!;
        vizBuf[i * 3] = c[0]; vizBuf[i * 3 + 1] = c[1]; vizBuf[i * 3 + 2] = c[2];
      }
    }
    const vizPng = await sharp(vizBuf, { raw: { width: TW, height: TH, channels: 3 } })
      .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
    await pushDebugImage(`Clusters (${finalLabels.size} final)`, `data:image/png;base64,${vizPng.toString('base64')}`);
  }

  // ── Interactive cluster review ──
  if (!skipClusterReview) {
    const clusterInfos: Array<{ label: number; color: [number, number, number]; pxCount: number; pct: number }> = [];
    for (const lbl of finalLabels) {
      let cnt = 0;
      for (let i = 0; i < tp; i++) if (pixelLabels[i] === lbl) cnt++;
      const c = colorCentroids[lbl];
      if (c) clusterInfos.push({ label: lbl, color: [c[0], c[1], c[2]], pxCount: cnt, pct: Math.round(cnt / countrySize * 1000) / 10 });
    }
    const smallClusters = clusterInfos.filter(c => c.pct < 3);
    if (smallClusters.length > 0) {
      const reviewId = `cr-${regionId}-${Date.now()}`;

      const previewBuf = Buffer.alloc(tp * 3, 220);
      for (let i = 0; i < tp; i++) {
        if (pixelLabels[i] !== 255 && colorCentroids[pixelLabels[i]]) {
          const c = colorCentroids[pixelLabels[i]]!;
          previewBuf[i * 3] = c[0]; previewBuf[i * 3 + 1] = c[1]; previewBuf[i * 3 + 2] = c[2];
        }
      }
      const previewPng = await sharp(previewBuf, { raw: { width: TW, height: TH, channels: 3 } })
        .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      const previewDataUrl = `data:image/png;base64,${previewPng.toString('base64')}`;

      clusterPreviewImages.set(reviewId, previewDataUrl);
      setTimeout(() => { clusterPreviewImages.delete(reviewId); }, 600000);

      sendEvent({
        type: 'cluster_review',
        reviewId,
        data: {
          clusters: clusterInfos.map(c => ({
            label: c.label,
            color: `rgb(${c.color[0]},${c.color[1]},${c.color[2]})`,
            pct: c.pct,
            isSmall: c.pct < 3,
          })),
        },
      });
      await new Promise(resolve => setImmediate(resolve));

      interface ClusterReviewDecision {
        merges: Record<number, number>;
        excludes?: number[];
        recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' };
      }

      const decision = await new Promise<ClusterReviewDecision>((resolve) => {
        pendingClusterReviews.set(reviewId, resolve);
        setTimeout(() => {
          if (pendingClusterReviews.has(reviewId)) {
            console.log(`  [Cluster Review] ${reviewId} timed out — keeping all`);
            pendingClusterReviews.delete(reviewId);
            resolve({ merges: {} });
          }
        }, 180000);
      });

      // Check for recluster request
      if (decision.recluster) {
        console.log(`  [Cluster Review] Recluster requested: ${decision.recluster.preset}`);
        return { recluster: true, preset: decision.recluster.preset };
      }

      // Apply excludes
      const excludeLabels = (decision.excludes ?? []).map(Number).filter(l => finalLabels.has(l));
      if (excludeLabels.length > 0) {
        await logStep(`Excluding ${excludeLabels.length} cluster(s)...`);
        for (const lbl of excludeLabels) {
          console.log(`  [Cluster Review] Excluding cluster ${lbl} (set to background)`);
          for (let i = 0; i < tp; i++) {
            if (pixelLabels[i] === lbl) pixelLabels[i] = 255;
          }
          finalLabels.delete(lbl);
        }
      }

      // Apply merges
      const mergeEntries = Object.entries(decision.merges).map(([from, to]) => [Number(from), Number(to)] as [number, number]);
      if (mergeEntries.length > 0) {
        await logStep(`Applying ${mergeEntries.length} cluster merge(s)...`);
        for (const [fromLabel, toLabel] of mergeEntries) {
          if (!finalLabels.has(fromLabel) || !finalLabels.has(toLabel)) continue;
          console.log(`  [Cluster Review] Merging cluster ${fromLabel} → ${toLabel}`);
          for (let i = 0; i < tp; i++) {
            if (pixelLabels[i] === fromLabel) pixelLabels[i] = toLabel;
          }
          finalLabels.delete(fromLabel);
        }
        console.log(`  [Cluster Review] ${finalLabels.size} clusters remaining`);
      }
    }
  }

  // Render quantized map + border overlay
  const quantBuf = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === 255) {
      quantBuf[i * 3] = 220; quantBuf[i * 3 + 1] = 220; quantBuf[i * 3 + 2] = 220;
    } else {
      const c = colorCentroids[pixelLabels[i]];
      if (c) { quantBuf[i * 3] = c[0]; quantBuf[i * 3 + 1] = c[1]; quantBuf[i * 3 + 2] = c[2]; }
    }
  }

  const overlayBuf = Buffer.from(quantBuf);
  for (let y = 1; y < TH - 1; y++) {
    for (let x = 1; x < TW - 1; x++) {
      const p = y * TW + x;
      if (pixelLabels[p] === 255) continue;
      let isExt = false, isInt = false;
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (pixelLabels[n] === pixelLabels[p]) continue;
        if (pixelLabels[n] === 255) isExt = true; else isInt = true;
      }
      const o = p * 3;
      if (isExt) { overlayBuf[o] = 213; overlayBuf[o + 1] = 47; overlayBuf[o + 2] = 47; }
      else if (isInt) { overlayBuf[o] = 21; overlayBuf[o + 1] = 101; overlayBuf[o + 2] = 192; }
    }
  }

  // Final cluster stats
  const finalClusters = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) finalClusters.set(pixelLabels[i], (finalClusters.get(pixelLabels[i]) || 0) + 1);
  }

  // Debug image: CV borders (upscaled)
  const upscaledBordersPng = await sharp(overlayBuf, { raw: { width: TW, height: TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await pushDebugImage(
    `Step 2: Source map CV borders (${finalClusters.size} color regions, red=external, blue=internal)`,
    `data:image/png;base64,${upscaledBordersPng.toString('base64')}`,
  );

  await logStep('ICP alignment (matching GADM boundary to CV silhouette)...');

  // Build ICP mask from active (non-excluded) cluster pixels
  let icpMask: Uint8Array;
  {
    const baseMask = new Uint8Array(tp);
    let baseSize = 0;
    for (let i = 0; i < tp; i++) {
      if (countryMask[i] && pixelLabels[i] !== 255) {
        baseMask[i] = 1;
        baseSize++;
      }
    }
    icpMask = baseMask;
    if (baseSize < countrySize) {
      console.log(`  [ICP] Excluded-cluster refinement: mask ${countrySize}→${baseSize} px (${(baseSize/tp*100).toFixed(0)}%)`);
    }

    // Further exclude desaturated (gray) clusters
    const grayClusterIds: number[] = [];
    for (const [clusterId] of finalClusters) {
      const c = colorCentroids[clusterId];
      if (!c) continue;
      const maxC = Math.max(c[0], c[1], c[2]);
      const minC = Math.min(c[0], c[1], c[2]);
      const sat = maxC > 0 ? ((maxC - minC) / maxC) * 255 : 0;
      if (sat < 20) grayClusterIds.push(clusterId);
    }
    if (grayClusterIds.length > 0) {
      const refined = new Uint8Array(tp);
      let refinedSize = 0;
      for (let i = 0; i < tp; i++) {
        if (pixelLabels[i] < 255 && !grayClusterIds.includes(pixelLabels[i])) {
          refined[i] = 1;
          refinedSize++;
        }
      }
      if (refinedSize > tp * 0.15 && refinedSize < baseSize * 0.95) {
        console.log(`  [ICP] Excluding ${grayClusterIds.length} gray cluster(s): mask ${baseSize}→${refinedSize} px (${(refinedSize/tp*100).toFixed(0)}%)`);
        icpMask = refined;
      }
    }
  }

  // Extract CV external border pixels
  const cvBorderPixels: Array<[number, number]> = [];
  for (let y = 1; y < TH - 1; y++) {
    for (let x = 1; x < TW - 1; x++) {
      const p = y * TW + x;
      if (!icpMask[p]) continue;
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (!icpMask[n]) { cvBorderPixels.push([x, y]); break; }
      }
    }
  }

  // Extract CV internal border pixels
  const intBorderPixels: Array<[number, number]> = [];
  for (let y = 1; y < TH - 1; y++) {
    for (let x = 1; x < TW - 1; x++) {
      const p = y * TW + x;
      if (pixelLabels[p] === 255) continue;
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (pixelLabels[n] !== 255 && pixelLabels[n] !== pixelLabels[p]) {
          intBorderPixels.push([x, y]);
          break;
        }
      }
    }
  }

  // Resample GADM division boundaries for internal border matching
  const allDivPoints: Array<[number, number]> = [];
  for (const d of divPaths) {
    const pts = parseSvgPathPoints(d.svgPath);
    if (pts.length >= 3) {
      const resampled = resamplePath(pts, pxS(50));
      for (const p of resampled) allDivPoints.push(p);
    }
  }

  // Parse + resample GADM country boundary
  const gadmBoundary = resamplePath(
    parseSvgPathPoints(countryPath),
    pxS(500)
  );

  // Spatial grid for fast nearest-neighbor on CV border
  const CELL = pxS(5);
  const gridW = Math.ceil(TW / CELL), gridH = Math.ceil(TH / CELL);
  const cvGrid: Array<Array<[number, number]>> = Array.from({ length: gridW * gridH }, () => []);
  for (const [x, y] of cvBorderPixels) {
    cvGrid[Math.floor(y / CELL) * gridW + Math.floor(x / CELL)].push([x, y]);
  }
  function nearestCvBorder(px: number, py: number): { pt: [number, number]; dist: number } | null {
    const gx = Math.floor(px / CELL), gy = Math.floor(py / CELL);
    let bestDist = Infinity;
    let bestPt: [number, number] | null = null;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
        for (const [cx, cy] of cvGrid[ny * gridW + nx]) {
          const d = (px - cx) ** 2 + (py - cy) ** 2;
          if (d < bestDist) { bestDist = d; bestPt = [cx, cy]; }
        }
      }
    }
    return bestPt ? { pt: bestPt, dist: Math.sqrt(bestDist) } : null;
  }

  // Two-phase ICP with auto-selection
  const gBbox = { minX: cMinX, maxX: cMaxX, minY: -cMaxY, maxY: -cMinY };
  let cvMinX = TW, cvMaxX = 0, cvMinY = TH, cvMaxY = 0;
  for (const [x, y] of cvBorderPixels) {
    if (x < cvMinX) cvMinX = x; if (x > cvMaxX) cvMaxX = x;
    if (y < cvMinY) cvMinY = y; if (y > cvMaxY) cvMaxY = y;
  }
  const cBbox = { minX: cvMinX, maxX: cvMaxX, minY: cvMinY, maxY: cvMaxY };
  const initSx = (cBbox.maxX - cBbox.minX) / (gBbox.maxX - gBbox.minX);
  const initSy = (cBbox.maxY - cBbox.minY) / (gBbox.maxY - gBbox.minY);

  console.log(`  [ICP] GADM bbox (PostGIS): x=[${gBbox.minX.toFixed(4)},${gBbox.maxX.toFixed(4)}] y=[${gBbox.minY.toFixed(4)},${gBbox.maxY.toFixed(4)}]`);
  console.log(`  [ICP] CV bbox (full):      x=[${cBbox.minX},${cBbox.maxX}] y=[${cBbox.minY},${cBbox.maxY}] (${cvBorderPixels.length} pts)`);
  console.log(`  [ICP] initScale: sx=${initSx.toFixed(4)} sy=${initSy.toFixed(4)}`);
  console.log(`  [ICP] countryMask size: ${countrySize}/${tp} = ${(countrySize / tp * 100).toFixed(1)}%`);

  const gCx = (gBbox.minX + gBbox.maxX) / 2;
  const gCy = (gBbox.minY + gBbox.maxY) / 2;
  const pCx = (cBbox.minX + cBbox.maxX) / 2;
  const pCy = (cBbox.minY + cBbox.maxY) / 2;
  console.log(`  [ICP] GADM bbox center: (${gCx.toFixed(4)}, ${gCy.toFixed(4)}) → CV bbox center: (${pCx.toFixed(1)}, ${pCy.toFixed(1)})`);

  function computeMaxOverflow(sx: number, sy: number, tx: number, ty: number): number {
    let gTop = TH, gBot = 0, gLeft = TW, gRight = 0;
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sx + tx, py = gy * sy + ty;
      if (py < gTop) gTop = py; if (py > gBot) gBot = py;
      if (px < gLeft) gLeft = px; if (px > gRight) gRight = px;
    }
    let cTop = TH, cBot = 0, cLeft = TW, cRight = 0;
    for (const [x, y] of cvBorderPixels) {
      if (y < cTop) cTop = y; if (y > cBot) cBot = y;
      if (x < cLeft) cLeft = x; if (x > cRight) cRight = x;
    }
    return Math.max(Math.abs(cTop - gTop), Math.abs(gBot - cBot), Math.abs(cLeft - gLeft), Math.abs(gRight - cRight));
  }

  function computeMeanError(sx: number, sy: number, tx: number, ty: number): number {
    let total = 0, cnt = 0;
    for (const [gx, gy] of gadmBoundary) {
      const n = nearestCvBorder(gx * sx + tx, gy * sy + ty);
      if (n) { total += n.dist; cnt++; }
    }
    return cnt > 0 ? total / cnt : Infinity;
  }

  // --- Option A: Translation-only ICP ---
  const sxA = initSx, syA = initSy;
  let txA = pCx - gCx * sxA, tyA = pCy - gCy * syA;
  for (let iter = 0; iter < 20; iter++) {
    let sumDx = 0, sumDy = 0, count = 0;
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxA + txA, py = gy * syA + tyA;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
    }
    if (count < 10) break;
    txA += sumDx / count; tyA += sumDy / count;
  }
  const overflowA = computeMaxOverflow(sxA, syA, txA, tyA);
  const errorA = computeMeanError(sxA, syA, txA, tyA);

  // --- Option B: Translation + gentle scale correction ---
  let sxB = initSx, syB = initSy;
  let txB = pCx - gCx * sxB, tyB = pCy - gCy * syB;
  for (let iter = 0; iter < 20; iter++) {
    let sumDx = 0, sumDy = 0, count = 0;
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxB + txB, py = gy * syB + tyB;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
    }
    if (count < 10) break;
    txB += sumDx / count; tyB += sumDy / count;
  }
  for (let phase2 = 0; phase2 < 3; phase2++) {
    const corrs: Array<{ gx: number; gy: number; cx: number; cy: number; dist: number }> = [];
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxB + txB, py = gy * syB + tyB;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) corrs.push({ gx, gy, cx: n.pt[0], cy: n.pt[1], dist: n.dist });
    }
    if (corrs.length < 20) break;
    corrs.sort((a, b) => a.dist - b.dist);
    const trimmed = corrs.slice(0, Math.floor(corrs.length * 0.75));
    const np = trimmed.length;
    let sGx = 0, sGx2 = 0, sCx = 0, sGxCx = 0;
    let sGy = 0, sGy2 = 0, sCy = 0, sGyCy = 0;
    for (const { gx, gy, cx, cy } of trimmed) {
      sGx += gx; sGx2 += gx * gx; sCx += cx; sGxCx += gx * cx;
      sGy += gy; sGy2 += gy * gy; sCy += cy; sGyCy += gy * cy;
    }
    const detX = np * sGx2 - sGx * sGx, detY = np * sGy2 - sGy * sGy;
    if (Math.abs(detX) < 1e-10 || Math.abs(detY) < 1e-10) break;
    sxB = Math.max(initSx * 0.90, Math.min(initSx * 1.10, (np * sGxCx - sGx * sCx) / detX));
    syB = Math.max(initSy * 0.90, Math.min(initSy * 1.10, (np * sGyCy - sGy * sCy) / detY));
    txB = (sCx - sxB * sGx) / np;
    tyB = (sCy - syB * sGy) / np;
    for (let iter = 0; iter < 5; iter++) {
      let sumDx = 0, sumDy = 0, count = 0;
      for (const [gx, gy] of gadmBoundary) {
        const px = gx * sxB + txB, py = gy * syB + tyB;
        const n = nearestCvBorder(px, py);
        if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
      }
      if (count < 10) break;
      txB += sumDx / count; tyB += sumDy / count;
    }
  }
  const overflowB = computeMaxOverflow(sxB, syB, txB, tyB);
  const errorB = computeMeanError(sxB, syB, txB, tyB);

  // --- Option C: External + Internal borders, scale+translate ICP ---
  let sxC = initSx, syC = initSy;
  let txC = pCx - gCx * sxC, tyC = pCy - gCy * syC;
  for (let iter = 0; iter < 20; iter++) {
    let sumDx = 0, sumDy = 0, count = 0;
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxC + txC, py = gy * syC + tyC;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
    }
    if (count < 10) break;
    txC += sumDx / count; tyC += sumDy / count;
  }
  for (let phase2 = 0; phase2 < 5; phase2++) {
    const corrsC: Array<{ gx: number; gy: number; cx: number; cy: number; dist: number; type: string }> = [];
    for (const [gx, gy] of gadmBoundary) {
      const px = gx * sxC + txC, py = gy * syC + tyC;
      const n = nearestCvBorder(px, py);
      if (n && n.dist < 15) corrsC.push({ gx, gy, cx: n.pt[0], cy: n.pt[1], dist: n.dist, type: 'ext' });
    }
    const gadmDivGrid: Array<Array<[number, number, number, number]>> = Array.from(
      { length: gridW * gridH }, () => []
    );
    for (const [gx, gy] of allDivPoints) {
      const px = gx * sxC + txC, py = gy * syC + tyC;
      const gi = Math.floor(py / CELL) * gridW + Math.floor(px / CELL);
      if (gi >= 0 && gi < gadmDivGrid.length) gadmDivGrid[gi].push([gx, gy, px, py]);
    }
    for (const [ix, iy] of intBorderPixels) {
      const giX = Math.floor(ix / CELL), giY = Math.floor(iy / CELL);
      let bestDist = Infinity;
      let bestGadm: [number, number] | null = null;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = giX + dx, ny = giY + dy;
          if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
          for (const [gx, gy, px, py] of gadmDivGrid[ny * gridW + nx]) {
            const d = (ix - px) ** 2 + (iy - py) ** 2;
            if (d < bestDist) { bestDist = d; bestGadm = [gx, gy]; }
          }
        }
      }
      if (bestGadm && Math.sqrt(bestDist) < 8) {
        corrsC.push({ gx: bestGadm[0], gy: bestGadm[1], cx: ix, cy: iy, dist: Math.sqrt(bestDist), type: 'int' });
      }
    }
    if (corrsC.length < 20) break;
    corrsC.sort((a, b) => a.dist - b.dist);
    const trimmedC = corrsC.slice(0, Math.floor(corrsC.length * 0.75));
    let wSum = 0, wsGx = 0, wsGx2 = 0, wsCx = 0, wsGxCx = 0;
    let wsGy = 0, wsGy2 = 0, wsCy = 0, wsGyCy = 0;
    for (const { gx, gy, cx, cy, type } of trimmedC) {
      const w = type === 'ext' ? 3 : 1;
      wSum += w; wsGx += w * gx; wsGx2 += w * gx * gx; wsCx += w * cx; wsGxCx += w * gx * cx;
      wsGy += w * gy; wsGy2 += w * gy * gy; wsCy += w * cy; wsGyCy += w * gy * cy;
    }
    const detXC = wSum * wsGx2 - wsGx * wsGx, detYC = wSum * wsGy2 - wsGy * wsGy;
    if (Math.abs(detXC) < 1e-10 || Math.abs(detYC) < 1e-10) break;
    sxC = Math.max(initSx * 0.90, Math.min(initSx * 1.10, (wSum * wsGxCx - wsGx * wsCx) / detXC));
    syC = Math.max(initSy * 0.90, Math.min(initSy * 1.10, (wSum * wsGyCy - wsGy * wsCy) / detYC));
    txC = (wsCx - sxC * wsGx) / wSum;
    tyC = (wsCy - syC * wsGy) / wSum;
    for (let iter = 0; iter < 5; iter++) {
      let sumDx = 0, sumDy = 0, count = 0;
      for (const [gx, gy] of gadmBoundary) {
        const px = gx * sxC + txC, py = gy * syC + tyC;
        const n = nearestCvBorder(px, py);
        if (n && n.dist < 15) { sumDx += n.pt[0] - px; sumDy += n.pt[1] - py; count++; }
      }
      if (count < 10) break;
      txC += sumDx / count; tyC += sumDy / count;
    }
  }
  const overflowC = computeMaxOverflow(sxC, syC, txC, tyC);
  const errorC = computeMeanError(sxC, syC, txC, tyC);

  // Pick best option
  const icpOptions = [
    { label: 'A', sx: sxA, sy: syA, tx: txA, ty: tyA, overflow: overflowA, error: errorA },
    { label: 'B', sx: sxB, sy: syB, tx: txB, ty: tyB, overflow: overflowB, error: errorB },
    { label: 'C', sx: sxC, sy: syC, tx: txC, ty: tyC, overflow: overflowC, error: errorC },
  ];
  icpOptions.sort((a, b) => {
    if (Math.abs(a.overflow - b.overflow) < 3) return a.error - b.error;
    return a.overflow - b.overflow;
  });
  const best = icpOptions[0];
  const icpSx = best.sx, icpSy = best.sy, icpTx = best.tx, icpTy = best.ty;
  const gadmToPixel = (gx: number, gy: number): [number, number] =>
    [gx * icpSx + icpTx, gy * icpSy + icpTy];

  // Debug image: ICP alignment bbox diagnostic
  {
    const bboxBuf = Buffer.alloc(tp * 3, 40);
    for (let i = 0; i < tp; i++) {
      if (icpMask[i]) { bboxBuf[i * 3] = 30; bboxBuf[i * 3 + 1] = 80; bboxBuf[i * 3 + 2] = 30; }
    }
    for (const [x, y] of cvBorderPixels) {
      const idx = (y * TW + x) * 3;
      bboxBuf[idx] = 0; bboxBuf[idx + 1] = 255; bboxBuf[idx + 2] = 255;
    }
    const drawHLine = (y: number, x0: number, x1: number, r: number, g: number, b: number) => {
      if (y < 0 || y >= TH) return;
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(TW - 1, Math.ceil(x1)); x++) {
        const idx = (y * TW + x) * 3;
        bboxBuf[idx] = r; bboxBuf[idx + 1] = g; bboxBuf[idx + 2] = b;
      }
    };
    const drawVLine = (x: number, y0: number, y1: number, r: number, g: number, b: number) => {
      if (x < 0 || x >= TW) return;
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(TH - 1, Math.ceil(y1)); y++) {
        const idx = (y * TW + x) * 3;
        bboxBuf[idx] = r; bboxBuf[idx + 1] = g; bboxBuf[idx + 2] = b;
      }
    };
    drawHLine(cBbox.minY, cBbox.minX, cBbox.maxX, 0, 200, 200);
    drawHLine(cBbox.maxY, cBbox.minX, cBbox.maxX, 0, 200, 200);
    drawVLine(cBbox.minX, cBbox.minY, cBbox.maxY, 0, 200, 200);
    drawVLine(cBbox.maxX, cBbox.minY, cBbox.maxY, 0, 200, 200);
    const gCorners = [
      gadmToPixel(gBbox.minX, gBbox.minY), gadmToPixel(gBbox.maxX, gBbox.minY),
      gadmToPixel(gBbox.maxX, gBbox.maxY), gadmToPixel(gBbox.minX, gBbox.maxY),
    ];
    drawHLine(Math.round(gCorners[0][1]), gCorners[0][0], gCorners[1][0], 255, 60, 60);
    drawHLine(Math.round(gCorners[2][1]), gCorners[3][0], gCorners[2][0], 255, 60, 60);
    drawVLine(Math.round(gCorners[0][0]), gCorners[0][1], gCorners[3][1], 255, 60, 60);
    drawVLine(Math.round(gCorners[1][0]), gCorners[1][1], gCorners[2][1], 255, 60, 60);
    for (const [gx, gy] of gadmBoundary) {
      const [px, py] = gadmToPixel(gx, gy);
      const ix = Math.round(px), iy = Math.round(py);
      if (ix >= 0 && ix < TW && iy >= 0 && iy < TH) {
        const idx = (iy * TW + ix) * 3;
        bboxBuf[idx] = 255; bboxBuf[idx + 1] = 80; bboxBuf[idx + 2] = 80;
      }
    }
    const bboxPng = await sharp(bboxBuf, { raw: { width: TW, height: TH, channels: 3 } })
      .resize(origW, origH, { kernel: 'nearest' })
      .png()
      .toBuffer();
    await pushDebugImage(
      `ICP bbox diagnostic: cyan=CV border+bbox, red=GADM border+bbox (ICP ${best.label}, err=${best.error.toFixed(1)}, overflow=${best.overflow.toFixed(0)})`,
      `data:image/png;base64,${bboxPng.toString('base64')}`,
    );
  }

  // Debug image: GADM divisions overlaid on quantized map
  const vizBuf = Buffer.from(quantBuf);
  for (const d of divPaths) {
    const pts = parseSvgPathPoints(d.svgPath);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = gadmToPixel(pts[i - 1][0], pts[i - 1][1]);
      const [x1, y1] = gadmToPixel(pts[i][0], pts[i][1]);
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
      for (let s = 0; s <= steps; s++) {
        const t = steps > 0 ? s / steps : 0;
        const x = Math.round(x0 + t * (x1 - x0));
        const y = Math.round(y0 + t * (y1 - y0));
        if (x >= 0 && x < TW && y >= 0 && y < TH) {
          const idx = (y * TW + x) * 3;
          vizBuf[idx] = 255; vizBuf[idx + 1] = 255; vizBuf[idx + 2] = 255;
        }
      }
    }
  }
  for (const c of centroids) {
    const [px, py] = gadmToPixel(c.cx, -c.cy);
    const ix = Math.round(px), iy = Math.round(py);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 9) continue;
        const x = ix + dx, y = iy + dy;
        if (x >= 0 && x < TW && y >= 0 && y < TH) {
          const idx = (y * TW + x) * 3;
          const isEdge = dx * dx + dy * dy >= 6;
          if (isEdge) { vizBuf[idx] = 0; vizBuf[idx + 1] = 0; vizBuf[idx + 2] = 0; }
          else if (c.assigned) { vizBuf[idx] = 76; vizBuf[idx + 1] = 175; vizBuf[idx + 2] = 80; }
          else { vizBuf[idx] = 255; vizBuf[idx + 1] = 152; vizBuf[idx + 2] = 0; }
        }
      }
    }
  }
  const compositePng = await sharp(vizBuf, { raw: { width: TW, height: TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await pushDebugImage(
    `Step 3: GADM divisions overlaid on CV color regions (ICP ${best.label}, err=${best.error.toFixed(1)}, overflow=${best.overflow.toFixed(0)}px)`,
    `data:image/png;base64,${compositePng.toString('base64')}`,
  );
  const srcPng = await sharp(mapBuffer).png().toBuffer();
  await pushDebugImage(
    '__source_map__',
    `data:image/png;base64,${srcPng.toString('base64')}`,
  );

  // ========== Step 4: Division-to-Region Assignment ==========
  await logStep('Assigning GADM divisions to color regions...');

  // Rasterize line segment onto a mask buffer
  function rasterizeLine(x0: number, y0: number, x1: number, y1: number, mask: Uint8Array) {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3);
    for (let s = 0; s <= steps; s++) {
      const t = steps > 0 ? s / steps : 0;
      const x = Math.round(x0 + t * (x1 - x0));
      const y = Math.round(y0 + t * (y1 - y0));
      if (x >= 0 && x < TW && y >= 0 && y < TH) mask[y * TW + x] = 1;
    }
  }

  // Build wall mask from all division boundaries
  const wallMask = new Uint8Array(tp);
  for (const d of divPaths) {
    for (const sp of parseSvgSubPaths(d.svgPath)) {
      for (let i = 0; i < sp.length; i++) {
        const [x0, y0] = gadmToPixel(sp[i][0], sp[i][1]);
        const [x1, y1] = gadmToPixel(sp[(i + 1) % sp.length][0], sp[(i + 1) % sp.length][1]);
        rasterizeLine(x0, y0, x1, y1, wallMask);
      }
    }
  }

  // Flood fill from a start pixel
  function floodFillDiv(startX: number, startY: number, label: number, walls: Uint8Array, target: Int16Array): number {
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

  // Flood fill each division from its centroid
  const divisionMap = new Int16Array(tp).fill(-1);
  const outOfBoundsDivisions = new Set<number>();
  for (let ci = 0; ci < centroids.length; ci++) {
    const [px, py] = gadmToPixel(centroids[ci].cx, -centroids[ci].cy);
    const ix = Math.round(px), iy = Math.round(py);
    if (ix < 0 || ix >= TW || iy < 0 || iy >= TH || !countryMask[iy * TW + ix]) {
      outOfBoundsDivisions.add(ci);
      continue;
    }
    floodFillDiv(px, py, ci, wallMask, divisionMap);
  }
  if (outOfBoundsDivisions.size > 0) {
    console.log(`  [CV] ${outOfBoundsDivisions.size} division(s) outside map coverage — centroids outside country mask`);
    for (const ci of outOfBoundsDivisions) {
      cvOutOfBounds.push({ id: centroids[ci].id, name: divNameMap.get(centroids[ci].id) ?? `#${centroids[ci].id}` });
    }
  }

  // Count cluster votes per division
  const divClusterVotes = new Map<number, Map<number, number>>();
  for (let i = 0; i < tp; i++) {
    const di = divisionMap[i];
    if (di < 0 || pixelLabels[i] === 255) continue;
    if (!divClusterVotes.has(di)) divClusterVotes.set(di, new Map());
    const votes = divClusterVotes.get(di)!;
    votes.set(pixelLabels[i], (votes.get(pixelLabels[i]) || 0) + 1);
  }

  // Assign each division to dominant cluster, detect splits
  interface DivAssignment {
    divisionId: number;
    clusterId: number;
    confidence: number;
    isSplit: boolean;
    splitClusters?: Array<{ clusterId: number; share: number }>;
  }
  const divAssignments: DivAssignment[] = [];
  const splitDivisionIds: number[] = [];

  for (let ci = 0; ci < centroids.length; ci++) {
    if (outOfBoundsDivisions.has(ci)) continue;
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
        const isSplit = confidence < 0.9 && sorted.length > 1;
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
    const isSplit = confidence < 0.9 && sorted.length > 1;
    if (isSplit) splitDivisionIds.push(div.id);
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

  interface FinalDivAssignment {
    divisionId: number; clusterId: number; confidence: number;
    depth: number; parentDivisionId?: number;
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
            rasterizeLine(x0, y0, x1, y1, childWalls);
          }
        }
      }
      const childMap = new Int16Array(tp).fill(-1);
      for (let chi = 0; chi < children.length; chi++) {
        const [px, py] = gadmToPixel(children[chi].cx, -children[chi].cy);
        floodFillDiv(px, py, chi, childWalls, childMap);
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
        const childIsSplit = conf < 0.9 && sorted.length > 1;
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

  // Match clusters to child regions
  const clusterRegionVotes = new Map<number, Map<number, { count: number; name: string }>>();
  for (let ci = 0; ci < centroids.length; ci++) {
    const a = divAssignments[ci];
    if (!a) continue;
    const assigned = centroids[ci].assigned;
    if (!assigned || a.clusterId < 0) continue;
    if (!clusterRegionVotes.has(a.clusterId)) clusterRegionVotes.set(a.clusterId, new Map());
    const rv = clusterRegionVotes.get(a.clusterId)!;
    const existing = rv.get(assigned.regionId);
    if (existing) existing.count++; else rv.set(assigned.regionId, { count: 1, name: assigned.regionName });
  }

  // Geographic fallback
  const childRegionsResult = await pool.query(`
    SELECT id, name,
      ST_X(ST_Centroid(geom)) AS cx,
      ST_Y(ST_Centroid(geom)) AS cy
    FROM regions
    WHERE parent_region_id = $1 AND world_view_id = $2 AND geom IS NOT NULL
  `, [regionId, worldViewId]);
  const geoClusterRegion = new Map<number, { id: number; name: string }>();
  for (const r of childRegionsResult.rows) {
    const rcx = parseFloat(r.cx as string), rcy = parseFloat(r.cy as string);
    const [px, py] = gadmToPixel(rcx, -rcy);
    const ix = Math.round(px), iy = Math.round(py);
    if (ix >= 0 && ix < TW && iy >= 0 && iy < TH) {
      const cl = pixelLabels[iy * TW + ix];
      if (cl < 255 && !geoClusterRegion.has(cl)) {
        geoClusterRegion.set(cl, { id: r.id as number, name: r.name as string });
      }
    }
  }

  // OCR label extraction
  const allChildRegions = await pool.query(
    `SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  cvChildRegions = allChildRegions.rows.map(r => ({ id: r.id as number, name: r.name as string }));
  const ocrClusterRegion = new Map<number, { id: number; name: string }>();
  if (allChildRegions.rows.length > 0) {
    await logStep(`OCR label extraction (${allChildRegions.rows.length} child regions)...`);
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');

      interface OcrWord { text: string; x: number; y: number; w: number; h: number; conf: number }
      const allWords: OcrWord[] = [];

      // Pass 1: color at 1000px
      const ocrW1 = Math.min(1000, origW);
      const ocrH1 = Math.round(origH * (ocrW1 / origW));
      const img1 = await sharp(mapBuffer).resize(ocrW1, ocrH1, { kernel: 'lanczos3' }).sharpen({ sigma: 1.5 }).png().toBuffer();
      const { data: p1 } = await worker.recognize(img1, {}, { blocks: true, text: true });
      const scale1 = 1 / ocrW1;
      let pass1Count = 0;
      for (const block of p1.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const word of line.words) {
              if (word.confidence > 15 && word.text.trim().length >= 2) {
                pass1Count++;
                allWords.push({
                  text: word.text.trim(),
                  x: word.bbox.x0 * scale1, y: word.bbox.y0 * scale1,
                  w: (word.bbox.x1 - word.bbox.x0) * scale1,
                  h: (word.bbox.y1 - word.bbox.y0) * scale1,
                  conf: word.confidence,
                });
              }
            }
          }
        }
      }

      // Pass 2: grayscale at 1500px
      const ocrW2 = Math.min(1500, origW);
      const ocrH2 = Math.round(origH * (ocrW2 / origW));
      const img2 = await sharp(mapBuffer).resize(ocrW2, ocrH2, { kernel: 'lanczos3' }).grayscale().sharpen({ sigma: 2 }).png().toBuffer();
      const { data: p2 } = await worker.recognize(img2, {}, { blocks: true, text: true });
      const scale2 = 1 / ocrW2;
      let pass2Count = 0;
      for (const block of p2.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const word of line.words) {
              if (word.confidence > 15 && word.text.trim().length >= 2) {
                const normX = word.bbox.x0 * scale2, normY = word.bbox.y0 * scale2;
                const dup = allWords.some(w =>
                  Math.abs(w.x - normX) < 0.03 && Math.abs(w.y - normY) < 0.02 &&
                  w.text.toLowerCase().replace(/[^a-z]/g, '') === word.text.trim().toLowerCase().replace(/[^a-z]/g, ''),
                );
                if (dup) continue;
                pass2Count++;
                allWords.push({
                  text: word.text.trim(),
                  x: normX, y: normY,
                  w: (word.bbox.x1 - word.bbox.x0) * scale2,
                  h: (word.bbox.y1 - word.bbox.y0) * scale2,
                  conf: word.confidence,
                });
              }
            }
          }
        }
      }
      await worker.terminate();

      console.log(`  [OCR] Pass 1 (color 1000px): ${pass1Count} words. Pass 2 (gray 1500px): ${pass2Count} new words. Total: ${allWords.length}`);
      console.log(`  [OCR] Sample: ${allWords.slice(0, 20).map(w => `"${w.text}"(${Math.round(w.conf)}%)`).join(', ')}${allWords.length > 20 ? '...' : ''}`);

      const childNames = allChildRegions.rows.map(r => ({
        id: r.id as number,
        name: r.name as string,
        nameLower: (r.name as string).toLowerCase().replace(/[^a-z ]/g, ''),
        words: (r.name as string).toLowerCase().split(/\s+/),
      }));

      // Helper: check if two strings differ by at most 1 character
      function levenshtein1(a: string, b: string): boolean {
        if (Math.abs(a.length - b.length) > 1) return false;
        let diffs = 0;
        for (let i = 0, j = 0; i < a.length && j < b.length;) {
          if (a[i] !== b[j]) {
            diffs++;
            if (diffs > 1) return false;
            if (a.length > b.length) i++;
            else if (b.length > a.length) j++;
            else { i++; j++; }
          } else { i++; j++; }
        }
        return true;
      }

      function ocrWordMatches(ocrText: string, regionWord: string): boolean {
        const o = ocrText.toLowerCase().replace(/[^a-z]/g, '');
        const r = regionWord.toLowerCase().replace(/[^a-z]/g, '');
        if (o.length < 3 || r.length < 3) return false;
        if (r.includes(o) || o.includes(r)) return true;
        if (Math.abs(o.length - r.length) <= 1 && levenshtein1(o, r)) return true;
        if (o.length >= 4 && (r.startsWith(o) || r.endsWith(o) || o.startsWith(r) || o.endsWith(r))) return true;
        return false;
      }

      function ocrWordMatchesFullName(ocrText: string, fullNameLower: string): boolean {
        const o = ocrText.toLowerCase().replace(/[^a-z]/g, '');
        if (o.length < 4) return false;
        return fullNameLower.includes(o);
      }

      const wordFreq = new Map<string, number>();
      for (const c of childNames) {
        for (const w of c.words) {
          const clean = w.replace(/[^a-z]/g, '');
          if (clean.length >= 3) wordFreq.set(clean, (wordFreq.get(clean) || 0) + 1);
        }
      }
      const commonWords = new Set([...wordFreq].filter(([, n]) => n > 1).map(([w]) => w));
      if (commonWords.size > 0) {
        console.log(`  [OCR] Common words across region names: ${[...commonWords].join(', ')}`);
      }

      const ocrToProc = TW;
      const usedRegionIds = new Set<number>();

      function countDistinctMatches(group: OcrWord[], regionWords: string[]): { count: number; hasDistinguishing: boolean } {
        const matchedIndices = new Set<number>();
        for (const w of group) {
          for (let i = 0; i < regionWords.length; i++) {
            if (matchedIndices.has(i)) continue;
            if (ocrWordMatches(w.text, regionWords[i])) {
              matchedIndices.add(i);
              break;
            }
          }
        }
        const hasDistinguishing = [...matchedIndices].some(i => {
          const clean = regionWords[i].replace(/[^a-z]/g, '');
          return !commonWords.has(clean);
        });
        return { count: matchedIndices.size, hasDistinguishing };
      }

      for (const child of childNames) {
        const hasNonCommonWords = child.words.some(w => !commonWords.has(w.replace(/[^a-z]/g, '')));

        let bestWordGroup: OcrWord[] | null = null;
        let bestDistinct = 0;
        let bestHasDistinguishing = false;

        for (const w of allWords) {
          const matchesWord = child.words.some(cw => ocrWordMatches(w.text, cw));
          const matchesFullName = ocrWordMatchesFullName(w.text, child.nameLower);
          if (!matchesWord && !matchesFullName) continue;

          const group = [w];
          for (const w2 of allWords) {
            if (w2 === w) continue;
            if (Math.abs(w2.y - w.y) > w.h * 1.5) continue;
            if (Math.abs(w2.x - (w.x + w.w)) > w.h * 5 && Math.abs(w.x - (w2.x + w2.w)) > w.h * 5) continue;
            if (child.words.some(cw => ocrWordMatches(w2.text, cw)) || ocrWordMatchesFullName(w2.text, child.nameLower)) {
              group.push(w2);
            }
          }

          const { count, hasDistinguishing } = countDistinctMatches(group, child.words);
          if (count > bestDistinct || (count === bestDistinct && hasDistinguishing && !bestHasDistinguishing)) {
            bestDistinct = count;
            bestWordGroup = group;
            bestHasDistinguishing = hasDistinguishing;
          }
        }

        if (!bestWordGroup || bestDistinct === 0) continue;

        if (hasNonCommonWords && !bestHasDistinguishing) {
          const matchedText = bestWordGroup.map(w => w.text).join(' ');
          console.log(`  [OCR] "${matchedText}" ~ "${child.name}" — only common words matched, skipping`);
          continue;
        }

        const cx = bestWordGroup.reduce((s, w) => s + w.x + w.w / 2, 0) / bestWordGroup.length;
        const cy = bestWordGroup.reduce((s, w) => s + w.y + w.h / 2, 0) / bestWordGroup.length;
        const px = Math.round(cx * ocrToProc);
        const py = Math.round(cy * ocrToProc);

        let cluster = -1;
        const searchR = Math.max(5, Math.round(TW * 0.02));
        const clusterVotes = new Map<number, number>();
        for (let dy = -searchR; dy <= searchR; dy++) {
          for (let dx = -searchR; dx <= searchR; dx++) {
            const sx = px + dx, sy = py + dy;
            if (sx >= 0 && sx < TW && sy >= 0 && sy < TH) {
              const cl = pixelLabels[sy * TW + sx];
              if (cl < 255) clusterVotes.set(cl, (clusterVotes.get(cl) || 0) + 1);
            }
          }
        }
        if (clusterVotes.size > 0) {
          cluster = [...clusterVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
        }

        const matchedText = bestWordGroup.map(w => w.text).join(' ');
        if (cluster >= 0 && !ocrClusterRegion.has(cluster) && !usedRegionIds.has(child.id)) {
          ocrClusterRegion.set(cluster, { id: child.id, name: child.name });
          usedRegionIds.add(child.id);
          console.log(`  [OCR] "${matchedText}" → "${child.name}" (cluster ${cluster}, ${bestDistinct}/${child.words.length} distinct words, pos ${px},${py})`);
        } else {
          console.log(`  [OCR] "${matchedText}" ~ "${child.name}" — cluster ${cluster} ${ocrClusterRegion.has(cluster) ? '(already assigned)' : usedRegionIds.has(child.id) ? '(region used)' : '(no cluster)'}`);
        }
      }

      // Debug image: OCR words on source map
      const origResized = await sharp(mapBuffer)
        .removeAlpha()
        .resize(TW, TH, { kernel: 'lanczos3' })
        .raw()
        .toBuffer();
      const ocrDebugBuf = Buffer.from(origResized);

      const matchedRegionIds = new Set<number>(
        [...ocrClusterRegion.values()].map(r => r.id),
      );

      for (const w of allWords) {
        const isMatched = childNames.some(c =>
          matchedRegionIds.has(c.id) && (
            c.words.some(cw => ocrWordMatches(w.text, cw)) ||
            ocrWordMatchesFullName(w.text, c.nameLower)
          ),
        );
        const bx = Math.round(w.x * ocrToProc), by = Math.round(w.y * ocrToProc);
        const bw = Math.max(1, Math.round(w.w * ocrToProc)), bh = Math.max(1, Math.round(w.h * ocrToProc));
        const [cr, cg, cb] = isMatched ? [0, 255, 0] : [255, 80, 80];
        for (let x = bx; x < Math.min(TW, bx + bw); x++) {
          for (const y of [by, Math.min(TH - 1, by + bh)]) {
            const idx = (y * TW + x) * 3;
            ocrDebugBuf[idx] = cr; ocrDebugBuf[idx + 1] = cg; ocrDebugBuf[idx + 2] = cb;
          }
        }
        for (let y = by; y < Math.min(TH, by + bh); y++) {
          for (const x of [bx, Math.min(TW - 1, bx + bw)]) {
            const idx = (y * TW + x) * 3;
            ocrDebugBuf[idx] = cr; ocrDebugBuf[idx + 1] = cg; ocrDebugBuf[idx + 2] = cb;
          }
        }
      }
      const ocrDebugPng = await sharp(ocrDebugBuf, { raw: { width: TW, height: TH, channels: 3 } })
        .resize(origW, origH, { kernel: 'lanczos3' })
        .png()
        .toBuffer();
      await pushDebugImage(
        `OCR: ${allWords.length} words found, ${ocrClusterRegion.size}/${childNames.length} regions matched (green=matched, red=detected)`,
        `data:image/png;base64,${ocrDebugPng.toString('base64')}`,
      );
    } catch (ocrErr) {
      console.warn('  [OCR] Label extraction failed:', ocrErr instanceof Error ? ocrErr.message : ocrErr);
    }
  }

  // Build cluster suggestion groups
  const totalCountryPixels = [...finalClusters.values()].reduce((a, b) => a + b, 0);
  const clusterResult = [...finalClusters].map(([clusterId, pixelCount]) => {
    const c = colorCentroids[clusterId]!;
    const hex = `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
    let suggestedRegion: { id: number; name: string } | null = null;
    const regionVotes = clusterRegionVotes.get(clusterId);
    if (regionVotes) {
      let bestCount = 0;
      for (const [rId, { count, name }] of regionVotes) {
        if (count > bestCount) { bestCount = count; suggestedRegion = { id: rId, name }; }
      }
    }
    if (!suggestedRegion) suggestedRegion = ocrClusterRegion.get(clusterId) ?? null;
    if (!suggestedRegion) suggestedRegion = geoClusterRegion.get(clusterId) ?? null;
    return {
      clusterId, color: hex,
      pixelShare: Math.round((pixelCount / totalCountryPixels) * 100) / 100,
      suggestedRegion,
      divisions: finalAssignments.filter(a => a.clusterId === clusterId).map(d => ({
        id: d.divisionId, name: divNameMap.get(d.divisionId) ?? `#${d.divisionId}`,
        confidence: d.confidence, depth: d.depth,
        ...(d.parentDivisionId ? { parentDivisionId: d.parentDivisionId } : {}),
      })),
      unsplittable: unsplittableDivs.filter(a => a.clusterId === clusterId).map(u => ({
        id: u.divisionId, name: divNameMap.get(u.divisionId) ?? `#${u.divisionId}`,
        confidence: u.confidence, splitClusters: u.splitClusters,
      })),
    };
  });

  cvClusterResult = clusterResult;
  console.log(`  Assignment: ${finalAssignments.length} resolved, ${unsplittableDivs.length} unsplittable, ${splitDepth} depth levels, ${finalClusters.size} clusters`);

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

  // Build interactive geo preview data
  {
    const divClusterMap = new Map<number, { clusterId: number; confidence: number }>();
    for (const a of finalAssignments) divClusterMap.set(a.divisionId, { clusterId: a.clusterId, confidence: a.confidence });
    const unsplittableSet = new Set(unsplittableDivs.map(u => u.divisionId));
    for (const u of unsplittableDivs) {
      if (!divClusterMap.has(u.divisionId)) {
        divClusterMap.set(u.divisionId, { clusterId: u.clusterId, confidence: u.confidence });
      }
    }

    const outOfBoundsIdSet = new Set(cvOutOfBounds.map(o => o.id));
    const allFinalIds = [...new Set([
      ...finalAssignments.map(a => a.divisionId),
      ...unsplittableDivs.map(u => u.divisionId),
      ...cvOutOfBounds.map(o => o.id),
    ])];

    const geoResult = await pool.query(`
      SELECT id, ST_AsGeoJSON(geom_simplified_medium, 5) AS geojson
      FROM administrative_divisions
      WHERE id = ANY($1) AND geom_simplified_medium IS NOT NULL
    `, [allFinalIds]);

    const clusterColorMap = new Map(clusterResult.map(c => [c.clusterId, c.color]));
    const clusterRegionMap = new Map(clusterResult.map(c => [c.clusterId, c.suggestedRegion]));

    const features: GeoJSON.Feature[] = [];
    for (const r of geoResult.rows) {
      const divId = r.id as number;
      const assignment = divClusterMap.get(divId);
      const clusterId = assignment?.clusterId ?? -1;
      const region = clusterRegionMap.get(clusterId);
      const isOob = outOfBoundsIdSet.has(divId);
      features.push({
        type: 'Feature',
        properties: {
          divisionId: divId,
          name: divNameMap.get(divId) ?? `#${divId}`,
          clusterId: isOob ? -1 : clusterId,
          confidence: isOob ? 0 : (assignment?.confidence ?? 0),
          isUnsplittable: unsplittableSet.has(divId),
          isOutOfBounds: isOob,
          color: isOob ? '#888888' : (clusterColorMap.get(clusterId) ?? '#cccccc'),
          regionId: isOob ? null : (region?.id ?? null),
          regionName: isOob ? null : (region?.name ?? null),
        },
        geometry: JSON.parse(r.geojson as string),
      });
    }

    const geoClusterInfos = clusterResult.map(c => ({
      clusterId: c.clusterId,
      color: c.color,
      regionId: c.suggestedRegion?.id ?? null,
      regionName: c.suggestedRegion?.name ?? null,
    }));

    geoPreview = {
      featureCollection: { type: 'FeatureCollection', features },
      clusterInfos: geoClusterInfos,
    };
  }

  console.log(`  Source map: ${origW}x${origH} → ${TW}x${TH}, regions: ${finalClusters.size}, ICP: ${best.label} (err=${best.error.toFixed(2)}, overflow=${best.overflow.toFixed(1)})`);

  const assignedCount = centroids.filter(c => c.assigned).length;
  console.log(`CV color match: ${regionName} (${countryName}), ${centroids.length} divisions (${assignedCount} assigned)`);

  sendEvent({
    type: 'complete',
    elapsed: (Date.now() - startTime) / 1000,
    data: {
      clusters: cvClusterResult,
      childRegions: cvChildRegions,
      outOfBounds: cvOutOfBounds.length > 0 ? cvOutOfBounds : undefined,
      debugImages,
      geoPreview: geoPreview ?? undefined,
      stats: {
        totalDivisions: centroids.length,
        assignedDivisions: assignedCount,
        cvClusters: cvClusterResult.length,
        cvAssignedDivisions: cvClusterResult.reduce((sum, c) => sum + c.divisions.length, 0),
        cvUnsplittable: cvClusterResult.reduce((sum, c) => sum + c.unsplittable.length, 0),
        cvOutOfBounds: cvOutOfBounds.length,
        countryName,
      },
    },
  });
}
