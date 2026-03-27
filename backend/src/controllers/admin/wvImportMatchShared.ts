/**
 * Shared division-matching orchestrator for CV color match.
 *
 * Coordinates the full pipeline: cluster cleaning → interactive review →
 * ICP alignment → division assignment → result assembly.
 * Each phase lives in its own module; this file manages the sequence,
 * SSE events, and interactive cluster review loop.
 */

import sharp from 'sharp';
import { pool } from '../../db/index.js';
import {
  pendingClusterReviews,
  clusterPreviewImages,
  storeClusterHighlights,
  pendingIcpAdjustments,
  type IcpAdjustmentDecision,
} from './wvImportMatchReview.js';
import { cleanClusters } from './wvImportMatchClusterClean.js';
import {
  alignDivisionsToImage,
  detectBboxInflation,
  findBboxOutliers,
  findOverlapOutliers,
  computeShoelaceArea,
  computeBboxFromDivisions,
  type AlignmentResult,
  type DivisionBbox,
} from './wvImportMatchIcp.js';
import { parseSvgPathPoints } from './wvImportMatchSvgHelpers.js';
import { assignDivisionsToClusters } from './wvImportMatchAssignment.js';
import { getAdjacencyGraph, detectSpatialAnomalies } from '../../services/worldViewImport/spatialAnomalyDetector.js';
import type { AdjacencyEdge, DivisionAssignment, SpatialAnomaly } from '../../services/worldViewImport/spatialAnomalyDetector.js';

// Re-export SVG helpers for backward compatibility (used by other modules)
export { parseSvgPathPoints, parseSvgSubPaths, resamplePath } from './wvImportMatchSvgHelpers.js';

// =============================================================================
// Exported types
// =============================================================================

export interface MatchDivisionsParams {
  worldViewId: number;
  regionId: number;
  knownDivisionIds: Set<number>;
  countryIds: number[];
  countryDepth: number;
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
  preset: 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy';
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
    worldViewId, regionId, knownDivisionIds, countryIds, countryDepth,
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

  /**
   * Find connected components with morphological erosion to break thin bridges.
   * Erodes the cluster mask, finds CCA on the eroded mask, then expands
   * components back to original pixels via BFS (Voronoi-like assignment).
   * Returns pixel index arrays per component, sorted by size descending.
   */
  function findComponentsWithErosion(lbl: number, minSize: number): number[][] {
    // Build binary mask
    const mask = new Uint8Array(tp);
    let total = 0;
    for (let i = 0; i < tp; i++) if (pixelLabels[i] === lbl) { mask[i] = 1; total++; }

    const erosionIter = Math.max(1, pxS(1)); // ~2 iterations at 800px
    const useErosion = total > 200 && erosionIter > 0;

    // Erode to break thin bridges
    let eroded = mask;
    if (useErosion) {
      for (let e = 0; e < erosionIter; e++) {
        const next = new Uint8Array(tp);
        for (let i = 0; i < tp; i++) {
          if (!eroded[i]) continue;
          const x = i % TW, y = (i - x) / TW;
          if (x > 0 && x < TW - 1 && y > 0 && y < TH - 1 &&
              eroded[i - 1] && eroded[i + 1] && eroded[i - TW] && eroded[i + TW]) {
            next[i] = 1;
          }
        }
        eroded = next;
      }
      // If erosion wiped out the cluster, fall back to original mask
      let erodedCount = 0;
      for (let i = 0; i < tp; i++) if (eroded[i]) erodedCount++;
      if (erodedCount < Math.max(20, minSize / 4)) eroded = mask;
    }

    // CCA on (possibly eroded) mask
    const compId = new Int32Array(tp);
    let nextId = 1;
    const rawComps: { id: number; size: number }[] = [];
    for (let seed = 0; seed < tp; seed++) {
      if (!eroded[seed] || compId[seed]) continue;
      let size = 0;
      const stack = [seed];
      while (stack.length) {
        const pix = stack.pop()!;
        if (compId[pix] || !eroded[pix]) continue;
        compId[pix] = nextId;
        size++;
        const x = pix % TW, y = (pix - x) / TW;
        if (y > 0) stack.push(pix - TW);
        if (y < TH - 1) stack.push(pix + TW);
        if (x > 0) stack.push(pix - 1);
        if (x < TW - 1) stack.push(pix + 1);
      }
      rawComps.push({ id: nextId, size });
      nextId++;
    }

    // Filter out tiny eroded fragments (use relaxed threshold since erosion shrinks)
    const erodedMin = Math.max(5, Math.round(minSize / 8));
    const significant = new Set(rawComps.filter(c => c.size >= erodedMin).map(c => c.id));

    // If only 1 significant component, skip expansion
    if (significant.size <= 1) {
      // Collect original pixels via standard CCA (no erosion effect)
      return standardCCA(mask);
    }

    // Zero out insignificant component labels
    for (let i = 0; i < tp; i++) if (compId[i] && !significant.has(compId[i])) compId[i] = 0;

    // Expand eroded components back to original mask via BFS
    const queue: number[] = [];
    for (let i = 0; i < tp; i++) if (compId[i]) queue.push(i);
    let head = 0;
    while (head < queue.length) {
      const pix = queue[head++];
      const id = compId[pix];
      const x = pix % TW, y = (pix - x) / TW;
      if (y > 0 && mask[pix - TW] && !compId[pix - TW]) { compId[pix - TW] = id; queue.push(pix - TW); }
      if (y < TH - 1 && mask[pix + TW] && !compId[pix + TW]) { compId[pix + TW] = id; queue.push(pix + TW); }
      if (x > 0 && mask[pix - 1] && !compId[pix - 1]) { compId[pix - 1] = id; queue.push(pix - 1); }
      if (x < TW - 1 && mask[pix + 1] && !compId[pix + 1]) { compId[pix + 1] = id; queue.push(pix + 1); }
    }

    // Collect final pixels per component
    const result = new Map<number, number[]>();
    for (let i = 0; i < tp; i++) {
      if (!compId[i] || !mask[i]) continue;
      let arr = result.get(compId[i]);
      if (!arr) { arr = []; result.set(compId[i], arr); }
      arr.push(i);
    }
    return Array.from(result.values()).sort((a, b) => b.length - a.length);
  }

  /** Standard CCA without erosion — used as fallback */
  function standardCCA(mask: Uint8Array): number[][] {
    const visited = new Uint8Array(tp);
    const components: number[][] = [];
    for (let seed = 0; seed < tp; seed++) {
      if (!mask[seed] || visited[seed]) continue;
      const comp: number[] = [];
      const stack = [seed];
      while (stack.length) {
        const pix = stack.pop()!;
        if (visited[pix] || !mask[pix]) continue;
        visited[pix] = 1;
        comp.push(pix);
        const x = pix % TW, y = (pix - x) / TW;
        if (y > 0) stack.push(pix - TW);
        if (y < TH - 1) stack.push(pix + TW);
        if (x > 0) stack.push(pix - 1);
        if (x < TW - 1) stack.push(pix + 1);
      }
      components.push(comp);
    }
    return components.sort((a, b) => b.length - a.length);
  }

  // Compute countrySize from mask
  let countrySize = 0;
  for (let i = 0; i < tp; i++) {
    if (countryMask[i]) countrySize++;
  }

  // ── Load division data from DB ──

  let targetDepth = countryDepth === 0 ? 1 : countryDepth;
  let allDivsResult = await pool.query(`
    WITH RECURSIVE descendants AS (
      SELECT id, 0 AS depth FROM administrative_divisions WHERE id = ANY($1)
      UNION ALL
      SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
      JOIN descendants d ON ad.parent_id = d.id
      WHERE d.depth < $2
    )
    SELECT id FROM descendants WHERE depth = $2
  `, [countryIds, targetDepth]);

  if (allDivsResult.rows.length <= 1 && targetDepth === countryDepth) {
    targetDepth = countryDepth + 1;
    allDivsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT id, 0 AS depth FROM administrative_divisions WHERE id = ANY($1)
        UNION ALL
        SELECT ad.id, d.depth + 1 FROM administrative_divisions ad
        JOIN descendants d ON ad.parent_id = d.id
        WHERE d.depth < $2
      )
      SELECT id FROM descendants WHERE depth = $2
    `, [countryIds, targetDepth]);
  }

  const allDivisionIdSet = new Set<number>();
  for (const r of allDivsResult.rows) allDivisionIdSet.add(r.id as number);
  for (const id of knownDivisionIds) allDivisionIdSet.add(id);
  const allDivisionIds = [...allDivisionIdSet];

  if (allDivisionIds.length === 0) {
    sendEvent({ type: 'error', message: 'No divisions found at this level' });
    return;
  }

  // Get which divisions are already assigned to CHILD regions (not the parent itself).
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

  // Region + country name for logging
  const regionNameResult = await pool.query(
    `SELECT name FROM regions WHERE id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  const regionName = (regionNameResult.rows[0]?.name as string) ?? `Region#${regionId}`;
  const countryNameResult = await pool.query(
    `SELECT string_agg(name, ' + ' ORDER BY id) AS name FROM administrative_divisions WHERE id = ANY($1)`,
    [countryIds],
  );
  const countryName = (countryNameResult.rows[0]?.name as string) ?? `Country#${countryIds.join('+')}`;


  // ── Phase 1: Cluster cleaning (spatial split, merge, patch cleanup, noise exclusion) ──
  const { finalLabels, quantBuf, icpMask } = await cleanClusters({
    pixelLabels, colorCentroids, buf, countryMask, countrySize,
    TW, TH, origW, origH, pxS, pushDebugImage,
  });

  // ── Phase 2: Interactive cluster review (loops on split requests) ──
  let reviewLoop = !skipClusterReview;
  while (reviewLoop) {
    reviewLoop = false; // Will be set to true only if split is requested
    const clusterInfos: Array<{ label: number; color: [number, number, number]; pxCount: number; pct: number; componentCount: number }> = [];
    for (const lbl of finalLabels) {
      let cnt = 0;
      for (let i = 0; i < tp; i++) if (pixelLabels[i] === lbl) cnt++;
      const c = colorCentroids[lbl];
      if (!c) continue;
      // Connected component analysis with erosion to break thin bridges
      // Use fixed threshold of 20px (matches split logic) — 5% was hiding small
      // disconnected fragments like map title text that users need to split off
      const minCompSize = 20;
      const components = findComponentsWithErosion(lbl, minCompSize);
      const compCount = components.filter(c => c.length >= minCompSize).length;
      clusterInfos.push({ label: lbl, color: [c[0], c[1], c[2]], pxCount: cnt, pct: Math.round(cnt / countrySize * 1000) / 10, componentCount: compCount });
    }
    { // Always show cluster review — user may want to merge, exclude, or recluster
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

      // Generate per-cluster highlight images (bright pink fill on transparent)
      const highlights: Array<{ label: number; png: Buffer }> = [];
      for (const ci of clusterInfos) {
        const hlBuf = Buffer.alloc(tp * 4, 0); // RGBA, all transparent
        for (let i = 0; i < tp; i++) {
          if (pixelLabels[i] !== ci.label) continue;
          hlBuf[i * 4] = 255;     // R
          hlBuf[i * 4 + 1] = 0;   // G
          hlBuf[i * 4 + 2] = 200; // B (hot pink)
          hlBuf[i * 4 + 3] = 140; // A — bright but see-through like a highlighter
        }
        const hlPng = await sharp(hlBuf, { raw: { width: TW, height: TH, channels: 4 } })
          .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
        highlights.push({ label: ci.label, png: hlPng });
      }
      storeClusterHighlights(reviewId, highlights);

      sendEvent({
        type: 'cluster_review',
        reviewId,
        data: {
          clusters: clusterInfos.map(c => ({
            label: c.label,
            color: `rgb(${c.color[0]},${c.color[1]},${c.color[2]})`,
            pct: c.pct,
            isSmall: c.pct < 3,
            componentCount: c.componentCount,
          })),
        },
      });
      await new Promise(resolve => setImmediate(resolve));

      interface ClusterReviewDecision {
        merges: Record<number, number>;
        excludes?: number[];
        recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy' };
        split?: number[];
      }

      const decision = await new Promise<ClusterReviewDecision>((resolve) => {
        pendingClusterReviews.set(reviewId, resolve);
      });

      // Check for recluster request
      if (decision.recluster) {
        console.log(`  [Cluster Review] Recluster requested: ${decision.recluster.preset}`);
        return { recluster: true, preset: decision.recluster.preset };
      }

      // Apply split — erosion-based CCA on each target cluster, assign new labels, loop back
      const splitLabels = (decision.split ?? []).map(Number).filter(l => finalLabels.has(l));
      if (splitLabels.length > 0) {
        await logStep(`Splitting ${splitLabels.length} cluster(s) into connected components...`);
        let nextLabel = Math.max(...finalLabels) + 1;
        for (const lbl of splitLabels) {
          const components = findComponentsWithErosion(lbl, 20);
          const filtered = components.filter(c => c.length >= 20);
          if (filtered.length <= 1) {
            console.log(`  [Split] Cluster ${lbl}: only 1 significant component, skipping`);
            continue;
          }
          console.log(`  [Split] Cluster ${lbl}: ${filtered.length} components (${filtered.map(c => c.length + 'px').join(', ')})`);
          const origColor = colorCentroids[lbl] ?? [128, 128, 128];
          for (let ci = 1; ci < filtered.length; ci++) {
            const newLbl = nextLabel++;
            for (const pix of filtered[ci]) pixelLabels[pix] = newLbl;
            finalLabels.add(newLbl);
            colorCentroids[newLbl] = [...origColor] as [number, number, number];
            console.log(`  [Split] New cluster ${newLbl}: ${filtered[ci].length}px (split from cluster ${lbl})`);
          }
        }
        console.log(`  [Split] Now ${finalLabels.size} clusters — looping back to review`);
        reviewLoop = true;
      }

      if (reviewLoop) continue;

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

  // Recount clusters after review modifications
  const postReviewClusters = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) postReviewClusters.set(pixelLabels[i], (postReviewClusters.get(pixelLabels[i]) || 0) + 1);
  }

  // Rebuild ICP mask after review exclusions — excluded clusters must not affect
  // border detection or bbox computation (e.g. title text marked for removal)
  for (let i = 0; i < tp; i++) {
    if (icpMask[i] && pixelLabels[i] === 255) icpMask[i] = 0;
  }

  // ── Phase 3: ICP alignment ──
  await logStep('ICP alignment (matching GADM boundary to CV silhouette)...');

  const icpResult = await alignDivisionsToImage({
    divPaths, countryPath,
    cMinX, cMinY, cMaxX, cMaxY,
    icpMask, pixelLabels,
    TW, TH, origW, origH,
    quantBuf, centroids, mapBuffer,
    pxS, pushDebugImage,
  });

  let { gadmToPixel } = icpResult;
  const { bestLabel, bestError, bestOverflow, gBbox, cBbox } = icpResult;

  // Check for bbox inflation (islands problem)
  const inflationDetected = detectBboxInflation(gBbox, cBbox, bestOverflow, TW, TH);

  if (inflationDetected) {
    console.log(`  [ICP] Bbox inflation detected — aspect ratio mismatch + high overflow (err=${bestError.toFixed(1)}, overflow=${bestOverflow.toFixed(0)}px)`);
    const reviewId = `icp-adj-${Date.now()}`;

    sendEvent({
      type: 'icp_adjustment_available',
      reviewId,
      message: 'Alignment quality is lower than expected, possibly due to small islands or features not shown on the map.',
      metrics: { overflow: Math.round(bestOverflow), error: Math.round(bestError * 10) / 10, icpOption: bestLabel },
    });
    await new Promise(resolve => setImmediate(resolve));

    const decision = await new Promise<IcpAdjustmentDecision>((resolve) => {
      pendingIcpAdjustments.set(reviewId, resolve);
      setTimeout(() => {
        if (pendingIcpAdjustments.has(reviewId)) {
          console.log(`  [ICP Adjustment] Review ${reviewId} timed out — continuing with original`);
          pendingIcpAdjustments.delete(reviewId);
          resolve({ action: 'continue' });
        }
      }, 300000);
    });

    if (decision.action === 'adjust') {
      await logStep('Adjusting ICP alignment (excluding outlier divisions)...');

      // Parse division SVG points
      const divParsed = divPaths.map(d => ({
        id: d.id,
        points: parseSvgPathPoints(d.svgPath),
      }));

      // Compute per-division bboxes + areas
      const divBboxes: DivisionBbox[] = divParsed.map(d => {
        let dMinX = Infinity, dMaxX = -Infinity, dMinY = Infinity, dMaxY = -Infinity;
        for (const [x, y] of d.points) {
          if (x < dMinX) dMinX = x; if (x > dMaxX) dMaxX = x;
          if (y < dMinY) dMinY = y; if (y > dMaxY) dMaxY = y;
        }
        return { id: d.id, minX: dMinX, maxX: dMaxX, minY: dMinY, maxY: dMaxY, area: computeShoelaceArea(d.points) };
      });

      const icpParams = {
        divPaths, countryPath,
        cMinX, cMinY, cMaxX, cMaxY,
        icpMask, pixelLabels,
        TW, TH, origW, origH,
        quantBuf, centroids, mapBuffer,
        pxS, pushDebugImage,
      };

      // Strategy B: BBox contribution analysis
      const excludedB = findBboxOutliers(divBboxes, cBbox);
      const remainingB = divBboxes.filter(d => !excludedB.includes(d.id));
      let resultB: AlignmentResult | null = null;
      if (excludedB.length > 0 && remainingB.length > 0) {
        const bboxB = computeBboxFromDivisions(remainingB);
        console.log(`  [ICP Adjust B] Excluded ${excludedB.length} divisions: [${excludedB}]`);
        resultB = await alignDivisionsToImage({ ...icpParams, gBboxOverride: bboxB, scaleRange: 0.25 });
      }

      // Strategy C: CV-GADM overlap check
      const excludedC = findOverlapOutliers(divParsed, gadmToPixel, icpMask, TW, TH);
      const remainingC = divBboxes.filter(d => !excludedC.includes(d.id));
      let resultC: AlignmentResult | null = null;
      if (excludedC.length > 0 && remainingC.length > 0) {
        const bboxC = computeBboxFromDivisions(remainingC);
        console.log(`  [ICP Adjust C] Excluded ${excludedC.length} divisions: [${excludedC}]`);
        resultC = await alignDivisionsToImage({ ...icpParams, gBboxOverride: bboxC, scaleRange: 0.25 });
      }

      // Pick best result
      const candidates: Array<{ label: string; overflow: number; error: number; result: AlignmentResult | null }> = [
        { label: 'original', overflow: bestOverflow, error: bestError, result: null },
      ];
      if (resultB) candidates.push({ label: 'strategyB', overflow: resultB.bestOverflow, error: resultB.bestError, result: resultB });
      if (resultC) candidates.push({ label: 'strategyC', overflow: resultC.bestOverflow, error: resultC.bestError, result: resultC });
      candidates.sort((a, b) => {
        if (Math.abs(a.overflow - b.overflow) < 3) return a.error - b.error;
        return a.overflow - b.overflow;
      });

      const winner = candidates[0];
      if (winner.result) {
        gadmToPixel = winner.result.gadmToPixel;
        console.log(`  [ICP Adjust] Winner: ${winner.label} (ICP ${winner.result.bestLabel}, err=${winner.result.bestError.toFixed(1)}, overflow=${winner.result.bestOverflow.toFixed(0)}px)`);
      } else {
        console.log(`  [ICP Adjust] Original alignment was best — keeping it`);
      }
    } else {
      console.log(`  [ICP Adjustment] User chose to continue with original alignment`);
    }
  }

  // ── Phase 4: Division-to-cluster assignment ──
  await logStep('Assigning GADM divisions to color regions...');

  const assignmentResult = await assignDivisionsToClusters({
    divPaths, centroids, divNameMap, gadmToPixel,
    pixelLabels, buf, colorCentroids, countrySize,
    TW, TH, origW, origH, pxS, logStep, pushDebugImage,
  });

  const {
    divAssignments, finalAssignments, unsplittableDivs,
    outOfBounds: cvOutOfBounds, splitDepth,
  } = assignmentResult;

  // ── Phase 5: Match clusters to child regions + build results ──

  // Match clusters to child regions via assigned divisions
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

  // Child regions (used for result output)
  const allChildRegions = await pool.query(
    `SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2`,
    [regionId, worldViewId],
  );
  const cvChildRegions = allChildRegions.rows.map(r => ({ id: r.id as number, name: r.name as string }));
  const ocrClusterRegion = new Map<number, { id: number; name: string }>();

  // Filter out already-assigned divisions from results — only show gap divisions.
  const knownOrChildOfKnown = new Set(knownDivisionIds);
  for (const a of finalAssignments) {
    if (a.parentDivisionId && knownDivisionIds.has(a.parentDivisionId)) {
      knownOrChildOfKnown.add(a.divisionId);
      if (!assignedMap.has(a.divisionId) && assignedMap.has(a.parentDivisionId)) {
        assignedMap.set(a.divisionId, assignedMap.get(a.parentDivisionId)!);
      }
    }
  }
  // Walk deeper: children-of-children of known divisions
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of finalAssignments) {
      if (a.parentDivisionId && knownOrChildOfKnown.has(a.parentDivisionId) && !knownOrChildOfKnown.has(a.divisionId)) {
        knownOrChildOfKnown.add(a.divisionId);
        if (!assignedMap.has(a.divisionId) && assignedMap.has(a.parentDivisionId)) {
          assignedMap.set(a.divisionId, assignedMap.get(a.parentDivisionId)!);
        }
        changed = true;
      }
    }
  }
  const gapAssignments = finalAssignments.filter(a => !knownOrChildOfKnown.has(a.divisionId));
  const gapUnsplittable = unsplittableDivs.filter(u => !knownOrChildOfKnown.has(u.divisionId));
  console.log(`  Gap filter: ${finalAssignments.length} total → ${gapAssignments.length} gap divisions (${knownOrChildOfKnown.size} already assigned)`);

  // Build cluster suggestion groups
  const totalCountryPixels = [...postReviewClusters.values()].reduce((a, b) => a + b, 0);
  const clusterResult = [...postReviewClusters].map(([clusterId, pixelCount]) => {
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
      divisions: gapAssignments.filter(a => a.clusterId === clusterId).map(d => ({
        id: d.divisionId, name: divNameMap.get(d.divisionId) ?? `#${d.divisionId}`,
        confidence: d.confidence, depth: d.depth,
        ...(d.parentDivisionId ? { parentDivisionId: d.parentDivisionId } : {}),
      })),
      unsplittable: gapUnsplittable.filter(a => a.clusterId === clusterId).map(u => ({
        id: u.divisionId, name: divNameMap.get(u.divisionId) ?? `#${u.divisionId}`,
        confidence: u.confidence, splitClusters: u.splitClusters,
      })),
    };
  }).filter(c => c.divisions.length > 0 || c.unsplittable.length > 0);

  const cvClusterResult = clusterResult;
  console.log(`  Assignment: ${finalAssignments.length} resolved, ${unsplittableDivs.length} unsplittable, ${splitDepth} depth levels, ${postReviewClusters.size} clusters`);

  // Build interactive geo preview data
  let geoPreview: {
    featureCollection: GeoJSON.FeatureCollection;
    clusterInfos: Array<{ clusterId: number; color: string; regionId: number | null; regionName: string | null }>;
  } | null = null;
  {
    const divClusterMap = new Map<number, { clusterId: number; confidence: number }>();
    for (const a of finalAssignments) divClusterMap.set(a.divisionId, { clusterId: a.clusterId, confidence: a.confidence });
    const unsplittableSet = new Set(gapUnsplittable.map(u => u.divisionId));
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
      const isPreAssigned = knownOrChildOfKnown.has(divId);
      const existingAssignment = assignedMap.get(divId);
      features.push({
        type: 'Feature',
        properties: {
          divisionId: divId,
          name: divNameMap.get(divId) ?? `#${divId}`,
          clusterId: isOob ? -1 : clusterId,
          confidence: isOob ? 0 : (assignment?.confidence ?? 0),
          isUnsplittable: unsplittableSet.has(divId),
          isOutOfBounds: isOob,
          preAssigned: isPreAssigned,
          color: isOob ? '#888888' : (clusterColorMap.get(clusterId) ?? '#cccccc'),
          regionId: isPreAssigned && existingAssignment
            ? existingAssignment.regionId
            : (isOob ? null : (region?.id ?? null)),
          regionName: isPreAssigned && existingAssignment
            ? existingAssignment.regionName
            : (isOob ? null : (region?.name ?? null)),
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
    console.log(`  [GeoPreview] ${features.length} features, ${geoClusterInfos.length} cluster infos, ${allFinalIds.length} division IDs queried, ${geoResult.rows.length} geom rows returned`);
  }

  console.log(`  Source map: ${origW}x${origH} → ${TW}x${TH}, regions: ${postReviewClusters.size}, ICP: ${bestLabel} (err=${bestError.toFixed(2)}, overflow=${bestOverflow.toFixed(1)})`);

  const assignedCount = centroids.filter(c => c.assigned).length;
  const gapCount = centroids.length - assignedCount;
  console.log(`CV color match: ${regionName} (${countryName}), ${centroids.length} divisions (${assignedCount} already assigned, ${gapCount} gaps)`);

  // ── Spatial anomaly detection on suggested assignments ───────────────────────
  let spatialAnomalies: SpatialAnomaly[] = [];
  let adjacencyEdges: AdjacencyEdge[] = [];
  try {
    // Build combined assignments: existing members + CV suggestions
    const existingMembers = await pool.query<{
      member_row_id: number; region_id: number; division_id: number; division_name: string;
    }>(
      `SELECT rm.id AS member_row_id, rm.region_id, rm.division_id, ad.name AS division_name
       FROM region_members rm
       JOIN administrative_divisions ad ON ad.id = rm.division_id
       WHERE rm.region_id IN (SELECT id FROM regions WHERE parent_region_id = (
         SELECT parent_region_id FROM regions WHERE id = $1
       ) AND world_view_id = $2)
       AND rm.custom_geom IS NULL`,
      [regionId, worldViewId],
    );

    // Build region name lookup from child regions
    const regionNameMap = new Map(cvChildRegions.map(r => [r.id, r.name]));

    const allAssignments: DivisionAssignment[] = existingMembers.rows.map(m => ({
      divisionId: m.division_id,
      memberRowId: m.member_row_id,
      regionId: m.region_id,
      regionName: regionNameMap.get(m.region_id) ?? 'Unknown',
      divisionName: m.division_name,
    }));

    // Add CV suggested assignments (memberRowId = null, not yet committed)
    const existingDivIds = new Set(allAssignments.map(a => a.divisionId));
    for (const cluster of cvClusterResult) {
      if (!cluster.suggestedRegion) continue;
      for (const div of cluster.divisions) {
        if (existingDivIds.has(div.id)) continue; // already assigned
        allAssignments.push({
          divisionId: div.id,
          memberRowId: null,
          regionId: cluster.suggestedRegion.id,
          regionName: cluster.suggestedRegion.name,
          divisionName: div.name,
        });
      }
    }

    if (allAssignments.length >= 2) {
      const allDivIds = allAssignments.map(a => a.divisionId);
      adjacencyEdges = await getAdjacencyGraph(allDivIds);
      spatialAnomalies = detectSpatialAnomalies(allAssignments, adjacencyEdges);
    }
  } catch (err) {
    // Non-fatal: log and continue without anomaly data
    console.warn('Spatial anomaly detection failed:', err);
  }

  sendEvent({
    type: 'complete',
    elapsed: (Date.now() - startTime) / 1000,
    data: {
      clusters: cvClusterResult,
      childRegions: cvChildRegions,
      outOfBounds: cvOutOfBounds.length > 0 ? cvOutOfBounds : undefined,
      debugImages,
      geoPreview: geoPreview ?? undefined,
      spatialAnomalies: spatialAnomalies.length > 0 ? spatialAnomalies : undefined,
      adjacencyEdges: adjacencyEdges.length > 0 ? adjacencyEdges : undefined,
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
