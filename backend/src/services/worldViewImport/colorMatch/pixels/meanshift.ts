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
 * The background, water, foreign-land and coastal masks it builds the country
 * mask from are `landWaterMasks.ts`.
 *
 * Sets on ctx: waterGrown, countryMask, countrySize, coastalBand
 * Modifies: colorBuf (replaced with mean-shift filtered result)
 * Skips: hsvSharp, inpaintedBuf, labBufEarly (set to empty — not needed)
 */

import sharp from 'sharp';
import { reviewAndFinalizeWater } from '../water/waterFinalize.js';
import type { PipelineContext } from '../context.js';
import {
  computeCoastalBand,
  detectBackground,
  detectInlandWater,
  floodFillWater,
  removeForeignLand,
} from './landWaterMasks.js';

// ── Mean-shift parameters ──────────────────────────────────────────
const MS_SP = 10;   // spatial radius (pixels at full res) — must be smaller than narrowest region strip (~10-15px)
const MS_SR = 20;   // color radius (Lab distance) — 20 preserves distinct adjacent colors (yellow/orange boundary at Lab ~40)
const MAX_ITER = 5;  // max iterations per pixel for convergence

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenCV.js (cv / cv.Mat / cv.MatVector / ccStats) has no TypeScript types
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
