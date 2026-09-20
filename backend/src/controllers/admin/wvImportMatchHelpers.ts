/**
 * Helper functions for WorldView Import Match pipeline.
 *
 * Extracted from wvImportMatchController.ts (Task 2 of the split).
 * Contains: colour-space conversion, the removal of a map's drawn lines, the
 * SVG a vision match is shown, and the markers a Wikivoyage article carries.
 *
 * The water a mean-shift pass finds left for `wvImportMatchWaterComponents.ts`
 * and `wvImportMatchWater.ts` when this file reached the length the lint draws
 * the line at (#933); the OpenCV namespace typing below is shared with them.
 */

import { pool } from '../../db/index.js';
import { parseMarkers, parseGeoTag } from '../../services/wikivoyageExtract/markerParser.js';
import { resolveMarkerCoordinates } from '../../services/worldViewImport/pointMatcher.js';
import { userAgent } from '../../config/userAgent.js';
// =============================================================================
// OpenCV namespace typing
// =============================================================================
// `@techstark/opencv-js` ships type definitions, but the WASM runtime doesn't
// perfectly match them (e.g. `pyrMeanShiftFiltering` is missing at runtime).
// We therefore use `typeof import(...)` to get the module's structural shape
// for parameter typing — good enough to satisfy `no-explicit-any` without
// pretending our subset matches the full declared API.
export type CvNs = typeof import('@techstark/opencv-js');
/** OpenCV Mat instance — created via `new cv.Mat(...)` or `cv.matFromArray(...)`. */
export type CvMat = InstanceType<CvNs['Mat']>;

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
      headers: { 'User-Agent': userAgent() },
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
