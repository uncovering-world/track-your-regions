/**
 * Helper functions for WorldView Import Match pipeline.
 *
 * Extracted from wvImportMatchController.ts (Task 2 of the split).
 * Contains: color-space conversion, map noise removal, GIS/SVG generation,
 * Wikivoyage marker fetching, and image processing utilities.
 */

import sharp from 'sharp';
import { pool } from '../../db/index.js';
import { parseMarkers, parseGeoTag } from '../../services/wikivoyageExtract/markerParser.js';
import { resolveMarkerCoordinates } from '../../services/worldViewImport/pointMatcher.js';
import { pendingWaterReviews, storeWaterCrops, type WaterReviewDecision } from './wvImportMatchReview.js';
import type { PipelineContext } from './wvImportMatchPipeline.js';

// =============================================================================
// Map noise removal helpers
// =============================================================================

// Two-stage approach:
// Stage 1: Color-targeted removal (vivid blue = rivers, vivid red = roads)
// Stage 2: Outlier-based removal (dark text/labels with boundary context check)

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
  else if (max === gf) h = ((bf - rf) / d + 2) / 6;
  else h = ((rf - gf) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Replace noise pixels with component-wise median of non-masked neighbors within given radius */
export function replaceWithNeighborMedian(
  src: Buffer, out: Buffer, mask: Uint8Array,
  w: number, h: number, radius = 5,
): number {
  let replaced = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      const rs: number[] = [], gs: number[] = [], bs: number[] = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          const np = ny * w + nx;
          if (mask[np]) continue;
          rs.push(src[np * 3]); gs.push(src[np * 3 + 1]); bs.push(src[np * 3 + 2]);
        }
      }
      if (rs.length >= 3) {
        rs.sort((a, b) => a - b);
        gs.sort((a, b) => a - b);
        bs.sort((a, b) => a - b);
        const mid = Math.floor(rs.length / 2);
        out[p * 3] = rs[mid]; out[p * 3 + 1] = gs[mid]; out[p * 3 + 2] = bs[mid];
        replaced++;
      }
    }
  }
  return replaced;
}

/** Measure minimum of horizontal and vertical run lengths of consecutive flagged pixels */
export function minRunLength(mask: Uint8Array, w: number, x: number, y: number, maxR: number): number {
  const p = y * w + x;
  let hRun = 1;
  for (let dx = 1; dx <= maxR && x + dx < w; dx++) {
    if (mask[p + dx]) hRun++; else break;
  }
  for (let dx = 1; dx <= maxR && x - dx >= 0; dx++) {
    if (mask[p - dx]) hRun++; else break;
  }
  let vRun = 1;
  const h = mask.length / w;
  for (let dy = 1; dy <= maxR && y + dy < h; dy++) {
    if (mask[(y + dy) * w + x]) vRun++; else break;
  }
  for (let dy = 1; dy <= maxR && y - dy >= 0; dy++) {
    if (mask[(y - dy) * w + x]) vRun++; else break;
  }
  return Math.min(hRun, vRun);
}

/** Detect vivid colored thin lines (rivers, roads, borders) — returns mask only, no modification */
export function detectColoredLines(buf: Buffer, w: number, h: number, resScale = 1): Uint8Array {
  const tp = w * h;
  const maxR = Math.round(14 * resScale);
  const maxThick = Math.round(12 * resScale);
  const ctype = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    const { h: hue, s } = rgbToHsl(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]);
    if (hue >= 170 && hue <= 270 && s > 20) ctype[i] = 1;
    else if ((hue <= 25 || hue >= 335) && s > 40) ctype[i] = 2;
    else if (hue >= 40 && hue <= 70 && s > 40) ctype[i] = 3;
  }
  const mask = new Uint8Array(tp);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!ctype[p]) continue;
      if (minRunLength(ctype, w, x, y, maxR) <= maxThick) mask[p] = 1;
    }
  }
  return mask;
}

/** Stage 1: Remove vivid blue (rivers), red (roads) and yellow (roads/borders) thin line features */
export function removeColoredLines(buf: Buffer, w: number, h: number, resScale = 1): number {
  const tp = w * h;
  const maxR = Math.round(14 * resScale);
  const maxThick = Math.round(12 * resScale);
  const medianR = Math.round(5 * resScale);
  // Classify: 0=keep, 1=blue/cyan, 2=red, 3=yellow
  const ctype = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    const { h: hue, s } = rgbToHsl(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]);
    if (hue >= 170 && hue <= 270 && s > 20) ctype[i] = 1;
    else if ((hue <= 25 || hue >= 335) && s > 40) ctype[i] = 2;
    else if (hue >= 40 && hue <= 70 && s > 40) ctype[i] = 3;
  }

  // Mark thin colored features for removal (no boundary check — rivers/roads are never boundaries)
  const mask = new Uint8Array(tp);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!ctype[p]) continue;
      if (minRunLength(ctype, w, x, y, maxR) <= maxThick) mask[p] = 1;
    }
  }

  const out = Buffer.from(buf);
  const replaced = replaceWithNeighborMedian(buf, out, mask, w, h, medianR);
  out.copy(buf);
  return replaced;
}

// =============================================================================
// GIS / SVG helpers
// =============================================================================

/** Stage 2: Remove dark/text outlier features that sit within a single color region */
export type PointInfo = { name: string; lat: number; lon: number };

export interface SvgDivision { id: number; name: string; svgPath: string; cx: number; cy: number }

/**
 * Generate an SVG map showing numbered division boundaries.
 * PostGIS ST_AsSVG uses negated Y (SVG convention), so cy becomes -cy for label placement.
 */
export function generateDivisionsSvg(divisions: SvgDivision[]): string {
  // Compute bounding box from SVG path coordinates
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of divisions) {
    const nums = d.svgPath.match(/-?\d+\.?\d*/g);
    if (!nums) continue;
    for (let i = 0; i < nums.length; i += 2) {
      const x = parseFloat(nums[i]);
      const y = parseFloat(nums[i + 1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const pad = 0.3;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const geoW = maxX - minX;
  const geoH = maxY - minY;

  // Transform everything to pixel space (no viewBox — sharp renders at pixel resolution)
  const svgWidth = 1200;
  const svgHeight = Math.round(svgWidth * (geoH / geoW));
  const scaleX = svgWidth / geoW;
  const scaleY = svgHeight / geoH;

  // Transform a geo SVG path "M x y L x y ..." to pixel coordinates
  function transformPath(svgPath: string): string {
    return svgPath.replace(/-?\d+\.?\d*/g, (match, offset, str) => {
      // Determine if this is X or Y by counting preceding numbers
      const before = str.slice(0, offset);
      const numsBefore = before.match(/-?\d+\.?\d*/g);
      const idx = numsBefore ? numsBefore.length : 0;
      const val = parseFloat(match);
      if (idx % 2 === 0) {
        // X coordinate
        return ((val - minX) * scaleX).toFixed(1);
      } else {
        // Y coordinate (already negated by PostGIS)
        return ((val - minY) * scaleY).toFixed(1);
      }
    });
  }

  const fontSize = 11;
  const circleR = 8;

  const paths = divisions.map((d, i) => {
    const num = i + 1;
    // Transform centroid to pixel space (negate cy to match SVG path convention)
    const px = ((d.cx - minX) * scaleX).toFixed(1);
    const py = ((-d.cy - minY) * scaleY).toFixed(1);
    const pixelPath = transformPath(d.svgPath);
    return `<path d="${pixelPath}" fill="#ddeeff" stroke="#336" stroke-width="1" opacity="0.8"/>
<circle cx="${px}" cy="${py}" r="${circleR}" fill="white" stroke="#336" stroke-width="0.5" opacity="0.9"/>
<text x="${px}" y="${py}" font-size="${fontSize}" font-family="DejaVu Sans,sans-serif" text-anchor="middle" dominant-baseline="central" fill="#111" font-weight="bold">${num}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
<rect width="${svgWidth}" height="${svgHeight}" fill="#f0f2f5"/>
${paths.join('\n')}
</svg>`;
}

/**
 * Fetch Wikivoyage markers for a region, check which divisions contain them.
 * Returns the points and the set of division IDs that contain at least one point.
 */
export async function fetchMarkersForDivisions(
  regionId: number,
  divisionIds: number[],
): Promise<{ points: PointInfo[]; divisionsWithPoints: Set<number> }> {
  const points: PointInfo[] = [];
  const divisionsWithPoints = new Set<number>();

  if (divisionIds.length === 0) return { points, divisionsWithPoints };

  try {
    const srcResult = await pool.query(
      `SELECT source_url FROM region_import_state WHERE region_id = $1`,
      [regionId],
    );
    const sourceUrl = srcResult.rows[0]?.source_url as string | undefined;
    if (!sourceUrl) return { points, divisionsWithPoints };

    const pageTitle = decodeURIComponent(
      sourceUrl.replace('https://en.wikivoyage.org/wiki/', ''),
    );

    const url = new URL('https://en.wikivoyage.org/w/api.php');
    url.searchParams.set('action', 'parse');
    url.searchParams.set('page', pageTitle);
    url.searchParams.set('prop', 'wikitext');
    url.searchParams.set('format', 'json');

    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': 'TrackYourRegions/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { points, divisionsWithPoints };

    const data = await resp.json() as { parse?: { wikitext?: { '*': string } } };
    const wikitext = data.parse?.wikitext?.['*'] ?? '';
    if (!wikitext) return { points, divisionsWithPoints };

    const markers = parseMarkers(wikitext);
    let resolved = await resolveMarkerCoordinates(markers);

    if (resolved.length === 0) {
      const geo = parseGeoTag(wikitext);
      if (geo) {
        resolved = [{ name: pageTitle, lat: geo.lat, lon: geo.lon, wikidataId: null }];
      }
    }

    if (resolved.length > 0) {
      const containResult = await pool.query(`
        SELECT ad.id AS division_id, p.idx
        FROM administrative_divisions ad,
          LATERAL unnest($2::double precision[], $3::double precision[])
            WITH ORDINALITY AS p(lon, lat, idx)
        WHERE ad.id = ANY($1)
          AND ad.geom_simplified_medium IS NOT NULL
          AND ST_DWithin(ad.geom_simplified_medium::geography, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography, 5000)
      `, [divisionIds, resolved.map(p => p.lon), resolved.map(p => p.lat)]);

      for (const row of containResult.rows) {
        divisionsWithPoints.add(row.division_id as number);
      }
      for (const p of resolved) {
        points.push({ name: p.name, lat: p.lat, lon: p.lon });
      }
    }
  } catch (err) {
    console.warn('[fetchMarkersForDivisions] Failed:', err instanceof Error ? err.message : err);
  }

  return { points, divisionsWithPoints };
}

// =============================================================================
// OpenCV morphological operation helper
// =============================================================================

/**
 * Apply a morphological operation (close, open, etc.) to a binary mask via OpenCV.
 * Previously a closure inside colorMatchDivisionsSSE capturing `cv`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cvMorphOp(cv: any, mask: Uint8Array, w: number, h: number, op: number, kernelSize: number): Uint8Array {
  const mat = cv.matFromArray(h, w, cv.CV_8UC1, mask);
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kernelSize, kernelSize));
  const dst = new cv.Mat();
  cv.morphologyEx(mat, dst, op, kernel);
  const result = new Uint8Array(dst.data);
  mat.delete(); kernel.delete(); dst.delete();
  return result;
}

// =============================================================================
// Outline crop generation
// =============================================================================

/**
 * Generate a crop of the original image with magenta outline for a given pixel set.
 * Previously a closure inside colorMatchDivisionsSSE capturing `TW`, `TH`, `origDownBuf`, and `sharp`.
 */
export async function generateOutlineCrop(
  origDownBuf: Buffer, TW: number, TH: number,
  pixelTest: (si: number) => boolean,
  cxStat: number, cyStat: number, bwStat: number, bhStat: number,
): Promise<string | null> {
  const pad = 20;
  const cropX = Math.max(0, cxStat - pad);
  const cropY = Math.max(0, cyStat - pad);
  const cropW = Math.min(TW - cropX, bwStat + pad * 2);
  const cropH = Math.min(TH - cropY, bhStat + pad * 2);
  if (cropW <= 3 || cropH <= 3) return null;
  const cropBuf = Buffer.alloc(cropW * cropH * 3);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const si = (cropY + y) * TW + (cropX + x);
      const di = (y * cropW + x) * 3;
      cropBuf[di] = origDownBuf[si * 3];
      cropBuf[di + 1] = origDownBuf[si * 3 + 1];
      cropBuf[di + 2] = origDownBuf[si * 3 + 2];
    }
  }
  // Draw 2px magenta border on edge pixels
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const si = (cropY + y) * TW + (cropX + x);
      if (!pixelTest(si)) continue;
      let isEdge = false;
      for (let dy = -1; dy <= 1 && !isEdge; dy++) {
        for (let dx = -1; dx <= 1 && !isEdge; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ny = cropY + y + dy, nx = cropX + x + dx;
          if (ny < 0 || ny >= TH || nx < 0 || nx >= TW || !pixelTest(ny * TW + nx)) isEdge = true;
        }
      }
      if (isEdge) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const py = y + dy, px = x + dx;
            if (py >= 0 && py < cropH && px >= 0 && px < cropW) {
              const di = (py * cropW + px) * 3;
              cropBuf[di] = 255; cropBuf[di + 1] = 0; cropBuf[di + 2] = 255;
            }
          }
        }
      }
    }
  }
  const targetW = Math.min(500, cropW * 2);
  const png = await sharp(cropBuf, { raw: { width: cropW, height: cropH, channels: 3 } })
    .resize(targetW, undefined, { kernel: 'lanczos3' }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// =============================================================================
// Shared water review & finalization
// =============================================================================

interface WaterSubCluster { idx: number; pct: number; cropDataUrl: string }
interface WaterComponent { id: number; area: number; pct: number; cropDataUrl: string; subClusters: WaterSubCluster[] }

/**
 * Shared water review pipeline: CC analysis → narrow-neck splitting →
 * component filtering → crop generation → edge-connectivity filter →
 * final dilation → interactive review → mask rebuild.
 *
 * Called by both the classical pipeline (detectWater) and the mean-shift
 * pipeline (meanshiftPreprocess) after their respective water detection.
 *
 * @param waterMaskIn  Binary water mask (1 = water). Modified in place.
 * @param colorBuf     Color buffer for sub-clustering (inpaintedBuf or mean-shift colorBuf).
 * @param ctx          Pipeline context (for origDownBuf, cv, dimensions, helpers).
 * @returns            Final dilated water mask (waterGrown).
 */
export async function reviewAndFinalizeWater(
  waterMaskIn: Uint8Array,
  colorBuf: Buffer,
  ctx: PipelineContext,
): Promise<Uint8Array> {
  const { cv, TW, TH, tp, oddK, origW, origH, regionId, logStep, pushDebugImage, sendEvent, origDownBuf } = ctx;

  // --- Morphological close to fill small gaps ---
  const waterRawMat = cv.matFromArray(TH, TW, cv.CV_8UC1,
    // Convert 0/1 mask to 0/255 for OpenCV
    Uint8Array.from(waterMaskIn, v => v ? 255 : 0));
  const wkSize = oddK(7);
  const waterKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wkSize, wkSize));
  const waterClosedMat = new cv.Mat();
  cv.morphologyEx(waterRawMat, waterClosedMat, cv.MORPH_CLOSE, waterKernel);
  waterRawMat.delete();

  // --- Connected components ---
  const waterLabels = new cv.Mat();
  const waterStats = new cv.Mat();
  const waterCents = new cv.Mat();
  const numWaterCC = cv.connectedComponentsWithStats(waterClosedMat, waterLabels, waterStats, waterCents);
  waterClosedMat.delete(); waterCents.delete();

  const waterComponents: WaterComponent[] = [];
  const waterMask = new Uint8Array(tp);
  const minWaterSize = Math.round(tp * 0.003); // 0.3%
  const waterLabelData = waterLabels.data32S;
  const compSubCentroids = new Map<number, Array<[number, number, number]>>();

  // --- Narrow-neck splitting of large blobs ---
  interface CompStat { area: number; left: number; top: number; width: number; height: number }
  const compStats = new Map<number, CompStat>();
  for (let c = 1; c < numWaterCC; c++) {
    compStats.set(c, {
      area: waterStats.intAt(c, cv.CC_STAT_AREA),
      left: waterStats.intAt(c, cv.CC_STAT_LEFT),
      top: waterStats.intAt(c, cv.CC_STAT_TOP),
      width: waterStats.intAt(c, cv.CC_STAT_WIDTH),
      height: waterStats.intAt(c, cv.CC_STAT_HEIGHT),
    });
  }

  const SPLIT_MIN_AREA = Math.round(tp * 0.05);
  const splitKSize = oddK(10);
  const splitKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(splitKSize, splitKSize));
  let nextWaterLabel = numWaterCC;

  for (let c = 1; c < numWaterCC; c++) {
    const stat = compStats.get(c)!;
    if (stat.area < SPLIT_MIN_AREA) continue;

    const ccMask = new Uint8Array(tp);
    for (let i = 0; i < tp; i++) {
      if (waterLabelData[i] === c) ccMask[i] = 255;
    }

    const compMaskMat = cv.matFromArray(TH, TW, cv.CV_8UC1, ccMask);
    const erodedMat = new cv.Mat();
    cv.erode(compMaskMat, erodedMat, splitKernel);
    compMaskMat.delete();

    const erodedLabels = new cv.Mat();
    const erodedStats = new cv.Mat();
    const erodedCents = new cv.Mat();
    const numEroded = cv.connectedComponentsWithStats(erodedMat, erodedLabels, erodedStats, erodedCents);
    erodedMat.delete(); erodedCents.delete();

    const minSubSize = Math.max(50, Math.round(stat.area * 0.01));
    const significantSubs: Array<{ eLabel: number; area: number }> = [];
    for (let sc = 1; sc < numEroded; sc++) {
      const subArea = erodedStats.intAt(sc, cv.CC_STAT_AREA);
      if (subArea >= minSubSize) significantSubs.push({ eLabel: sc, area: subArea });
    }

    if (significantSubs.length < 2) {
      erodedLabels.delete(); erodedStats.delete();
      continue;
    }

    significantSubs.sort((a, b) => b.area - a.area);
    console.log(`  [Water] Splitting CC ${c} (${stat.area}px, ${(stat.area / tp * 100).toFixed(1)}%) into ${significantSubs.length} sub-blobs`);

    const subLabelMap = new Map<number, number>();
    for (const sub of significantSubs) {
      subLabelMap.set(sub.eLabel, nextWaterLabel++);
    }

    const erodedLabelData = erodedLabels.data32S;
    const bfsQueue: number[] = [];
    for (let i = 0; i < tp; i++) {
      if (waterLabelData[i] !== c) continue;
      const newLabel = subLabelMap.get(erodedLabelData[i]);
      if (newLabel !== undefined) {
        waterLabelData[i] = newLabel;
        bfsQueue.push(i);
      }
    }

    let head = 0;
    while (head < bfsQueue.length) {
      const pi = bfsQueue[head++];
      const label = waterLabelData[pi];
      const px = pi % TW, py = Math.floor(pi / TW);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
          const ni = ny * TW + nx;
          if (waterLabelData[ni] !== c) continue;
          waterLabelData[ni] = label;
          bfsQueue.push(ni);
        }
      }
    }

    for (const [_eLabel, newLabel] of subLabelMap) {
      let subArea = 0, minX = TW, minY = TH, maxX = 0, maxY = 0;
      for (let i = 0; i < tp; i++) {
        if (waterLabelData[i] !== newLabel) continue;
        subArea++;
        const x = i % TW, y = Math.floor(i / TW);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (subArea > 0) {
        compStats.set(newLabel, {
          area: subArea, left: minX, top: minY,
          width: maxX - minX + 1, height: maxY - minY + 1,
        });
        console.log(`    sub-blob → label ${newLabel}: ${subArea}px (${(subArea / tp * 100).toFixed(1)}%) bbox ${maxX - minX + 1}×${maxY - minY + 1}`);
      }
    }

    compStats.delete(c);
    erodedLabels.delete(); erodedStats.delete();
  }
  splitKernel.delete();

  // --- Component filtering + crop generation + sub-clustering ---
  for (const [c, stat] of compStats) {
    const { area } = stat;
    if (area < minWaterSize) continue;
    const bw = stat.width;
    const bh = stat.height;
    const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
    const solidity = area / Math.max(1, bw * bh);
    if (aspect > 4 && solidity < 0.3) continue; // elongated + sparse = river

    for (let i = 0; i < tp; i++) {
      if (waterLabelData[i] === c) waterMask[i] = 1;
    }

    const cx = stat.left;
    const cy = stat.top;

    let mainCrop: string | undefined;
    try {
      mainCrop = (await generateOutlineCrop(origDownBuf, TW, TH, si => waterLabelData[si] === c, cx, cy, bw, bh)) ?? undefined;
    } catch { /* skip */ }
    if (!mainCrop) continue;

    // K=2 sub-clustering on component pixels
    const compPx: Array<[number, number, number, number]> = [];
    for (let y = cy; y < cy + bh && y < TH; y++) {
      for (let x = cx; x < cx + bw && x < TW; x++) {
        const si = y * TW + x;
        if (waterLabelData[si] === c) {
          compPx.push([colorBuf[si * 3], colorBuf[si * 3 + 1], colorBuf[si * 3 + 2], si]);
        }
      }
    }

    const subClusters: WaterSubCluster[] = [];
    if (compPx.length > 20) {
      const cents: Array<[number, number, number]> = [[compPx[0][0], compPx[0][1], compPx[0][2]]];
      let maxD = 0, bestI = 0;
      for (let i = 1; i < compPx.length; i++) {
        const d = (compPx[i][0] - cents[0][0]) ** 2 + (compPx[i][1] - cents[0][1]) ** 2 + (compPx[i][2] - cents[0][2]) ** 2;
        if (d > maxD) { maxD = d; bestI = i; }
      }
      cents.push([compPx[bestI][0], compPx[bestI][1], compPx[bestI][2]]);

      const assignments = new Uint8Array(compPx.length);
      for (let iter = 0; iter < 20; iter++) {
        const sums = [[0, 0, 0, 0], [0, 0, 0, 0]];
        for (let i = 0; i < compPx.length; i++) {
          const [r, g, b] = compPx[i];
          const d0 = (r - cents[0][0]) ** 2 + (g - cents[0][1]) ** 2 + (b - cents[0][2]) ** 2;
          const d1 = (r - cents[1][0]) ** 2 + (g - cents[1][1]) ** 2 + (b - cents[1][2]) ** 2;
          const k = d0 <= d1 ? 0 : 1;
          assignments[i] = k;
          sums[k][0] += r; sums[k][1] += g; sums[k][2] += b; sums[k][3]++;
        }
        for (let k = 0; k < 2; k++) {
          if (sums[k][3] > 0) {
            cents[k] = [Math.round(sums[k][0] / sums[k][3]), Math.round(sums[k][1] / sums[k][3]), Math.round(sums[k][2] / sums[k][3])];
          }
        }
      }
      compSubCentroids.set(c, cents);

      const subPixelSets = [new Set<number>(), new Set<number>()];
      const subAreas = [0, 0];
      for (let i = 0; i < compPx.length; i++) {
        subPixelSets[assignments[i]].add(compPx[i][3]);
        subAreas[assignments[i]]++;
      }
      for (let k = 0; k < 2; k++) {
        if (subAreas[k] < 5) continue;
        let minX = TW, minY = TH, maxX = 0, maxY = 0;
        for (const si of subPixelSets[k]) {
          const spx = si % TW, spy = Math.floor(si / TW);
          if (spx < minX) minX = spx; if (spx > maxX) maxX = spx;
          if (spy < minY) minY = spy; if (spy > maxY) maxY = spy;
        }
        try {
          const subCrop = await generateOutlineCrop(origDownBuf, TW, TH, si => subPixelSets[k].has(si), minX, minY, maxX - minX + 1, maxY - minY + 1);
          if (subCrop) {
            subClusters.push({ idx: k, pct: Math.round(subAreas[k] / tp * 1000) / 10, cropDataUrl: subCrop });
          }
        } catch { /* skip */ }
      }
    }

    waterComponents.push({
      id: c, area, pct: Math.round(area / tp * 1000) / 10,
      cropDataUrl: mainCrop,
      subClusters,
    });
  }

  const savedWaterLabels = new Int32Array(waterLabelData);
  waterLabels.delete(); waterStats.delete();

  console.log(`  [Water] ${waterComponents.length} component(s) after CC filter (from ${numWaterCC - 1} raw)`);

  // --- Edge-connectivity filter: remove thin water tentacles extending into land ---
  {
    const wmMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
    const erodeSize = oddK(15);
    const erodeK2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(erodeSize, erodeSize));
    const erodedWater = new cv.Mat();
    cv.erode(wmMat, erodedWater, erodeK2);
    erodeK2.delete(); wmMat.delete();

    const erodedData = erodedWater.data;
    const borderConnected = new Uint8Array(tp);
    const bq: number[] = [];
    for (let x = 0; x < TW; x++) {
      if (erodedData[x]) { borderConnected[x] = 1; bq.push(x); }
      const bot = (TH - 1) * TW + x;
      if (erodedData[bot]) { borderConnected[bot] = 1; bq.push(bot); }
    }
    for (let y = 0; y < TH; y++) {
      const left = y * TW;
      if (erodedData[left]) { borderConnected[left] = 1; bq.push(left); }
      const right = y * TW + TW - 1;
      if (erodedData[right]) { borderConnected[right] = 1; bq.push(right); }
    }
    let bh2 = 0;
    while (bh2 < bq.length) {
      const p = bq[bh2++];
      for (const n of [p - 1, p + 1, p - TW, p + TW]) {
        if (n >= 0 && n < tp && erodedData[n] && !borderConnected[n]) {
          borderConnected[n] = 1;
          bq.push(n);
        }
      }
    }
    erodedWater.delete();

    const bcMat = cv.matFromArray(TH, TW, cv.CV_8UC1, borderConnected);
    const dilateSize = oddK(17);
    const dilateK2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(dilateSize, dilateSize));
    const bcDilated = new cv.Mat();
    cv.dilate(bcMat, bcDilated, dilateK2);
    dilateK2.delete(); bcMat.delete();

    let removed = 0;
    for (let i = 0; i < tp; i++) {
      if (waterMask[i] && !bcDilated.data[i]) {
        waterMask[i] = 0;
        removed++;
      }
    }
    bcDilated.delete();
    if (removed > 0) console.log(`  [Water] Edge-connectivity filter: removed ${removed} inland water pixels (${(removed / tp * 100).toFixed(1)}%)`);
  }

  // --- Final dilation ---
  const waterMaskMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
  const wdSize = oddK(5);
  const waterDilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wdSize, wdSize));
  const waterGrownMat = new cv.Mat();
  cv.dilate(waterMaskMat, waterGrownMat, waterDilateKernel);
  const waterGrown = new Uint8Array(waterGrownMat.data);
  waterMaskMat.delete(); waterGrownMat.delete(); waterKernel.delete(); waterDilateKernel.delete();

  // --- Debug image: water mask overlay ---
  const waterVizBuf = Buffer.from(colorBuf);
  let waterPxCount = 0;
  for (let i = 0; i < tp; i++) {
    if (waterGrown[i]) {
      waterVizBuf[i * 3] = 255; waterVizBuf[i * 3 + 1] = 0; waterVizBuf[i * 3 + 2] = 0;
      waterPxCount++;
    }
  }
  const waterDebugPng = await sharp(Buffer.from(waterVizBuf), {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    `Water mask (red, ${waterPxCount} px = ${(waterPxCount / tp * 100).toFixed(1)}%)`,
    `data:image/png;base64,${waterDebugPng.toString('base64')}`,
  );

  // --- Interactive per-component water review ---
  if (waterComponents.length > 0) {
    const reviewId = `wr-${regionId}-${Date.now()}`;
    storeWaterCrops(reviewId, waterComponents);
    const cropCount = waterComponents.reduce((n, wc) => n + 1 + wc.subClusters.length, 0);
    console.log(`  [Water] Stored ${cropCount} crop(s) for review ${reviewId}`);

    sendEvent({
      type: 'water_review',
      reviewId,
      waterPxPercent: Math.round(waterPxCount / tp * 1000) / 10,
      waterComponents: waterComponents.map(wc => ({
        id: wc.id, pct: wc.pct, cropDataUrl: '',
        subClusters: wc.subClusters.map(sc => ({ idx: sc.idx, pct: sc.pct, cropDataUrl: '' })),
      })),
    });
    await new Promise(resolve => setImmediate(resolve));

    const decision = await new Promise<WaterReviewDecision>((resolve) => {
      pendingWaterReviews.set(reviewId, resolve);
    });

    const approvedSet = new Set(decision.approvedIds);
    const mixMap = new Map(decision.mixDecisions.map(m => [m.componentId, new Set(m.approvedSubClusters)]));
    const rejectedIds = waterComponents.filter(wc => !approvedSet.has(wc.id) && !mixMap.has(wc.id)).map(wc => wc.id);
    const needsRebuild = rejectedIds.length > 0 || mixMap.size > 0;
    let preRebuildWaterPx = 0;
    for (let i = 0; i < tp; i++) if (waterGrown[i]) preRebuildWaterPx++;
    console.log(`  [Water] Decision received: approved=[${[...approvedSet]}] rejected=[${rejectedIds}] mix=[${[...mixMap.keys()]}] all_components=[${waterComponents.map(wc => wc.id)}] needsRebuild=${needsRebuild} preRebuildWaterPx=${preRebuildWaterPx}`);

    if (needsRebuild) {
      const changes: string[] = [];
      const rejected = waterComponents.filter(wc => !approvedSet.has(wc.id) && !mixMap.has(wc.id));
      if (rejected.length) changes.push(`${rejected.length} rejected`);
      if (mixMap.size) changes.push(`${mixMap.size} mixed`);
      await logStep(`Rebuilding water mask (${changes.join(', ')})...`);

      waterMask.fill(0);
      for (let i = 0; i < tp; i++) {
        const label = savedWaterLabels[i];
        if (label <= 0) continue;
        if (!compStats.has(label)) continue;

        if (approvedSet.has(label)) {
          waterMask[i] = 1;
        } else if (mixMap.has(label)) {
          const approvedSubs = mixMap.get(label)!;
          const cents = compSubCentroids.get(label);
          if (cents) {
            const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b = colorBuf[i * 3 + 2];
            const d0 = (r - cents[0][0]) ** 2 + (g - cents[0][1]) ** 2 + (b - cents[0][2]) ** 2;
            const d1 = (r - cents[1][0]) ** 2 + (g - cents[1][1]) ** 2 + (b - cents[1][2]) ** 2;
            const nearest = d0 <= d1 ? 0 : 1;
            if (approvedSubs.has(nearest)) waterMask[i] = 1;
          }
        }
      }

      // Re-dilate
      const wm3 = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
      const wd3Size = oddK(5);
      const wdk3 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wd3Size, wd3Size));
      const wg3 = new cv.Mat();
      cv.dilate(wm3, wg3, wdk3);
      const newGrown = new Uint8Array(wg3.data);
      wm3.delete(); wg3.delete(); wdk3.delete();
      for (let i = 0; i < tp; i++) waterGrown[i] = newGrown[i];
      let postRebuildWaterPx = 0;
      for (let i = 0; i < tp; i++) if (waterGrown[i]) postRebuildWaterPx++;
      console.log(`  [Water] Rebuild complete: ${preRebuildWaterPx} → ${postRebuildWaterPx} water px (delta: ${postRebuildWaterPx - preRebuildWaterPx})`);

      // Updated debug image
      let cnt = 0;
      const viz = Buffer.from(colorBuf);
      for (let i = 0; i < tp; i++) {
        if (waterGrown[i]) { viz[i * 3] = 255; viz[i * 3 + 1] = 0; viz[i * 3 + 2] = 0; cnt++; }
      }
      const p = await sharp(Buffer.from(viz), { raw: { width: TW, height: TH, channels: 3 } })
        .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
      await pushDebugImage(
        `Water mask (corrected, ${cnt} px = ${(cnt / tp * 100).toFixed(1)}%)`,
        `data:image/png;base64,${p.toString('base64')}`,
      );
    }
  }

  return waterGrown;
}
