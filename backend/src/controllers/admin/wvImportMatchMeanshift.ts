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
 * Sets on ctx: textExcluded, waterGrown, countryMask, countrySize, coastalBand
 * Modifies: colorBuf (replaced with mean-shift filtered result)
 * Skips: hsvSharp, inpaintedBuf, labBufEarly (set to empty — not needed)
 */

import sharp from 'sharp';
import type { PipelineContext } from './wvImportMatchPipeline.js';

// ── Mean-shift parameters ──────────────────────────────────────────
const MS_SP = 20;   // spatial radius (pixels at full resolution)
const MS_SR = 30;   // color radius (Lab Euclidean distance)
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
        // Convergence: shift < 1 in each channel
        if (newL === cL && newA === cA && newB === cB) break;
        cL = newL;
        cA = newA;
        cB = newB;
      }

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
    const stack = [startPix];
    const visited = new Uint8Array(tp);

    while (stack.length > 0) {
      const pix = stack.pop()!;
      if (visited[pix]) continue;
      visited[pix] = 1;

      const idx = pix * 3;
      const dR = buf[idx] - avgR;
      const dG = buf[idx + 1] - avgG;
      const dB = buf[idx + 2] - avgB;
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

  return mask;
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
): Uint8Array {
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

  // Collect edge pixels that look like water (blue/teal hue, decent saturation)
  const waterSeeds: number[] = [];
  // Accumulate reference color from water edge pixels
  let wR = 0, wG = 0, wB = 0, wCount = 0;

  const addEdgePixel = (pix: number) => {
    const h = hsvData[pix * 3];
    const s = hsvData[pix * 3 + 1];
    if (h >= WATER_H_MIN && h <= WATER_H_MAX && s > WATER_S_MIN) {
      waterSeeds.push(pix);
      wR += buf[pix * 3];
      wG += buf[pix * 3 + 1];
      wB += buf[pix * 3 + 2];
      wCount++;
    }
  };

  // Sample 5px bands on all four edges
  for (let x = 0; x < width; x++) {
    for (let band = 0; band < 5; band++) {
      addEdgePixel(band * width + x);           // top edge
      addEdgePixel((height - 1 - band) * width + x); // bottom edge
    }
  }
  for (let y = 0; y < height; y++) {
    for (let band = 0; band < 5; band++) {
      addEdgePixel(y * width + band);            // left edge
      addEdgePixel(y * width + width - 1 - band); // right edge
    }
  }

  if (wCount === 0) return waterMask; // No water detected on edges

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

  return waterMask;
}

/**
 * Also detect gray/unsaturated background: pixels with S < 25 (10% of 255)
 * in HSV are considered gray. Flood fill from corners among gray pixels.
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

  // Mark all low-saturation pixels
  const isGray = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (hsvData[i * 3 + 1] < 25) isGray[i] = 1; // S < ~10%
  }

  // Flood fill from corners, only through gray pixels
  const corners = [
    0,
    width - 1,
    (height - 1) * width,
    (height - 1) * width + width - 1,
  ];

  for (const startPix of corners) {
    if (!isGray[startPix]) continue;
    const stack = [startPix];
    const visited = new Uint8Array(tp);

    while (stack.length > 0) {
      const pix = stack.pop()!;
      if (visited[pix]) continue;
      visited[pix] = 1;
      if (!isGray[pix]) continue;

      mask[pix] = 1;

      const y = Math.floor(pix / width);
      const x = pix % width;
      if (y > 0) stack.push(pix - width);
      if (y < height - 1) stack.push(pix + width);
      if (x > 0) stack.push(pix - 1);
      if (x < width - 1) stack.push(pix + 1);
    }
  }

  return mask;
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

      // Check if any pixel within radius is water
      let nearWater = false;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);

      for (let ny = y0; ny <= y1 && !nearWater; ny++) {
        for (let nx = x0; nx <= x1 && !nearWater; nx++) {
          if (waterMask[ny * width + nx]) nearWater = true;
        }
      }

      if (nearWater) coastal[pix] = 1;
    }
  }

  return coastal;
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

  // --- Step 1: Mean-shift filtering ---
  await logStep(`Mean-shift filtering (sp=${MS_SP}, sr=${MS_SR})...`);
  const filteredBuf = meanShiftFilter(cv, colorBuf, TW, TH, MS_SP, MS_SR);

  // Write filtered result back to colorBuf
  filteredBuf.copy(colorBuf);

  // Debug image: show the mean-shift filtered result
  const filteredPng = await sharp(Buffer.from(colorBuf), {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    'Mean-shift filtered',
    `data:image/png;base64,${filteredPng.toString('base64')}`,
  );

  // --- Step 2: Simple background removal ---
  await logStep('Background removal (flood fill from corners)...');

  // Flood fill from corners using RGB distance
  const bgMaskRgb = floodFillBackground(colorBuf, TW, TH, BG_RGB_DIST);

  // Also detect gray/unsaturated background
  const bgMaskGray = detectGrayBackground(cv, colorBuf, TW, TH);

  // Combine: background = RGB flood fill OR gray flood fill
  const bgMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (bgMaskRgb[i] || bgMaskGray[i]) bgMask[i] = 1;
  }

  // --- Step 3: Simple water detection ---
  await logStep('Water detection (flood fill from edges)...');
  const waterMask = floodFillWater(cv, colorBuf, TW, TH);

  // Debug image: show background + water detection
  const debugBuf = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (bgMask[i]) {
      // Background = light gray
      debugBuf[i * 3] = 200;
      debugBuf[i * 3 + 1] = 200;
      debugBuf[i * 3 + 2] = 200;
    } else if (waterMask[i]) {
      // Water = blue
      debugBuf[i * 3] = 100;
      debugBuf[i * 3 + 1] = 150;
      debugBuf[i * 3 + 2] = 255;
    } else {
      // Foreground = original filtered color
      debugBuf[i * 3] = colorBuf[i * 3];
      debugBuf[i * 3 + 1] = colorBuf[i * 3 + 1];
      debugBuf[i * 3 + 2] = colorBuf[i * 3 + 2];
    }
  }
  const maskPng = await sharp(debugBuf, {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    'Background (gray) + Water (blue) detection',
    `data:image/png;base64,${maskPng.toString('base64')}`,
  );

  // --- Step 4: Build country mask and set ctx fields ---
  const countryMask = new Uint8Array(tp);
  let countrySize = 0;
  for (let i = 0; i < tp; i++) {
    if (!bgMask[i] && !waterMask[i]) {
      countryMask[i] = 1;
      countrySize++;
    }
  }

  // Coastal band: country pixels within 5px of water
  const coastalBand = computeCoastalBand(waterMask, countryMask, TW, TH);

  // Set all ctx fields
  ctx.textExcluded = new Uint8Array(tp); // empty — mean-shift absorbed text
  ctx.waterGrown = waterMask;
  ctx.countryMask = countryMask;
  ctx.countrySize = countrySize;
  ctx.coastalBand = coastalBand;

  // Skip hsvSharp, inpaintedBuf, labBufEarly — not needed for mean-shift path
  ctx.hsvSharp = Buffer.alloc(0);
  ctx.labBufEarly = Buffer.alloc(0);
  ctx.inpaintedBuf = null;
  ctx.hsvBuf = Buffer.alloc(0);

  await logStep(`Mean-shift preprocessing complete — ${countrySize} country pixels (${(countrySize / tp * 100).toFixed(1)}%)`);
}
