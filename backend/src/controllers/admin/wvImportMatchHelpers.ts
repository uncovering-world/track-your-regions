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
import { registerWaterReview, storeWaterCrops, type WaterReviewDecision } from './wvImportMatchReview.js';
import type { PipelineContext } from './wvImportMatchContext.js';

// =============================================================================
// OpenCV namespace typing
// =============================================================================
// `@techstark/opencv-js` ships type definitions, but the WASM runtime doesn't
// perfectly match them (e.g. `pyrMeanShiftFiltering` is missing at runtime).
// We therefore use `typeof import(...)` to get the module's structural shape
// for parameter typing — good enough to satisfy `no-explicit-any` without
// pretending our subset matches the full declared API.
type CvNs = typeof import('@techstark/opencv-js');
/** OpenCV Mat instance — created via `new cv.Mat(...)` or `cv.matFromArray(...)`. */
type CvMat = InstanceType<CvNs['Mat']>;

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

/** Collect component-wise channel values of non-masked neighbors of (x,y) within radius. */
function collectNeighborChannels(
  src: Buffer, mask: Uint8Array, w: number, h: number,
  x: number, y: number, radius: number,
): { rs: number[]; gs: number[]; bs: number[] } {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= w) continue;
      const np = ny * w + nx;
      if (mask[np]) continue;
      rs.push(src[np * 3]);
      gs.push(src[np * 3 + 1]);
      bs.push(src[np * 3 + 2]);
    }
  }
  return { rs, gs, bs };
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
      const { rs, gs, bs } = collectNeighborChannels(src, mask, w, h, x, y, radius);
      if (rs.length >= 3) {
        rs.sort((a, b) => a - b);
        gs.sort((a, b) => a - b);
        bs.sort((a, b) => a - b);
        const mid = Math.floor(rs.length / 2);
        out[p * 3] = rs[mid];
        out[p * 3 + 1] = gs[mid];
        out[p * 3 + 2] = bs[mid];
        replaced++;
      }
    }
  }
  return replaced;
}

/** Count consecutive flagged pixels in one direction from (x,y) using (dx,dy) step, up to maxR. */
function countRun(
  mask: Uint8Array, w: number, h: number,
  x: number, y: number, dx: number, dy: number, maxR: number,
): number {
  let run = 0;
  for (let step = 1; step <= maxR; step++) {
    const nx = x + dx * step;
    const ny = y + dy * step;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) break;
    if (!mask[ny * w + nx]) break;
    run++;
  }
  return run;
}

/** Measure minimum of horizontal and vertical run lengths of consecutive flagged pixels */
export function minRunLength(mask: Uint8Array, w: number, x: number, y: number, maxR: number): number {
  const h = mask.length / w;
  const hRun = 1
    + countRun(mask, w, h, x, y, 1, 0, maxR)
    + countRun(mask, w, h, x, y, -1, 0, maxR);
  const vRun = 1
    + countRun(mask, w, h, x, y, 0, 1, maxR)
    + countRun(mask, w, h, x, y, 0, -1, maxR);
  return Math.min(hRun, vRun);
}

/** Classify each pixel in `buf` into a color type: 0=keep, 1=blue/cyan, 2=red, 3=yellow. */
function classifyColorPixels(buf: Buffer, tp: number): Uint8Array {
  const ctype = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    const { h: hue, s } = rgbToHsl(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]);
    if (hue >= 170 && hue <= 270 && s > 20) ctype[i] = 1;
    else if ((hue <= 25 || hue >= 335) && s > 40) ctype[i] = 2;
    else if (hue >= 40 && hue <= 70 && s > 40) ctype[i] = 3;
  }
  return ctype;
}

/** Build a mask of thin colored-line pixels from a color-classified map. */
function buildThinLineMask(
  ctype: Uint8Array, w: number, h: number, maxR: number, maxThick: number,
): Uint8Array {
  const tp = w * h;
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
  const ctype = classifyColorPixels(buf, tp);

  // Mark thin colored features for removal (no boundary check — rivers/roads are never boundaries)
  const mask = buildThinLineMask(ctype, w, h, maxR, maxThick);

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

interface GeoBounds { minX: number; minY: number; maxX: number; maxY: number }

/** Extend bounds to include (x, y). */
function extendBounds(bounds: GeoBounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y);
}

/** Compute geographic bounds from all SVG path coordinates across divisions. */
function computeSvgBounds(divisions: SvgDivision[]): GeoBounds {
  const bounds: GeoBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const d of divisions) {
    const nums = d.svgPath.match(/-?\d+\.?\d*/g);
    if (!nums) continue;
    for (let i = 0; i < nums.length; i += 2) {
      extendBounds(bounds, parseFloat(nums[i]), parseFloat(nums[i + 1]));
    }
  }
  return bounds;
}

/** Transform a geo SVG path "M x y L x y ..." into pixel-space coordinates. */
function transformSvgPath(
  svgPath: string, minX: number, minY: number, scaleX: number, scaleY: number,
): string {
  return svgPath.replace(/-?\d+\.?\d*/g, (match, offset: number, str: string) => {
    // Determine whether this number is an X or Y coordinate by counting preceding numbers.
    const before = str.slice(0, offset);
    const numsBefore = before.match(/-?\d+\.?\d*/g);
    const idx = numsBefore ? numsBefore.length : 0;
    const val = parseFloat(match);
    if (idx % 2 === 0) {
      // X coordinate
      return ((val - minX) * scaleX).toFixed(1);
    }
    // Y coordinate (already negated by PostGIS)
    return ((val - minY) * scaleY).toFixed(1);
  });
}

/** Render a single numbered division (path + centroid circle + number) as SVG snippet. */
function renderNumberedDivision(
  d: SvgDivision, num: number,
  bounds: GeoBounds, scaleX: number, scaleY: number,
  fontSize: number, circleR: number,
): string {
  const { minX, minY } = bounds;
  // Transform centroid to pixel space (negate cy to match SVG path convention).
  const px = ((d.cx - minX) * scaleX).toFixed(1);
  const py = ((-d.cy - minY) * scaleY).toFixed(1);
  const pixelPath = transformSvgPath(d.svgPath, minX, minY, scaleX, scaleY);
  return `<path d="${pixelPath}" fill="#ddeeff" stroke="#336" stroke-width="1" opacity="0.8"/>
<circle cx="${px}" cy="${py}" r="${circleR}" fill="white" stroke="#336" stroke-width="0.5" opacity="0.9"/>
<text x="${px}" y="${py}" font-size="${fontSize}" font-family="DejaVu Sans,sans-serif" text-anchor="middle" dominant-baseline="central" fill="#111" font-weight="bold">${num}</text>`;
}

/**
 * Generate an SVG map showing numbered division boundaries.
 * PostGIS ST_AsSVG uses negated Y (SVG convention), so cy becomes -cy for label placement.
 */
export function generateDivisionsSvg(divisions: SvgDivision[]): string {
  const rawBounds = computeSvgBounds(divisions);
  const pad = 0.3;
  const bounds: GeoBounds = {
    minX: rawBounds.minX - pad,
    minY: rawBounds.minY - pad,
    maxX: rawBounds.maxX + pad,
    maxY: rawBounds.maxY + pad,
  };
  const geoW = bounds.maxX - bounds.minX;
  const geoH = bounds.maxY - bounds.minY;

  // Transform everything to pixel space (no viewBox — sharp renders at pixel resolution)
  const svgWidth = 1200;
  const svgHeight = Math.round(svgWidth * (geoH / geoW));
  const scaleX = svgWidth / geoW;
  const scaleY = svgHeight / geoH;

  const fontSize = 11;
  const circleR = 8;

  const paths = divisions.map((d, i) =>
    renderNumberedDivision(d, i + 1, bounds, scaleX, scaleY, fontSize, circleR),
  );

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
// Outline crop generation
// =============================================================================

/** Clamp a bounding box for cropping the original image (with padding). Null if too small. */
function computeCropRect(
  TW: number, TH: number,
  cxStat: number, cyStat: number, bwStat: number, bhStat: number,
  pad: number,
): { cropX: number; cropY: number; cropW: number; cropH: number } | null {
  const cropX = Math.max(0, cxStat - pad);
  const cropY = Math.max(0, cyStat - pad);
  const cropW = Math.min(TW - cropX, bwStat + pad * 2);
  const cropH = Math.min(TH - cropY, bhStat + pad * 2);
  if (cropW <= 3 || cropH <= 3) return null;
  return { cropX, cropY, cropW, cropH };
}

/** Copy the source region from `origDownBuf` into a fresh crop buffer. */
function copyCropPixels(
  origDownBuf: Buffer, TW: number,
  cropX: number, cropY: number, cropW: number, cropH: number,
): Buffer {
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
  return cropBuf;
}

/** Return true if (cropX+x, cropY+y) is an edge pixel of the set defined by `pixelTest`. */
function isEdgePixel(
  TW: number, TH: number,
  pixelTest: (si: number) => boolean,
  cropX: number, cropY: number, x: number, y: number,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const ny = cropY + y + dy, nx = cropX + x + dx;
      if (ny < 0 || ny >= TH || nx < 0 || nx >= TW || !pixelTest(ny * TW + nx)) return true;
    }
  }
  return false;
}

/** Paint a 3x3 magenta stamp centered on (x,y) into the crop buffer. */
function stampMagenta3x3(cropBuf: Buffer, cropW: number, cropH: number, x: number, y: number): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const py = y + dy, px = x + dx;
      if (py >= 0 && py < cropH && px >= 0 && px < cropW) {
        const di = (py * cropW + px) * 3;
        cropBuf[di] = 255;
        cropBuf[di + 1] = 0;
        cropBuf[di + 2] = 255;
      }
    }
  }
}

/** Draw magenta edges into `cropBuf` for every edge pixel of `pixelTest` within the crop window. */
function drawMagentaOutline(
  cropBuf: Buffer,
  TW: number, TH: number,
  cropX: number, cropY: number, cropW: number, cropH: number,
  pixelTest: (si: number) => boolean,
): void {
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const si = (cropY + y) * TW + (cropX + x);
      if (!pixelTest(si)) continue;
      if (isEdgePixel(TW, TH, pixelTest, cropX, cropY, x, y)) {
        stampMagenta3x3(cropBuf, cropW, cropH, x, y);
      }
    }
  }
}

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
  const rect = computeCropRect(TW, TH, cxStat, cyStat, bwStat, bhStat, pad);
  if (!rect) return null;
  const { cropX, cropY, cropW, cropH } = rect;

  const cropBuf = copyCropPixels(origDownBuf, TW, cropX, cropY, cropW, cropH);
  drawMagentaOutline(cropBuf, TW, TH, cropX, cropY, cropW, cropH, pixelTest);

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

interface CompStat { area: number; left: number; top: number; width: number; height: number }

/** Run morphological close on a 0/1 water mask and return the closed Mat (caller must delete). */
function morphCloseWaterMask(
  cv: CvNs, waterMaskIn: Uint8Array, TW: number, TH: number, waterKernel: CvMat,
): CvMat {
  const waterRawMat = cv.matFromArray(TH, TW, cv.CV_8UC1,
    // Convert 0/1 mask to 0/255 for OpenCV
    Uint8Array.from(waterMaskIn, v => v ? 255 : 0));
  const waterClosedMat = new cv.Mat();
  cv.morphologyEx(waterRawMat, waterClosedMat, cv.MORPH_CLOSE, waterKernel);
  waterRawMat.delete();
  return waterClosedMat;
}

/** Collect stats for every non-background connected component. */
function collectComponentStats(cv: CvNs, waterStats: CvMat, numWaterCC: number): Map<number, CompStat> {
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
  return compStats;
}

/** Build a 0/255 mask isolating a single labeled component. */
function buildComponentMask(waterLabelData: Int32Array, tp: number, label: number): Uint8Array {
  const ccMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (waterLabelData[i] === label) ccMask[i] = 255;
  }
  return ccMask;
}

/** Erode a component mask and return its connected-components results (caller deletes Mats). */
function erodeAndLabelComponent(
  cv: CvNs, ccMask: Uint8Array, TW: number, TH: number, splitKernel: CvMat,
): { erodedLabels: CvMat; erodedStats: CvMat; numEroded: number } {
  const compMaskMat = cv.matFromArray(TH, TW, cv.CV_8UC1, ccMask);
  const erodedMat = new cv.Mat();
  cv.erode(compMaskMat, erodedMat, splitKernel);
  compMaskMat.delete();

  const erodedLabels = new cv.Mat();
  const erodedStats = new cv.Mat();
  const erodedCents = new cv.Mat();
  const numEroded = cv.connectedComponentsWithStats(erodedMat, erodedLabels, erodedStats, erodedCents);
  erodedMat.delete();
  erodedCents.delete();

  return { erodedLabels, erodedStats, numEroded };
}

/** Pick eroded sub-components that are large enough to be considered separate blobs. */
function findSignificantSubComponents(
  cv: CvNs, erodedStats: CvMat, numEroded: number, minSubSize: number,
): Array<{ eLabel: number; area: number }> {
  const significantSubs: Array<{ eLabel: number; area: number }> = [];
  for (let sc = 1; sc < numEroded; sc++) {
    const subArea = erodedStats.intAt(sc, cv.CC_STAT_AREA);
    if (subArea >= minSubSize) significantSubs.push({ eLabel: sc, area: subArea });
  }
  return significantSubs;
}

/** Seed the BFS queue with eroded-core pixels relabeled to their new labels. */
function seedRelabelQueue(
  waterLabelData: Int32Array, erodedLabelData: Int32Array,
  tp: number, origLabel: number, subLabelMap: Map<number, number>,
): number[] {
  const bfsQueue: number[] = [];
  for (let i = 0; i < tp; i++) {
    if (waterLabelData[i] !== origLabel) continue;
    const newLabel = subLabelMap.get(erodedLabelData[i]);
    if (newLabel !== undefined) {
      waterLabelData[i] = newLabel;
      bfsQueue.push(i);
    }
  }
  return bfsQueue;
}

/** Spread the new label from `pi` into 8-connected neighbors that still hold origLabel. */
function propagateRelabel(
  waterLabelData: Int32Array, bfsQueue: number[],
  pi: number, label: number, origLabel: number,
  TW: number, TH: number,
): void {
  const px = pi % TW, py = Math.floor(pi / TW);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
      const ni = ny * TW + nx;
      if (waterLabelData[ni] !== origLabel) continue;
      waterLabelData[ni] = label;
      bfsQueue.push(ni);
    }
  }
}

/** Reassign labels of a single component into multiple sub-labels via BFS growth from cores. */
function relabelComponentBySubCores(
  waterLabelData: Int32Array, erodedLabelData: Int32Array,
  tp: number, TW: number, TH: number,
  origLabel: number, subLabelMap: Map<number, number>,
): void {
  const bfsQueue = seedRelabelQueue(waterLabelData, erodedLabelData, tp, origLabel, subLabelMap);

  let head = 0;
  while (head < bfsQueue.length) {
    const pi = bfsQueue[head++];
    const label = waterLabelData[pi];
    propagateRelabel(waterLabelData, bfsQueue, pi, label, origLabel, TW, TH);
  }
}

/** Compute bbox + area stats for a particular label across the whole image. */
function computeLabelBBoxStats(
  waterLabelData: Int32Array, tp: number, TW: number, TH: number, label: number,
): CompStat | null {
  let subArea = 0, minX = TW, minY = TH, maxX = 0, maxY = 0;
  for (let i = 0; i < tp; i++) {
    if (waterLabelData[i] !== label) continue;
    subArea++;
    const x = i % TW, y = Math.floor(i / TW);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (subArea === 0) return null;
  return {
    area: subArea,
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Attempt to split a single large component by erosion. Returns the next label id to use.
 * Mutates `waterLabelData` and `compStats` in place.
 */
function splitSingleComponent(
  cv: CvNs,
  c: number,
  stat: CompStat,
  waterLabelData: Int32Array,
  compStats: Map<number, CompStat>,
  tp: number, TW: number, TH: number,
  splitKernel: CvMat,
  nextWaterLabel: number,
): number {
  const ccMask = buildComponentMask(waterLabelData, tp, c);
  const { erodedLabels, erodedStats, numEroded } = erodeAndLabelComponent(cv, ccMask, TW, TH, splitKernel);

  const minSubSize = Math.max(50, Math.round(stat.area * 0.01));
  const significantSubs = findSignificantSubComponents(cv, erodedStats, numEroded, minSubSize);

  if (significantSubs.length < 2) {
    erodedLabels.delete();
    erodedStats.delete();
    return nextWaterLabel;
  }

  significantSubs.sort((a, b) => b.area - a.area);
  console.log(`  [Water] Splitting CC ${c} (${stat.area}px, ${(stat.area / tp * 100).toFixed(1)}%) into ${significantSubs.length} sub-blobs`);

  let label = nextWaterLabel;
  const subLabelMap = new Map<number, number>();
  for (const sub of significantSubs) {
    subLabelMap.set(sub.eLabel, label++);
  }

  relabelComponentBySubCores(waterLabelData, erodedLabels.data32S, tp, TW, TH, c, subLabelMap);

  for (const newLabel of subLabelMap.values()) {
    const bbox = computeLabelBBoxStats(waterLabelData, tp, TW, TH, newLabel);
    if (bbox) {
      compStats.set(newLabel, bbox);
      console.log(`    sub-blob → label ${newLabel}: ${bbox.area}px (${(bbox.area / tp * 100).toFixed(1)}%) bbox ${bbox.width}×${bbox.height}`);
    }
  }

  compStats.delete(c);
  erodedLabels.delete();
  erodedStats.delete();
  return label;
}

/** Iterate components and split any that exceed SPLIT_MIN_AREA using morphological erosion. */
function splitLargeComponents(
  cv: CvNs,
  waterLabelData: Int32Array,
  compStats: Map<number, CompStat>,
  numWaterCC: number,
  tp: number, TW: number, TH: number,
  oddK: (base: number) => number,
): void {
  const SPLIT_MIN_AREA = Math.round(tp * 0.05);
  const splitKSize = oddK(10);
  const splitKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(splitKSize, splitKSize));
  let nextWaterLabel = numWaterCC;

  for (let c = 1; c < numWaterCC; c++) {
    const stat = compStats.get(c);
    if (!stat || stat.area < SPLIT_MIN_AREA) continue;
    nextWaterLabel = splitSingleComponent(
      cv, c, stat, waterLabelData, compStats, tp, TW, TH, splitKernel, nextWaterLabel,
    );
  }
  splitKernel.delete();
}

/** Run K=2 k-means clustering on a component's pixels; returns final centroids + assignments. */
function kmeansTwoOnComponent(
  compPx: Array<[number, number, number, number]>,
): { cents: Array<[number, number, number]>; assignments: Uint8Array } {
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
        cents[k] = [
          Math.round(sums[k][0] / sums[k][3]),
          Math.round(sums[k][1] / sums[k][3]),
          Math.round(sums[k][2] / sums[k][3]),
        ];
      }
    }
  }

  return { cents, assignments };
}

/** Compute pixel-index bounding box for an index set. */
function bboxOfPixelSet(subPixels: Set<number>, TW: number, TH: number): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  let minX = TW, minY = TH, maxX = 0, maxY = 0;
  for (const si of subPixels) {
    const spx = si % TW, spy = Math.floor(si / TW);
    if (spx < minX) minX = spx;
    if (spx > maxX) maxX = spx;
    if (spy < minY) minY = spy;
    if (spy > maxY) maxY = spy;
  }
  return { minX, minY, maxX, maxY };
}

/** Collect (r, g, b, index) tuples for pixels belonging to a given component inside its bbox. */
function collectComponentPixels(
  colorBuf: Buffer, waterLabelData: Int32Array,
  c: number, stat: CompStat, TW: number, TH: number,
): Array<[number, number, number, number]> {
  const compPx: Array<[number, number, number, number]> = [];
  const cx = stat.left, cy = stat.top, bw = stat.width, bh = stat.height;
  for (let y = cy; y < cy + bh && y < TH; y++) {
    for (let x = cx; x < cx + bw && x < TW; x++) {
      const si = y * TW + x;
      if (waterLabelData[si] === c) {
        compPx.push([colorBuf[si * 3], colorBuf[si * 3 + 1], colorBuf[si * 3 + 2], si]);
      }
    }
  }
  return compPx;
}

/** Build sub-cluster entries (with crops) for a component via K=2 k-means. */
async function computeSubClustersForComponent(
  origDownBuf: Buffer, colorBuf: Buffer, waterLabelData: Int32Array,
  c: number, stat: CompStat,
  TW: number, TH: number, tp: number,
  compSubCentroids: Map<number, Array<[number, number, number]>>,
): Promise<WaterSubCluster[]> {
  const subClusters: WaterSubCluster[] = [];
  const compPx = collectComponentPixels(colorBuf, waterLabelData, c, stat, TW, TH);
  if (compPx.length <= 20) return subClusters;

  const { cents, assignments } = kmeansTwoOnComponent(compPx);
  compSubCentroids.set(c, cents);

  const subPixelSets = [new Set<number>(), new Set<number>()];
  const subAreas = [0, 0];
  for (let i = 0; i < compPx.length; i++) {
    subPixelSets[assignments[i]].add(compPx[i][3]);
    subAreas[assignments[i]]++;
  }

  for (let k = 0; k < 2; k++) {
    if (subAreas[k] < 5) continue;
    const { minX, minY, maxX, maxY } = bboxOfPixelSet(subPixelSets[k], TW, TH);
    try {
      const subCrop = await generateOutlineCrop(
        origDownBuf, TW, TH, si => subPixelSets[k].has(si),
        minX, minY, maxX - minX + 1, maxY - minY + 1,
      );
      if (subCrop) {
        subClusters.push({
          idx: k,
          pct: Math.round(subAreas[k] / tp * 1000) / 10,
          cropDataUrl: subCrop,
        });
      }
    } catch { /* skip */ }
  }
  return subClusters;
}

/** Generate the outlined main crop for a component, or null if it fails. */
async function tryGenerateMainCrop(
  origDownBuf: Buffer, waterLabelData: Int32Array,
  c: number, stat: CompStat, TW: number, TH: number,
): Promise<string | null> {
  try {
    const crop = await generateOutlineCrop(
      origDownBuf, TW, TH, si => waterLabelData[si] === c,
      stat.left, stat.top, stat.width, stat.height,
    );
    return crop ?? null;
  } catch {
    return null;
  }
}

/** Decide whether a component is worth keeping (size + shape heuristics). */
function shouldKeepComponent(stat: CompStat, minWaterSize: number): boolean {
  if (stat.area < minWaterSize) return false;
  const { width: bw, height: bh, area } = stat;
  const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
  const solidity = area / Math.max(1, bw * bh);
  // elongated + sparse = river
  return !(aspect > 4 && solidity < 0.3);
}

/** Run filtering + per-component crop/subcluster generation, populate output arrays. */
async function buildWaterComponents(
  origDownBuf: Buffer, colorBuf: Buffer,
  waterLabelData: Int32Array, waterMask: Uint8Array,
  compStats: Map<number, CompStat>,
  tp: number, TW: number, TH: number,
  compSubCentroids: Map<number, Array<[number, number, number]>>,
): Promise<WaterComponent[]> {
  const waterComponents: WaterComponent[] = [];
  const minWaterSize = Math.round(tp * 0.003); // 0.3%

  for (const [c, stat] of compStats) {
    if (!shouldKeepComponent(stat, minWaterSize)) continue;

    for (let i = 0; i < tp; i++) {
      if (waterLabelData[i] === c) waterMask[i] = 1;
    }

    const mainCrop = await tryGenerateMainCrop(origDownBuf, waterLabelData, c, stat, TW, TH);
    if (!mainCrop) continue;

    const subClusters = await computeSubClustersForComponent(
      origDownBuf, colorBuf, waterLabelData, c, stat, TW, TH, tp, compSubCentroids,
    );

    waterComponents.push({
      id: c,
      area: stat.area,
      pct: Math.round(stat.area / tp * 1000) / 10,
      cropDataUrl: mainCrop,
      subClusters,
    });
  }
  return waterComponents;
}

/** Mark a pixel as border-connected and push it to the BFS queue if non-zero in erodedData. */
function seedBorderPixel(
  erodedData: Uint8Array | Int32Array,
  borderConnected: Uint8Array, bq: number[], idx: number,
): void {
  if (erodedData[idx]) {
    borderConnected[idx] = 1;
    bq.push(idx);
  }
}

/** Seed all image-border pixels (top/bottom/left/right) into the BFS queue. */
function seedImageBorders(
  erodedData: Uint8Array | Int32Array,
  borderConnected: Uint8Array, bq: number[],
  TW: number, TH: number,
): void {
  for (let x = 0; x < TW; x++) {
    seedBorderPixel(erodedData, borderConnected, bq, x);
    seedBorderPixel(erodedData, borderConnected, bq, (TH - 1) * TW + x);
  }
  for (let y = 0; y < TH; y++) {
    seedBorderPixel(erodedData, borderConnected, bq, y * TW);
    seedBorderPixel(erodedData, borderConnected, bq, y * TW + TW - 1);
  }
}

/** BFS along the image border through eroded-water pixels and return the connected set. */
function computeBorderConnectedSet(
  erodedData: Uint8Array | Int32Array,
  TW: number, TH: number, tp: number,
): Uint8Array {
  const borderConnected = new Uint8Array(tp);
  const bq: number[] = [];

  seedImageBorders(erodedData, borderConnected, bq, TW, TH);

  let head = 0;
  while (head < bq.length) {
    const p = bq[head++];
    for (const n of [p - 1, p + 1, p - TW, p + TW]) {
      if (n >= 0 && n < tp && erodedData[n] && !borderConnected[n]) {
        borderConnected[n] = 1;
        bq.push(n);
      }
    }
  }
  return borderConnected;
}

/** Remove water pixels that are not connected (via eroded+dilated mask) to the image border. */
function applyEdgeConnectivityFilter(
  cv: CvNs, waterMask: Uint8Array, TW: number, TH: number, tp: number,
  oddK: (base: number) => number,
): void {
  const wmMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
  const erodeSize = oddK(15);
  const erodeK2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(erodeSize, erodeSize));
  const erodedWater = new cv.Mat();
  cv.erode(wmMat, erodedWater, erodeK2);
  erodeK2.delete();
  wmMat.delete();

  const borderConnected = computeBorderConnectedSet(erodedWater.data, TW, TH, tp);
  erodedWater.delete();

  const bcMat = cv.matFromArray(TH, TW, cv.CV_8UC1, borderConnected);
  const dilateSize = oddK(17);
  const dilateK2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(dilateSize, dilateSize));
  const bcDilated = new cv.Mat();
  cv.dilate(bcMat, bcDilated, dilateK2);
  dilateK2.delete();
  bcMat.delete();

  let removed = 0;
  for (let i = 0; i < tp; i++) {
    if (waterMask[i] && !bcDilated.data[i]) {
      waterMask[i] = 0;
      removed++;
    }
  }
  bcDilated.delete();
  if (removed > 0) {
    console.log(`  [Water] Edge-connectivity filter: removed ${removed} inland water pixels (${(removed / tp * 100).toFixed(1)}%)`);
  }
}

/** Dilate a binary water mask and return a fresh Uint8Array (0/255 from OpenCV). */
function dilateWaterMask(
  cv: CvNs, waterMask: Uint8Array, TW: number, TH: number,
  oddK: (base: number) => number,
): Uint8Array {
  const waterMaskMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
  const wdSize = oddK(5);
  const waterDilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wdSize, wdSize));
  const waterGrownMat = new cv.Mat();
  cv.dilate(waterMaskMat, waterGrownMat, waterDilateKernel);
  const result = new Uint8Array(waterGrownMat.data);
  waterMaskMat.delete();
  waterGrownMat.delete();
  waterDilateKernel.delete();
  return result;
}

/** Produce a debug PNG overlaying water pixels in red on top of the color buffer. */
async function renderWaterDebugImage(
  colorBuf: Buffer, waterGrown: Uint8Array, tp: number,
  TW: number, TH: number, origW: number, origH: number,
): Promise<{ dataUrl: string; waterPxCount: number }> {
  const waterVizBuf = Buffer.from(colorBuf);
  let waterPxCount = 0;
  for (let i = 0; i < tp; i++) {
    if (waterGrown[i]) {
      waterVizBuf[i * 3] = 255;
      waterVizBuf[i * 3 + 1] = 0;
      waterVizBuf[i * 3 + 2] = 0;
      waterPxCount++;
    }
  }
  const waterDebugPng = await sharp(Buffer.from(waterVizBuf), {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  return {
    dataUrl: `data:image/png;base64,${waterDebugPng.toString('base64')}`,
    waterPxCount,
  };
}

/** Mix-decision: decide if an individual pixel should be kept based on sub-cluster approval. */
function keepMixedPixel(
  i: number,
  colorBuf: Buffer,
  approvedSubs: Set<number>,
  cents: Array<[number, number, number]> | undefined,
): boolean {
  if (!cents) return false;
  const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b = colorBuf[i * 3 + 2];
  const d0 = (r - cents[0][0]) ** 2 + (g - cents[0][1]) ** 2 + (b - cents[0][2]) ** 2;
  const d1 = (r - cents[1][0]) ** 2 + (g - cents[1][1]) ** 2 + (b - cents[1][2]) ** 2;
  const nearest = d0 <= d1 ? 0 : 1;
  return approvedSubs.has(nearest);
}

/** Rebuild the water mask in place from the user decision (approved whole / mixed sub-clusters). */
function rebuildMaskFromDecision(
  waterMask: Uint8Array,
  savedWaterLabels: Int32Array,
  compStats: Map<number, CompStat>,
  approvedSet: Set<number>,
  mixMap: Map<number, Set<number>>,
  compSubCentroids: Map<number, Array<[number, number, number]>>,
  colorBuf: Buffer,
  tp: number,
): void {
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
      if (keepMixedPixel(i, colorBuf, approvedSubs, cents)) {
        waterMask[i] = 1;
      }
    }
  }
}

/** Emit the water_review SSE event and await the curator's decision. */
async function requestWaterReview(
  regionId: number,
  waterComponents: WaterComponent[],
  waterPxCount: number,
  tp: number,
  sendEvent: (event: Record<string, unknown>) => void,
): Promise<WaterReviewDecision> {
  const reviewId = `wr-${regionId}-${Date.now()}`;
  storeWaterCrops(reviewId, waterComponents);
  const cropCount = waterComponents.reduce((n, wc) => n + 1 + wc.subClusters.length, 0);
  console.log(`  [Water] Stored ${cropCount} crop(s) for review ${reviewId}`);

  sendEvent({
    type: 'water_review',
    reviewId,
    waterPxPercent: Math.round(waterPxCount / tp * 1000) / 10,
    waterComponents: waterComponents.map(wc => ({
      id: wc.id,
      pct: wc.pct,
      cropDataUrl: '',
      subClusters: wc.subClusters.map(sc => ({ idx: sc.idx, pct: sc.pct, cropDataUrl: '' })),
    })),
  });
  await new Promise(resolve => setImmediate(resolve));

  return new Promise<WaterReviewDecision>((resolve) => {
    registerWaterReview(reviewId, resolve);
  });
}

/** Log decision metadata and return parsed approval sets. */
function describeReviewDecision(
  decision: WaterReviewDecision,
  waterComponents: WaterComponent[],
  waterGrown: Uint8Array,
  tp: number,
): {
  approvedSet: Set<number>;
  mixMap: Map<number, Set<number>>;
  rejectedIds: number[];
  needsRebuild: boolean;
  preRebuildWaterPx: number;
} {
  const approvedSet = new Set(decision.approvedIds);
  const mixMap = new Map(decision.mixDecisions.map(m => [m.componentId, new Set(m.approvedSubClusters)]));
  const rejectedIds = waterComponents
    .filter(wc => !approvedSet.has(wc.id) && !mixMap.has(wc.id))
    .map(wc => wc.id);
  const needsRebuild = rejectedIds.length > 0 || mixMap.size > 0;
  let preRebuildWaterPx = 0;
  for (let i = 0; i < tp; i++) if (waterGrown[i]) preRebuildWaterPx++;
  console.log(`  [Water] Decision received: approved=[${[...approvedSet]}] rejected=[${rejectedIds}] mix=[${[...mixMap.keys()]}] all_components=[${waterComponents.map(wc => wc.id)}] needsRebuild=${needsRebuild} preRebuildWaterPx=${preRebuildWaterPx}`);
  return { approvedSet, mixMap, rejectedIds, needsRebuild, preRebuildWaterPx };
}

/** Apply a curator's review decision to the mask and emit a refreshed debug image. */
async function applyReviewDecision(
  ctx: PipelineContext,
  waterMask: Uint8Array,
  waterGrown: Uint8Array,
  savedWaterLabels: Int32Array,
  compStats: Map<number, CompStat>,
  compSubCentroids: Map<number, Array<[number, number, number]>>,
  colorBuf: Buffer,
  waterComponents: WaterComponent[],
  decision: WaterReviewDecision,
): Promise<void> {
  const { cv, TW, TH, tp, oddK, origW, origH, logStep, pushDebugImage } = ctx;
  const { approvedSet, mixMap, needsRebuild, preRebuildWaterPx } =
    describeReviewDecision(decision, waterComponents, waterGrown, tp);

  if (!needsRebuild) return;

  const changes: string[] = [];
  const rejected = waterComponents.filter(wc => !approvedSet.has(wc.id) && !mixMap.has(wc.id));
  if (rejected.length) changes.push(`${rejected.length} rejected`);
  if (mixMap.size) changes.push(`${mixMap.size} mixed`);
  await logStep(`Rebuilding water mask (${changes.join(', ')})...`);

  rebuildMaskFromDecision(waterMask, savedWaterLabels, compStats, approvedSet, mixMap, compSubCentroids, colorBuf, tp);

  const newGrown = dilateWaterMask(cv, waterMask, TW, TH, oddK);
  for (let i = 0; i < tp; i++) waterGrown[i] = newGrown[i];

  let postRebuildWaterPx = 0;
  for (let i = 0; i < tp; i++) if (waterGrown[i]) postRebuildWaterPx++;
  console.log(`  [Water] Rebuild complete: ${preRebuildWaterPx} → ${postRebuildWaterPx} water px (delta: ${postRebuildWaterPx - preRebuildWaterPx})`);

  const { dataUrl, waterPxCount: cnt } = await renderWaterDebugImage(colorBuf, waterGrown, tp, TW, TH, origW, origH);
  await pushDebugImage(`Water mask (corrected, ${cnt} px = ${(cnt / tp * 100).toFixed(1)}%)`, dataUrl);
}

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
  const { cv, TW, TH, tp, oddK, origW, origH, regionId, pushDebugImage, sendEvent, origDownBuf } = ctx;

  // --- Morphological close to fill small gaps ---
  const wkSize = oddK(7);
  const waterKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wkSize, wkSize));
  const waterClosedMat = morphCloseWaterMask(cv, waterMaskIn, TW, TH, waterKernel);

  // --- Connected components ---
  const waterLabels = new cv.Mat();
  const waterStats = new cv.Mat();
  const waterCents = new cv.Mat();
  const numWaterCC = cv.connectedComponentsWithStats(waterClosedMat, waterLabels, waterStats, waterCents);
  waterClosedMat.delete();
  waterCents.delete();

  const waterMask = new Uint8Array(tp);
  const waterLabelData: Int32Array = waterLabels.data32S;
  const compSubCentroids = new Map<number, Array<[number, number, number]>>();

  // --- Narrow-neck splitting of large blobs ---
  const compStats = collectComponentStats(cv, waterStats, numWaterCC);
  splitLargeComponents(cv, waterLabelData, compStats, numWaterCC, tp, TW, TH, oddK);

  // --- Component filtering + crop generation + sub-clustering ---
  const waterComponents = await buildWaterComponents(
    origDownBuf, colorBuf, waterLabelData, waterMask,
    compStats, tp, TW, TH, compSubCentroids,
  );

  const savedWaterLabels = new Int32Array(waterLabelData);
  waterLabels.delete();
  waterStats.delete();
  console.log(`  [Water] ${waterComponents.length} component(s) after CC filter (from ${numWaterCC - 1} raw)`);

  // --- Edge-connectivity filter: remove thin water tentacles extending into land ---
  applyEdgeConnectivityFilter(cv, waterMask, TW, TH, tp, oddK);

  // --- Final dilation ---
  const waterGrown = dilateWaterMask(cv, waterMask, TW, TH, oddK);
  waterKernel.delete();

  // --- Debug image: water mask overlay ---
  const { dataUrl: debugDataUrl, waterPxCount } =
    await renderWaterDebugImage(colorBuf, waterGrown, tp, TW, TH, origW, origH);
  await pushDebugImage(
    `Water mask (red, ${waterPxCount} px = ${(waterPxCount / tp * 100).toFixed(1)}%)`,
    debugDataUrl,
  );

  // --- Interactive per-component water review ---
  if (waterComponents.length > 0) {
    const decision = await requestWaterReview(regionId, waterComponents, waterPxCount, tp, sendEvent);
    await applyReviewDecision(
      ctx, waterMask, waterGrown, savedWaterLabels, compStats, compSubCentroids,
      colorBuf, waterComponents, decision,
    );
  }

  return waterGrown;
}
