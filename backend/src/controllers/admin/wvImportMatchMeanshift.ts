/**
 * Mean-shift preprocessing phase.
 *
 * Replaces the classical pipeline's text detection + water detection +
 * background detection + park removal with a single mean-shift filtering step
 * followed by simple background and water removal.
 *
 * Mean-shift filtering smooths the image in spatial+color space, merging
 * similar colors within a neighbourhood. This absorbs text, thin lines,
 * and small symbols into the dominant region color — no OCR or inpainting
 * needed.
 *
 * Since `cv.pyrMeanShiftFiltering` is NOT available in the @techstark/opencv-js
 * WASM build, the algorithm is implemented manually in Lab color space at
 * half resolution for speed.
 *
 * Sets on ctx: waterGrown, countryMask, countrySize, coastalBand
 * Modifies: colorBuf (replaced with mean-shift filtered result)
 * Skips: hsvSharp, inpaintedBuf, labBufEarly (set to empty — not needed)
 */

import sharp from 'sharp';
import { reviewAndFinalizeWater } from './wvImportMatchHelpers.js';
import type { PipelineContext } from './wvImportMatchContext.js';

// ── Mean-shift parameters ──────────────────────────────────────────
const MS_SP = 10;   // spatial radius (pixels at full res) — must be smaller than narrowest region strip (~10-15px)
const MS_SR = 20;   // color radius (Lab distance) — 20 preserves distinct adjacent colors (yellow/orange boundary at Lab ~40)
const MAX_ITER = 5;  // max iterations per pixel for convergence
const BG_RGB_DIST = 30;   // flood-fill color distance for background
const WATER_H_MIN = 70;   // HSV hue range for water (teal/blue)
const WATER_H_MAX = 140;
const WATER_S_MIN = 20;   // minimum saturation for water edge pixels
const COASTAL_BAND_PX = 5; // pixels from water boundary counted as coastal

/**
 * Mean-shift filter operating in Lab color space at half resolution.
 *
 * For each pixel, iteratively shift toward the mean color of pixels
 * within the spatial window whose Lab distance is < sr, until convergence.
 * Processes at half resolution (stride-2) for speed, then upscales.
 */
/**
 * Iterate a single pixel's mean-shift position until convergence or MAX_ITER.
 * Returns the final Lab color [L,A,B] for the pixel.
 */
function meanShiftPixel(
  sData: Uint8Array | Buffer,
  halfW: number,
  halfH: number,
  x: number,
  y: number,
  halfSp: number,
  stride: number,
  sr2: number,
): [number, number, number] {
  const idx0 = (y * halfW + x) * 3;
  let cL = sData[idx0];
  let cA = sData[idx0 + 1];
  let cB = sData[idx0 + 2];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let sumL = 0, sumA = 0, sumB = 0, count = 0;
    const y0 = Math.max(0, y - halfSp);
    const y1 = Math.min(halfH - 1, y + halfSp);
    const x0 = Math.max(0, x - halfSp);
    const x1 = Math.min(halfW - 1, x + halfSp);

    for (let ny = y0; ny <= y1; ny += stride) {
      for (let nx = x0; nx <= x1; nx += stride) {
        const nIdx = (ny * halfW + nx) * 3;
        const dL = sData[nIdx] - cL;
        const dA = sData[nIdx + 1] - cA;
        const dB = sData[nIdx + 2] - cB;
        if (dL * dL + dA * dA + dB * dB <= sr2) {
          sumL += sData[nIdx];
          sumA += sData[nIdx + 1];
          sumB += sData[nIdx + 2];
          count++;
        }
      }
    }

    if (count === 0) break;
    const newL = Math.round(sumL / count);
    const newA = Math.round(sumA / count);
    const newB = Math.round(sumB / count);
    if (newL === cL && newA === cA && newB === cB) break;
    cL = newL;
    cA = newA;
    cB = newB;
  }
  return [cL, cA, cB];
}

function meanShiftFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  srcBuf: Buffer,
  width: number,
  height: number,
  sp: number,
  sr: number,
): Buffer {
  // Create OpenCV Mat from raw RGB buffer
  const srcMat = new cv.Mat(height, width, cv.CV_8UC3);
  srcMat.data.set(srcBuf);

  // Convert to Lab color space
  const labMat = new cv.Mat();
  cv.cvtColor(srcMat, labMat, cv.COLOR_RGB2Lab);
  srcMat.delete();

  // Work at half resolution for speed
  const halfW = Math.round(width / 2);
  const halfH = Math.round(height / 2);
  const smallLab = new cv.Mat();
  cv.resize(labMat, smallLab, new cv.Size(halfW, halfH), 0, 0, cv.INTER_AREA);

  const halfSp = Math.max(Math.round(sp / 2), 3);
  const sr2 = sr * sr;

  const sData = smallLab.data;
  const outData = new Uint8Array(sData.length);
  const stride = halfSp >= 10 ? 2 : 1;

  for (let y = 0; y < halfH; y++) {
    for (let x = 0; x < halfW; x++) {
      const idx0 = (y * halfW + x) * 3;
      const [cL, cA, cB] = meanShiftPixel(sData, halfW, halfH, x, y, halfSp, stride, sr2);
      outData[idx0] = cL;
      outData[idx0 + 1] = cA;
      outData[idx0 + 2] = cB;
    }
  }

  // Put result into a Mat, upscale back to original size, convert to RGB
  const outSmall = cv.matFromArray(halfH, halfW, cv.CV_8UC3, outData);
  const outLab = new cv.Mat();
  cv.resize(outSmall, outLab, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);

  const outRgb = new cv.Mat();
  cv.cvtColor(outLab, outRgb, cv.COLOR_Lab2RGB);
  const resultBuf = Buffer.from(outRgb.data);

  // Cleanup OpenCV Mats
  labMat.delete();
  smallLab.delete();
  outSmall.delete();
  outLab.delete();
  outRgb.delete();

  return resultBuf;
}

/**
 * Run one flood-fill pass from `startPix`, writing reachable pixels to `mask`.
 * Pixels whose RGB is within (sqrt(thresh2)) of the reference color are included.
 */
function floodFillFromSeed(
  buf: Buffer,
  width: number,
  height: number,
  startPix: number,
  refR: number, refG: number, refB: number,
  thresh2: number,
  mask: Uint8Array,
): void {
  const tp = width * height;
  const stack = [startPix];
  const visited = new Uint8Array(tp);

  while (stack.length > 0) {
    const pix = stack.pop()!;
    if (visited[pix]) continue;
    visited[pix] = 1;

    const idx = pix * 3;
    const dR = buf[idx] - refR;
    const dG = buf[idx + 1] - refG;
    const dB = buf[idx + 2] - refB;
    if (dR * dR + dG * dG + dB * dB > thresh2) continue;

    mask[pix] = 1;

    const y = Math.floor(pix / width);
    const x = pix % width;
    if (y > 0) stack.push(pix - width);
    if (y < height - 1) stack.push(pix + width);
    if (x > 0) stack.push(pix - 1);
    if (x < width - 1) stack.push(pix + 1);
  }
}

/**
 * Flood-fill from the four image corners for background detection.
 * Pixels whose RGB distance from the corner pixel is < threshold are marked.
 */
function floodFillBackground(
  buf: Buffer,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const tp = width * height;
  const mask = new Uint8Array(tp);
  const thresh2 = threshold * threshold * 3; // Euclidean squared on RGB

  // Average color of the four corners
  const corners = [
    0,
    width - 1,
    (height - 1) * width,
    (height - 1) * width + width - 1,
  ];
  let avgR = 0, avgG = 0, avgB = 0;
  for (const pix of corners) {
    avgR += buf[pix * 3];
    avgG += buf[pix * 3 + 1];
    avgB += buf[pix * 3 + 2];
  }
  avgR = Math.round(avgR / 4);
  avgG = Math.round(avgG / 4);
  avgB = Math.round(avgB / 4);

  // Flood fill from each corner
  for (const startPix of corners) {
    floodFillFromSeed(buf, width, height, startPix, avgR, avgG, avgB, thresh2, mask);
  }

  return mask;
}

/**
 * Collect water-like edge pixels (HSV hue in [WATER_H_MIN, WATER_H_MAX], saturation > threshold)
 * along a 5-pixel-wide band on each edge of the image. Returns seeds and reference colour sum.
 */
function collectWaterEdgeSeeds(
  buf: Buffer,
  hsvData: Buffer,
  width: number,
  height: number,
): { seeds: number[]; wR: number; wG: number; wB: number; wCount: number } {
  const seeds: number[] = [];
  let wR = 0, wG = 0, wB = 0, wCount = 0;

  const addEdgePixel = (pix: number) => {
    const h = hsvData[pix * 3];
    const s = hsvData[pix * 3 + 1];
    if (h >= WATER_H_MIN && h <= WATER_H_MAX && s > WATER_S_MIN) {
      seeds.push(pix);
      wR += buf[pix * 3];
      wG += buf[pix * 3 + 1];
      wB += buf[pix * 3 + 2];
      wCount++;
    }
  };

  for (let x = 0; x < width; x++) {
    for (let band = 0; band < 5; band++) {
      addEdgePixel(band * width + x);
      addEdgePixel((height - 1 - band) * width + x);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let band = 0; band < 5; band++) {
      addEdgePixel(y * width + band);
      addEdgePixel(y * width + width - 1 - band);
    }
  }
  return { seeds, wR, wG, wB, wCount };
}

/**
 * Simple water detection via flood fill from edges.
 * Checks HSV: H in [70,140], S > threshold on edge pixels, then flood fills
 * from those seeds using RGB distance.
 */
function floodFillWater(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  buf: Buffer,
  width: number,
  height: number,
): { mask: Uint8Array; refColor: [number, number, number] | null } {
  const tp = width * height;
  const waterMask = new Uint8Array(tp);

  // Convert to HSV for edge pixel detection
  const srcMat = new cv.Mat(height, width, cv.CV_8UC3);
  srcMat.data.set(buf);
  const hsvMat = new cv.Mat();
  cv.cvtColor(srcMat, hsvMat, cv.COLOR_RGB2HSV);
  const hsvData = Buffer.from(hsvMat.data);
  srcMat.delete();
  hsvMat.delete();

  const { seeds: waterSeeds, wR, wG, wB, wCount } = collectWaterEdgeSeeds(buf, hsvData, width, height);

  if (wCount === 0) return { mask: waterMask, refColor: null }; // No water detected on edges

  // Average water color
  const refR = Math.round(wR / wCount);
  const refG = Math.round(wG / wCount);
  const refB = Math.round(wB / wCount);
  const thresh2 = BG_RGB_DIST * BG_RGB_DIST * 3;

  // Flood fill from water seeds
  const visited = new Uint8Array(tp);
  const stack = [...waterSeeds];

  while (stack.length > 0) {
    const pix = stack.pop()!;
    if (visited[pix]) continue;
    visited[pix] = 1;

    const idx = pix * 3;
    const dR = buf[idx] - refR;
    const dG = buf[idx + 1] - refG;
    const dB = buf[idx + 2] - refB;
    if (dR * dR + dG * dG + dB * dB > thresh2) continue;

    waterMask[pix] = 1;

    const y = Math.floor(pix / width);
    const x = pix % width;
    if (y > 0) stack.push(pix - width);
    if (y < height - 1) stack.push(pix + width);
    if (x > 0) stack.push(pix - 1);
    if (x < width - 1) stack.push(pix + 1);
  }

  return { mask: waterMask, refColor: [refR, refG, refB] };
}

/**
 * Also detect gray/unsaturated background: pixels with S < 15 (~6% of 255)
 * in HSV are considered gray. Very light-colored regions (e.g. Tyrol's light
 * pink at S≈24) are kept while pure gray backgrounds (S≈0) are caught.
 * The primary RGB flood fill from corners handles the main background detection;
 * this is a second layer for gray "islands" unreachable from corners.
 */
function detectGrayBackground(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  buf: Buffer,
  width: number,
  height: number,
): Uint8Array {
  const tp = width * height;
  const mask = new Uint8Array(tp);

  // Convert to HSV
  const srcMat = new cv.Mat(height, width, cv.CV_8UC3);
  srcMat.data.set(buf);
  const hsvMat = new cv.Mat();
  cv.cvtColor(srcMat, hsvMat, cv.COLOR_RGB2HSV);
  const hsvData = Buffer.from(hsvMat.data);
  srcMat.delete();
  hsvMat.delete();

  // Mark low-saturation pixels as gray candidates.
  // Threshold 15 (~6%) catches true gray (S≈0) while preserving very light
  // region fills like pale pink (S≈20-25) that appear on WV maps.
  for (let i = 0; i < tp; i++) {
    if (hsvData[i * 3 + 1] < 15) mask[i] = 1;
  }

  return mask;
}

/**
 * Check if any pixel within `radius` of (x, y) is flagged in `waterMask`.
 */
function anyWaterInRadius(
  waterMask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): boolean {
  const y0 = Math.max(0, y - radius);
  const y1 = Math.min(height - 1, y + radius);
  const x0 = Math.max(0, x - radius);
  const x1 = Math.min(width - 1, x + radius);

  for (let ny = y0; ny <= y1; ny++) {
    for (let nx = x0; nx <= x1; nx++) {
      if (waterMask[ny * width + nx]) return true;
    }
  }
  return false;
}

/**
 * Compute coastal band: pixels within COASTAL_BAND_PX of water that are in countryMask.
 */
function computeCoastalBand(
  waterMask: Uint8Array,
  countryMask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const tp = width * height;
  const coastal = new Uint8Array(tp);
  const radius = COASTAL_BAND_PX;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pix = y * width + x;
      if (!countryMask[pix]) continue;
      if (anyWaterInRadius(waterMask, width, height, x, y, radius)) {
        coastal[pix] = 1;
      }
    }
  }

  return coastal;
}

/**
 * Compute HSL hue for a vivid-color pixel, or null if the pixel is too desaturated.
 */
function roadPixelHue(r: number, g: number, b: number): number | null {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d < 30) return null;
  const s = mx > 0 ? d / mx : 0;
  if (s < 0.3) return null;
  let h = 0;
  if (mx === r) h = ((g - b) / d) * 60;
  else if (mx === g) h = ((b - r) / d) * 60 + 120;
  else h = ((r - g) / d) * 60 + 240;
  if (h < 0) h += 360;
  return h;
}

function isRoadHue(h: number): boolean {
  return (h <= 25 || h >= 335) || (h >= 40 && h <= 70) || (h >= 170 && h <= 270);
}

/**
 * Replace one road pixel with the average of its 4-neighbour non-road pixels.
 * Returns true if the pixel was replaced.
 */
function replaceSingleRoadPixel(
  colorBuf: Buffer,
  roadMask: Uint8Array,
  i: number,
  TW: number,
  tp: number,
): boolean {
  let sumR = 0, sumG = 0, sumB = 0, cnt = 0;
  for (const n of [i - 1, i + 1, i - TW, i + TW]) {
    if (n >= 0 && n < tp && !roadMask[n]) {
      sumR += colorBuf[n * 3]; sumG += colorBuf[n * 3 + 1]; sumB += colorBuf[n * 3 + 2];
      cnt++;
    }
  }
  if (cnt === 0) return false;
  colorBuf[i * 3] = Math.round(sumR / cnt);
  colorBuf[i * 3 + 1] = Math.round(sumG / cnt);
  colorBuf[i * 3 + 2] = Math.round(sumB / cnt);
  return true;
}

/**
 * Step 0: detect and replace red/yellow/blue thin-line pixels with their
 * non-road neighbour average. Mutates `colorBuf` in place.
 */
function replaceRoadPixels(colorBuf: Buffer, tp: number, TW: number): void {
  const roadMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    const h = roadPixelHue(colorBuf[i * 3], colorBuf[i * 3 + 1], colorBuf[i * 3 + 2]);
    if (h != null && isRoadHue(h)) roadMask[i] = 1;
  }
  let replaced = 0;
  for (let i = 0; i < tp; i++) {
    if (!roadMask[i]) continue;
    if (replaceSingleRoadPixel(colorBuf, roadMask, i, TW, tp)) replaced++;
  }
  if (replaced > 0) console.log(`  [MS] Gentle road replacement: ${replaced} pixels`);
}

/**
 * Morphologically open a gray-mask (ellipse-kernel) to remove thin features like
 * border lines. Returns a 0/1 Uint8Array of the same shape.
 */
function openGrayMask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  bgMaskGrayRaw: Uint8Array,
  TW: number,
  TH: number,
  tp: number,
  openKSize: number,
): Uint8Array {
  const grayMat = cv.matFromArray(TH, TW, cv.CV_8UC1,
    Uint8Array.from(bgMaskGrayRaw, (v: number) => v ? 255 : 0));
  const openKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(openKSize, openKSize));
  const grayOpened = new cv.Mat();
  cv.morphologyEx(grayMat, grayOpened, cv.MORPH_OPEN, openKernel);
  const bgMaskGray = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) bgMaskGray[i] = grayOpened.data[i] ? 1 : 0;
  grayMat.delete(); openKernel.delete(); grayOpened.delete();
  return bgMaskGray;
}

/**
 * Collect gray-mask pixels along the image border (corners + edges) as flood-fill seeds.
 */
function collectGrayBorderSeeds(
  bgMaskGray: Uint8Array,
  TW: number,
  TH: number,
): number[] {
  const corners = [0, TW - 1, (TH - 1) * TW, (TH - 1) * TW + TW - 1];
  const seeds: number[] = [];
  for (const c of corners) {
    if (bgMaskGray[c]) seeds.push(c);
  }
  for (let x = 0; x < TW; x++) {
    if (bgMaskGray[x]) seeds.push(x);
    if (bgMaskGray[(TH - 1) * TW + x]) seeds.push((TH - 1) * TW + x);
  }
  for (let y = 0; y < TH; y++) {
    if (bgMaskGray[y * TW]) seeds.push(y * TW);
    if (bgMaskGray[y * TW + TW - 1]) seeds.push(y * TW + TW - 1);
  }
  return seeds;
}

/**
 * Flood-fill a gray mask from all border pixels (corners + edges). Only gray pixels
 * reachable from edges get marked, keeping interior gray regions alive.
 */
function floodFillGrayFromBorders(
  bgMaskGray: Uint8Array,
  TW: number,
  TH: number,
  tp: number,
): Uint8Array {
  const bgMaskGrayFilled = new Uint8Array(tp);
  const visited = new Uint8Array(tp);
  const stack = collectGrayBorderSeeds(bgMaskGray, TW, TH);
  while (stack.length > 0) {
    const pix = stack.pop()!;
    if (visited[pix]) continue;
    visited[pix] = 1;
    if (!bgMaskGray[pix]) continue;
    bgMaskGrayFilled[pix] = 1;
    const y = Math.floor(pix / TW);
    const x = pix % TW;
    if (y > 0) stack.push(pix - TW);
    if (y < TH - 1) stack.push(pix + TW);
    if (x > 0) stack.push(pix - 1);
    if (x < TW - 1) stack.push(pix + 1);
  }
  return bgMaskGrayFilled;
}

/**
 * Step 2: Detect background pixels via RGB flood-fill + opened gray mask.
 */
function detectBackground(
  ctx: PipelineContext,
  tp: number,
): Uint8Array {
  const { cv, TW, TH } = ctx;

  const bgMaskRgb = floodFillBackground(Buffer.from(ctx.origDownBuf), TW, TH, BG_RGB_DIST);
  const bgMaskGrayRaw = detectGrayBackground(cv, Buffer.from(ctx.origDownBuf), TW, TH);

  const openKSize = ctx.oddK(5);
  const bgMaskGray = openGrayMask(cv, bgMaskGrayRaw, TW, TH, tp, openKSize);

  const grayRawCount = bgMaskGrayRaw.reduce((s: number, v: number) => s + v, 0);
  const grayOpenCount = bgMaskGray.reduce((s: number, v: number) => s + v, 0);
  if (grayRawCount !== grayOpenCount) {
    console.log(`  [MS] Gray bg opening: ${grayRawCount} → ${grayOpenCount} px (removed ${grayRawCount - grayOpenCount} thin features)`);
  }

  const bgMaskGrayFilled = floodFillGrayFromBorders(bgMaskGray, TW, TH, tp);
  const filledCount = bgMaskGrayFilled.reduce((s, v) => s + v, 0);
  if (filledCount !== grayOpenCount) {
    console.log(`  [MS] Gray bg flood fill: ${grayOpenCount} → ${filledCount} px (${grayOpenCount - filledCount} interior gray pixels kept as country)`);
  }

  const bgMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (bgMaskRgb[i] || bgMaskGrayFilled[i]) bgMask[i] = 1;
  }
  return bgMask;
}

/**
 * Detect inland water bodies as large CCs of pixels close to the sea reference colour.
 * Mutates `waterMask` to include the identified inland pixels.
 */
/**
 * Flood-fill one 4-connected component starting at `seed` in `waterLike`.
 * Marks visited pixels in `visited` and returns the component's pixel list.
 */
function growInlandWaterComponent(
  seed: number,
  waterLike: Uint8Array,
  visited: Uint8Array,
  TW: number,
  TH: number,
  tp: number,
): number[] {
  const component: number[] = [];
  const stack = [seed];
  while (stack.length > 0) {
    const pix = stack.pop()!;
    if (visited[pix]) continue;
    visited[pix] = 1;
    if (!waterLike[pix]) continue;
    component.push(pix);
    const y = Math.floor(pix / TW);
    const x = pix % TW;
    if (y > 0) stack.push(pix - TW);
    if (y < TH - 1) stack.push(pix + TW);
    if (x > 0) stack.push(pix - 1);
    if (x < TW - 1 && (pix + 1) < tp) stack.push(pix + 1);
  }
  return component;
}

function detectInlandWater(
  origBuf: Buffer,
  waterMask: Uint8Array,
  bgMask: Uint8Array,
  waterRefColor: [number, number, number],
  tp: number,
  TW: number,
  TH: number,
): void {
  const [wR, wG, wB] = waterRefColor;
  const inlandThresh2 = 25 * 25 * 3;
  const waterLike = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (waterMask[i] || bgMask[i]) continue;
    const dR = origBuf[i * 3] - wR;
    const dG = origBuf[i * 3 + 1] - wG;
    const dB = origBuf[i * 3 + 2] - wB;
    if (dR * dR + dG * dG + dB * dB <= inlandThresh2) {
      waterLike[i] = 1;
    }
  }

  const visited = new Uint8Array(tp);
  const minLakeSize = Math.max(100, Math.round(tp * 0.005));
  let inlandCount = 0;

  for (let seed = 0; seed < tp; seed++) {
    if (!waterLike[seed] || visited[seed]) continue;
    const component = growInlandWaterComponent(seed, waterLike, visited, TW, TH, tp);
    if (component.length >= minLakeSize) {
      for (const pix of component) waterMask[pix] = 1;
      inlandCount += component.length;
    }
  }

  if (inlandCount > 0) {
    console.log(`  [MS] Inland water detection: ${inlandCount} pixels (ref color rgb(${wR},${wG},${wB}))`);
  }
}

/**
 * Identify which connected-component labels touch the image border.
 */
function findBorderTouchingCCs(
  ccData: Int32Array,
  TW: number,
  TH: number,
): Set<number> {
  const touchesBorder = new Set<number>();
  for (let x = 0; x < TW; x++) {
    const topLabel = ccData[x];
    const botLabel = ccData[(TH - 1) * TW + x];
    if (topLabel > 0) touchesBorder.add(topLabel);
    if (botLabel > 0) touchesBorder.add(botLabel);
  }
  for (let y = 0; y < TH; y++) {
    const leftLabel = ccData[y * TW];
    const rightLabel = ccData[y * TW + TW - 1];
    if (leftLabel > 0) touchesBorder.add(leftLabel);
    if (rightLabel > 0) touchesBorder.add(rightLabel);
  }
  return touchesBorder;
}

/**
 * Find the biggest CC label (by area) among labels 1..numCC-1.
 */
function findMainCC(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ccStats: any,
  numCC: number,
): { mainCC: number; mainSize: number } {
  let mainCC = 1, mainSize = 0;
  for (let c = 1; c < numCC; c++) {
    const area = ccStats.intAt(c, cv.CC_STAT_AREA);
    if (area > mainSize) { mainSize = area; mainCC = c; }
  }
  return { mainCC, mainSize };
}

/**
 * Clear pixels belonging to CC label `c` from `countryMask`. Returns number cleared.
 */
function clearCCFromMask(
  ccData: Int32Array,
  countryMask: Uint8Array,
  c: number,
  tp: number,
): number {
  let cleared = 0;
  for (let i = 0; i < tp; i++) {
    if (ccData[i] === c) {
      countryMask[i] = 0;
      cleared++;
    }
  }
  return cleared;
}

/**
 * Decide whether a CC should be kept (not removed). A CC is kept if it's interior
 * (not on border) OR if it's a large border CC (>15% of main).
 */
function shouldKeepCC(
  area: number,
  mainSize: number,
  atBorder: boolean,
): boolean {
  return !atBorder || area > mainSize * 0.15;
}

/**
 * Remove pixels belonging to foreign-land CCs from `countryMask` and return count removed.
 */
function stripForeignCCs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ccStats: any,
  ccData: Int32Array,
  countryMask: Uint8Array,
  numCC: number,
  mainCC: number,
  mainSize: number,
  touchesBorder: Set<number>,
  tp: number,
): number {
  let foreignRemoved = 0;
  const removedDetails: string[] = [];
  for (let c = 1; c < numCC; c++) {
    if (c === mainCC) continue;
    const area = ccStats.intAt(c, cv.CC_STAT_AREA);
    const pct = ((area / mainSize) * 100).toFixed(1);
    const atBorder = touchesBorder.has(c);

    if (shouldKeepCC(area, mainSize, atBorder)) {
      if (area > mainSize * 0.01) {
        console.log(`  [MS] Foreign land: kept CC #${c} (${pct}% of main, ${atBorder ? 'border' : 'interior'})`);
      }
      continue;
    }
    removedDetails.push(`CC #${c} ${pct}%`);
    foreignRemoved += clearCCFromMask(ccData, countryMask, c, tp);
  }
  if (foreignRemoved > 0) {
    console.log(`  [MS] Foreign land removal: removed ${foreignRemoved} px (${removedDetails.join(', ')})`);
  } else if (numCC > 2) {
    console.log(`  [MS] Foreign land removal: kept all ${numCC - 1} CCs (none matched border+small criteria)`);
  }
  return foreignRemoved;
}

/**
 * Step 6: Remove small disconnected country-mask CCs that touch the image border
 * (foreign land) while keeping interior CCs and large border CCs. Mutates `countryMask`.
 */
function removeForeignLand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  countryMask: Uint8Array,
  TW: number,
  TH: number,
  tp: number,
): number {
  let countryRemoved = 0;
  const cmMat = cv.matFromArray(TH, TW, cv.CV_8UC1, countryMask);
  const ccLabels = new cv.Mat();
  const ccStats = new cv.Mat();
  const ccCents = new cv.Mat();
  const numCC = cv.connectedComponentsWithStats(cmMat, ccLabels, ccStats, ccCents);
  cmMat.delete(); ccCents.delete();

  if (numCC > 2) {
    const { mainCC, mainSize } = findMainCC(cv, ccStats, numCC);
    const ccData = ccLabels.data32S;
    const touchesBorder = findBorderTouchingCCs(ccData, TW, TH);
    countryRemoved = stripForeignCCs(cv, ccStats, ccData, countryMask, numCC, mainCC, mainSize, touchesBorder, tp);
  }
  ccLabels.delete(); ccStats.delete();
  return countryRemoved;
}

/**
 * Render debug overlay showing background (gray) and water (blue) over the mean-shift buffer.
 */
async function pushBgWaterDebug(
  ctx: PipelineContext,
  bgMask: Uint8Array,
  waterMask: Uint8Array,
  tp: number,
): Promise<void> {
  const { TW, TH, origW, origH, colorBuf, pushDebugImage } = ctx;
  const debugBuf = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (bgMask[i]) {
      debugBuf[i * 3] = 200; debugBuf[i * 3 + 1] = 200; debugBuf[i * 3 + 2] = 200;
    } else if (waterMask[i]) {
      debugBuf[i * 3] = 100; debugBuf[i * 3 + 1] = 150; debugBuf[i * 3 + 2] = 255;
    } else {
      debugBuf[i * 3] = colorBuf[i * 3]; debugBuf[i * 3 + 1] = colorBuf[i * 3 + 1]; debugBuf[i * 3 + 2] = colorBuf[i * 3 + 2];
    }
  }
  const maskPng = await sharp(debugBuf, {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    'Background (gray) + Water (blue) detection',
    `data:image/png;base64,${maskPng.toString('base64')}`,
  );
}

/**
 * Render debug overlay of the country mask after foreign-land removal.
 */
async function pushCountryMaskDebug(
  ctx: PipelineContext,
  countryMask: Uint8Array,
  waterGrown: Uint8Array,
  tp: number,
): Promise<void> {
  const { TW, TH, origW, origH, colorBuf, pushDebugImage } = ctx;
  const cmDebug = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (countryMask[i]) {
      cmDebug[i * 3] = colorBuf[i * 3]; cmDebug[i * 3 + 1] = colorBuf[i * 3 + 1]; cmDebug[i * 3 + 2] = colorBuf[i * 3 + 2];
    } else if (waterGrown[i]) {
      cmDebug[i * 3] = 100; cmDebug[i * 3 + 1] = 150; cmDebug[i * 3 + 2] = 255;
    } else {
      cmDebug[i * 3] = 200; cmDebug[i * 3 + 1] = 200; cmDebug[i * 3 + 2] = 200;
    }
  }
  const cmPng = await sharp(cmDebug, {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    'Country mask (after foreign land removal)',
    `data:image/png;base64,${cmPng.toString('base64')}`,
  );
}

/**
 * Main mean-shift preprocessing function.
 *
 * Replaces the classical pipeline's detectText + detectWater + detectBackground
 * + detectParks with a single mean-shift pass followed by simple flood-fill
 * background/water removal.
 */
export async function meanshiftPreprocess(ctx: PipelineContext): Promise<void> {
  const {
    cv, TW, TH, tp, origW, origH,
    colorBuf,
    logStep, pushDebugImage,
  } = ctx;

  // Step 0: Gentle road pixel replacement
  replaceRoadPixels(colorBuf, tp, TW);

  // Step 1: Mean-shift filtering
  await logStep(`Mean-shift filtering (sp=${MS_SP}, sr=${MS_SR})...`);
  const filteredBuf = meanShiftFilter(cv, colorBuf, TW, TH, MS_SP, MS_SR);
  filteredBuf.copy(colorBuf);

  const filteredPng = await sharp(Buffer.from(colorBuf), {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    'Mean-shift filtered',
    `data:image/png;base64,${filteredPng.toString('base64')}`,
  );

  // Step 2: Simple background removal
  await logStep('Background removal (flood fill from corners)...');
  const bgMask = detectBackground(ctx, tp);

  // Step 3: Water detection (coastal + inland)
  await logStep('Water detection (flood fill from edges + inland lakes)...');
  const { mask: waterMask, refColor: waterRefColor } = floodFillWater(cv, Buffer.from(ctx.origDownBuf), TW, TH);

  const origBuf = ctx.origDownBuf;
  if (waterRefColor) {
    detectInlandWater(origBuf, waterMask, bgMask, waterRefColor, tp, TW, TH);
  }

  await pushBgWaterDebug(ctx, bgMask, waterMask, tp);

  // Step 4: Interactive water review (shared with classical pipeline)
  const waterGrown = await reviewAndFinalizeWater(waterMask, colorBuf, ctx);

  // Step 5: Build country mask
  const countryMask = new Uint8Array(tp);
  let countrySize = 0;
  for (let i = 0; i < tp; i++) {
    if (!bgMask[i] && !waterGrown[i]) {
      countryMask[i] = 1;
      countrySize++;
    }
  }

  // Step 6: Foreign land removal
  const removed = removeForeignLand(cv, countryMask, TW, TH, tp);
  countrySize -= removed;

  await pushCountryMaskDebug(ctx, countryMask, waterGrown, tp);

  // Coastal band: country pixels within 5px of water
  const coastalBand = computeCoastalBand(waterGrown, countryMask, TW, TH);

  // Set all ctx fields
  ctx.waterGrown = waterGrown;
  ctx.countryMask = countryMask;
  ctx.countrySize = countrySize;
  ctx.coastalBand = coastalBand;

  ctx.hsvSharp = Buffer.alloc(0);
  ctx.labBufEarly = Buffer.alloc(0);
  ctx.inpaintedBuf = null;
  ctx.hsvBuf = Buffer.alloc(0);

  await logStep(`Mean-shift preprocessing complete — ${countrySize} country pixels (${(countrySize / tp * 100).toFixed(1)}%)`);
}
