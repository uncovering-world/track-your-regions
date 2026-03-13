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
          AND ST_Contains(ad.geom_simplified_medium, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))
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
