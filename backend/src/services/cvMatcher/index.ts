/**
 * Computer Vision-based map matcher.
 *
 * Aligns a Wikivoyage region map image with GADM division geometries
 * by matching country silhouettes, then samples colors at division
 * centroids to cluster divisions by Wikivoyage sub-region.
 *
 * No external CV library — uses sharp for pixel access and custom
 * multi-scale Jaccard similarity for alignment.
 */

import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DivisionCentroid {
  id: number;
  cx: number; // longitude
  cy: number; // latitude
}

export interface GeoBounds {
  minX: number; maxX: number; minY: number; maxY: number;
}

export interface ColorCluster {
  color: [number, number, number]; // representative RGB
  divisionIds: number[];
}

export interface MatchResult {
  clusters: ColorCluster[];
  /** Debug: base64 PNG showing sampled points on the map */
  debugImage?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Match divisions to Wikivoyage sub-regions by color sampling.
 *
 * @param silhouetteSvg - SVG string of the country outline (white fill on black)
 * @param svgViewBox - the SVG viewBox {x, y, w, h} (geographic coords, Y negated by ST_AsSVG)
 * @param geoBounds - geographic bounding box of the divisions
 * @param mapImageBuffer - downloaded Wikivoyage map image (PNG/JPEG buffer)
 * @param centroids - division centroids in geographic coordinates
 */
export async function matchByColor(
  silhouetteSvg: string,
  svgViewBox: { x: number; y: number; w: number; h: number },
  _geoBounds: GeoBounds,
  mapImageBuffer: Buffer,
  centroids: DivisionCentroid[],
): Promise<MatchResult> {
  // 1. Prepare images as raw pixel buffers
  const mapMeta = await sharp(mapImageBuffer).metadata();
  const mapW = mapMeta.width!;
  const mapH = mapMeta.height!;
  const mapPixels = await sharp(mapImageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Render silhouette SVG to a fixed-width PNG for matching
  const silW = 400;
  const silResult = await sharp(Buffer.from(silhouetteSvg))
    .resize(silW)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const silH = silResult.info.height;
  const silPixels = silResult.data;

  // 2. Create binary masks
  const bgColor = detectBackground(mapPixels, mapW, mapH);
  console.log(`  CV: background color = rgb(${bgColor.join(',')})`);
  const mapMask = createMask(mapPixels, mapW, mapH, bgColor, 60);
  const silMask = createSilhouetteMask(silPixels, silW, silH);

  // 3. Find best alignment via multi-scale search on downscaled images
  const searchScale = 0.2;
  const smW = Math.round(mapW * searchScale);
  const smH = Math.round(mapH * searchScale);
  const smallMapMask = await downscaleMask(mapMask, mapW, mapH, smW, smH);

  const best = await findBestAlignment(silMask, silW, silH, smallMapMask, smW, smH);
  console.log(`  CV: best alignment score=${best.score.toFixed(3)} at (${best.x},${best.y}) scale=${best.scale.toFixed(3)}`);

  // 4. Compute geo-to-pixel transform
  // The alignment found that the silhouette (resized to best.tplW x best.tplH)
  // fits at position (best.x, best.y) in the DOWNSCALED map.
  // Scale back to original map pixels:
  const matchedX = best.x / searchScale;
  const matchedY = best.y / searchScale;
  const matchedW = best.tplW / searchScale;
  const matchedH = best.tplH / searchScale;

  // The SVG viewBox maps geographic coordinates to silhouette pixels.
  // Geographic point (lon, lat) → SVG coords: (lon, -lat) [ST_AsSVG negates Y]
  // SVG → silhouette pixel: ((svgX - vb.x) / vb.w * silW, (svgY - vb.y) / vb.h * silH)
  // Silhouette pixel → map pixel: (matchedX + px/silW * matchedW, matchedY + py/silH * matchedH)
  //
  // Combined: for geographic (lon, lat):
  //   map_px_x = matchedX + (lon - vb.x) / vb.w * matchedW
  //   map_px_y = matchedY + (-lat - vb.y) / vb.h * matchedH
  const vb = svgViewBox;

  function geoToPixel(lon: number, lat: number): { px: number; py: number } {
    const px = matchedX + (lon - vb.x) / vb.w * matchedW;
    const py = matchedY + (-lat - vb.y) / vb.h * matchedH;
    return {
      px: Math.round(Math.max(0, Math.min(mapW - 1, px))),
      py: Math.round(Math.max(0, Math.min(mapH - 1, py))),
    };
  }

  // 5. Sample colors at centroids
  const samples = centroids.map(c => {
    const { px, py } = geoToPixel(c.cx, c.cy);
    const color = sampleColor(mapPixels, mapW, mapH, px, py, 5);
    return { id: c.id, color, px, py };
  });

  // 6. Cluster by color
  const clusters = clusterColors(samples);

  // 7. Generate debug image showing sampled points
  const debugImage = await generateDebugImage(mapImageBuffer, mapW, mapH, samples, {
    matchedX, matchedY, matchedW, matchedH,
  });

  return { clusters, debugImage };
}

// ---------------------------------------------------------------------------
// Background detection
// ---------------------------------------------------------------------------

/** Detect the background color by sampling the edges of the image. */
function detectBackground(
  pixels: Buffer, w: number, h: number,
): [number, number, number] {
  const samples: Array<[number, number, number]> = [];

  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 50))) {
    samples.push(getPixel(pixels, w, x, 0));
    samples.push(getPixel(pixels, w, x, h - 1));
  }
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 50))) {
    samples.push(getPixel(pixels, w, 0, y));
    samples.push(getPixel(pixels, w, w - 1, y));
  }

  // Quantize to bins and find most common
  const counts = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (const [r, g, b] of samples) {
    const key = `${Math.round(r / 32)},${Math.round(g / 32)},${Math.round(b / 32)}`;
    const entry = counts.get(key);
    if (entry) {
      entry.count++;
      entry.r += r;
      entry.g += g;
      entry.b += b;
    } else {
      counts.set(key, { count: 1, r, g, b });
    }
  }

  let bestEntry = { count: 0, r: 128, g: 128, b: 128 };
  for (const val of counts.values()) {
    if (val.count > bestEntry.count) bestEntry = val;
  }

  return [
    Math.round(bestEntry.r / bestEntry.count),
    Math.round(bestEntry.g / bestEntry.count),
    Math.round(bestEntry.b / bestEntry.count),
  ];
}

// ---------------------------------------------------------------------------
// Mask creation
// ---------------------------------------------------------------------------

function createMask(
  pixels: Buffer, w: number, h: number,
  bgColor: [number, number, number], tolerance: number,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const dist = Math.abs(r - bgColor[0]) + Math.abs(g - bgColor[1]) + Math.abs(b - bgColor[2]);
    mask[i] = dist > tolerance ? 1 : 0;
  }
  return mask;
}

function createSilhouetteMask(pixels: Buffer, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    mask[i] = pixels[i * 4] > 128 ? 1 : 0;
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Multi-scale alignment
// ---------------------------------------------------------------------------

interface AlignResult {
  x: number;
  y: number;
  tplW: number;
  tplH: number;
  scale: number;
  score: number;
}

async function downscaleMask(
  mask: Uint8Array, srcW: number, srcH: number,
  dstW: number, dstH: number,
): Promise<Uint8Array> {
  const grayBuf = Buffer.alloc(srcW * srcH);
  for (let i = 0; i < mask.length; i++) grayBuf[i] = mask[i] * 255;

  const resized = await sharp(grayBuf, { raw: { width: srcW, height: srcH, channels: 1 } })
    .resize(dstW, dstH)
    .raw()
    .toBuffer();

  const result = new Uint8Array(dstW * dstH);
  for (let i = 0; i < result.length; i++) {
    result[i] = resized[i] > 128 ? 1 : 0;
  }
  return result;
}

/**
 * Use integral images for fast region sums to speed up template matching.
 */
function buildIntegralImage(mask: Uint8Array, w: number, h: number): Int32Array {
  const integral = new Int32Array((w + 1) * (h + 1));
  const stride = w + 1;
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += mask[y * w + x];
      integral[(y + 1) * stride + (x + 1)] = rowSum + integral[y * stride + (x + 1)];
    }
  }
  return integral;
}

function regionSum(integral: Int32Array, stride: number, x: number, y: number, w: number, h: number): number {
  return integral[(y + h) * stride + (x + w)]
    - integral[y * stride + (x + w)]
    - integral[(y + h) * stride + x]
    + integral[y * stride + x];
}

async function findBestAlignment(
  silMask: Uint8Array, silW: number, silH: number,
  mapMask: Uint8Array, mapW: number, mapH: number,
): Promise<AlignResult> {
  let best: AlignResult = { x: 0, y: 0, tplW: 0, tplH: 0, scale: 1, score: -1 };

  // Build integral image of map mask for fast region sums
  const mapIntegral = buildIntegralImage(mapMask, mapW, mapH);
  const mapStride = mapW + 1;

  const scaleSteps = 15;
  const minScale = 0.2;
  const maxScale = 0.95;

  for (let si = 0; si < scaleSteps; si++) {
    const scale = minScale + (maxScale - minScale) * si / (scaleSteps - 1);

    const tplW = Math.round(mapW * scale);
    const tplH = Math.round(silH * (tplW / silW));

    if (tplW >= mapW || tplH >= mapH || tplW < 10 || tplH < 10) continue;

    const tplMask = await downscaleMask(silMask, silW, silH, tplW, tplH);

    let tplSum = 0;
    for (let i = 0; i < tplMask.length; i++) tplSum += tplMask[i];
    if (tplSum === 0) continue;

    // Slide with coarse step (4 pixels)
    const step = 4;
    for (let y = 0; y <= mapH - tplH; y += step) {
      for (let x = 0; x <= mapW - tplW; x += step) {
        // Quick check: map region sum (foreground pixels in window)
        const mapSum = regionSum(mapIntegral, mapStride, x, y, tplW, tplH);

        // Fast upper bound on Jaccard: min(tplSum, mapSum) / max(tplSum, mapSum)
        const upperBound = Math.min(tplSum, mapSum) / Math.max(tplSum, mapSum);
        if (upperBound < best.score * 0.8) continue; // prune clearly bad positions

        // Compute actual overlap (pixel-by-pixel)
        let overlap = 0;
        for (let ty = 0; ty < tplH; ty++) {
          const mapRowStart = (y + ty) * mapW + x;
          const tplRowStart = ty * tplW;
          for (let tx = 0; tx < tplW; tx++) {
            overlap += mapMask[mapRowStart + tx] & tplMask[tplRowStart + tx];
          }
        }

        const union = tplSum + mapSum - overlap;
        const score = union > 0 ? overlap / union : 0;

        if (score > best.score) {
          best = { x, y, tplW, tplH, scale, score };
        }
      }
    }
  }

  // Refine: search around best position with step=1
  if (best.score > 0) {
    const tplMask = await downscaleMask(silMask, silW, silH, best.tplW, best.tplH);
    let tplSum = 0;
    for (let i = 0; i < tplMask.length; i++) tplSum += tplMask[i];

    const refineRadius = 6;
    for (let y = Math.max(0, best.y - refineRadius); y <= Math.min(mapH - best.tplH, best.y + refineRadius); y++) {
      for (let x = Math.max(0, best.x - refineRadius); x <= Math.min(mapW - best.tplW, best.x + refineRadius); x++) {
        let overlap = 0;
        const mapSum = regionSum(mapIntegral, mapStride, x, y, best.tplW, best.tplH);
        for (let ty = 0; ty < best.tplH; ty++) {
          const mapRowStart = (y + ty) * mapW + x;
          const tplRowStart = ty * best.tplW;
          for (let tx = 0; tx < best.tplW; tx++) {
            overlap += mapMask[mapRowStart + tx] & tplMask[tplRowStart + tx];
          }
        }
        const union = tplSum + mapSum - overlap;
        const score = union > 0 ? overlap / union : 0;
        if (score > best.score) {
          best = { ...best, x, y, score };
        }
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Color sampling
// ---------------------------------------------------------------------------

function getPixel(pixels: Buffer, w: number, x: number, y: number): [number, number, number] {
  const i = (y * w + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

/**
 * Sample the dominant color around a point, ignoring border/text colors.
 */
function sampleColor(
  pixels: Buffer, w: number, h: number,
  cx: number, cy: number, radius: number,
): [number, number, number] {
  const samples: Array<[number, number, number]> = [];

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const [r, g, b] = getPixel(pixels, w, x, y);
      const brightness = r + g + b;
      if (brightness < 80 || brightness > 700) continue;
      samples.push([r, g, b]);
    }
  }

  if (samples.length === 0) {
    const px = Math.max(0, Math.min(w - 1, cx));
    const py = Math.max(0, Math.min(h - 1, cy));
    return getPixel(pixels, w, px, py);
  }

  const rs = samples.map(s => s[0]).sort((a, b) => a - b);
  const gs = samples.map(s => s[1]).sort((a, b) => a - b);
  const bs = samples.map(s => s[2]).sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  return [rs[mid], gs[mid], bs[mid]];
}

// ---------------------------------------------------------------------------
// Color clustering
// ---------------------------------------------------------------------------

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

interface ColorSample {
  id: number;
  color: [number, number, number];
  px: number;
  py: number;
}

function clusterColors(samples: ColorSample[]): ColorCluster[] {
  const threshold = 35;
  const clusters: Array<{ colors: Array<[number, number, number]>; ids: number[] }> = [];

  for (const s of samples) {
    let found = false;
    for (const cluster of clusters) {
      const n = cluster.colors.length;
      const avgR = cluster.colors.reduce((sum, c) => sum + c[0], 0) / n;
      const avgG = cluster.colors.reduce((sum, c) => sum + c[1], 0) / n;
      const avgB = cluster.colors.reduce((sum, c) => sum + c[2], 0) / n;
      if (colorDistance(s.color, [avgR, avgG, avgB]) < threshold) {
        cluster.colors.push(s.color);
        cluster.ids.push(s.id);
        found = true;
        break;
      }
    }
    if (!found) {
      clusters.push({ colors: [s.color], ids: [s.id] });
    }
  }

  // Sort by cluster size descending
  clusters.sort((a, b) => b.ids.length - a.ids.length);

  return clusters.map(c => ({
    color: [
      Math.round(c.colors.reduce((s, v) => s + v[0], 0) / c.colors.length),
      Math.round(c.colors.reduce((s, v) => s + v[1], 0) / c.colors.length),
      Math.round(c.colors.reduce((s, v) => s + v[2], 0) / c.colors.length),
    ] as [number, number, number],
    divisionIds: c.ids,
  }));
}

// ---------------------------------------------------------------------------
// Debug image
// ---------------------------------------------------------------------------

async function generateDebugImage(
  mapBuffer: Buffer, w: number, h: number,
  samples: ColorSample[],
  matchBox: { matchedX: number; matchedY: number; matchedW: number; matchedH: number },
): Promise<string> {
  const dots = samples.map(s => {
    const [r, g, b] = s.color;
    return `<circle cx="${s.px}" cy="${s.py}" r="5" fill="rgb(${r},${g},${b})" stroke="#000" stroke-width="1.5"/>`;
  }).join('\n');

  // Draw the matched bounding box for alignment debug
  const { matchedX: mx, matchedY: my, matchedW: mw, matchedH: mh } = matchBox;
  const rect = `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" fill="none" stroke="red" stroke-width="2" stroke-dasharray="8,4"/>`;

  const overlay = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${rect}\n${dots}</svg>`,
  );

  const result = await sharp(mapBuffer)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return `data:image/png;base64,${result.toString('base64')}`;
}
