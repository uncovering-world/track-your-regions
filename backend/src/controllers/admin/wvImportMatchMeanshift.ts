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
import type { PipelineContext } from './wvImportMatchPipeline.js';

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

  // Mark ALL low-saturation pixels as background.
  // On WV maps, gray is ALWAYS background — never a region fill (fills have S≥15%).
  // No flood fill needed — this catches gray "islands" like the Strait of Gibraltar
  // that are surrounded by colored regions and unreachable from corners.
  for (let i = 0; i < tp; i++) {
    if (hsvData[i * 3 + 1] < 25) mask[i] = 1; // S < ~10%
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

  // --- Step 0: Gentle road pixel replacement ---
  // Detect vivid red/yellow/blue thin-line pixels by HSL, replace each with
  // the average of its non-road 4-neighbors. Unlike removeColoredLines (which
  // uses 8px median and destroys boundaries), this is a 1-pixel replacement.
  {
    const roadMask = new Uint8Array(tp);
    for (let i = 0; i < tp; i++) {
      const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b = colorBuf[i * 3 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const d = mx - mn;
      if (d < 30) continue; // not saturated enough to be a road
      const s = mx > 0 ? d / mx : 0;
      if (s < 0.3) continue;
      let h = 0;
      if (mx === r) h = ((g - b) / d) * 60;
      else if (mx === g) h = ((b - r) / d) * 60 + 120;
      else h = ((r - g) / d) * 60 + 240;
      if (h < 0) h += 360;
      // Red roads: H 0-25 or 335-360
      // Yellow roads: H 40-70
      // Blue rivers: H 170-270
      if ((h <= 25 || h >= 335) || (h >= 40 && h <= 70) || (h >= 170 && h <= 270)) {
        roadMask[i] = 1;
      }
    }
    // Replace road pixels with average of non-road 4-neighbors
    let replaced = 0;
    for (let i = 0; i < tp; i++) {
      if (!roadMask[i]) continue;
      let sumR = 0, sumG = 0, sumB = 0, cnt = 0;
      for (const n of [i - 1, i + 1, i - TW, i + TW]) {
        if (n >= 0 && n < tp && !roadMask[n]) {
          sumR += colorBuf[n * 3]; sumG += colorBuf[n * 3 + 1]; sumB += colorBuf[n * 3 + 2];
          cnt++;
        }
      }
      if (cnt > 0) {
        colorBuf[i * 3] = Math.round(sumR / cnt);
        colorBuf[i * 3 + 1] = Math.round(sumG / cnt);
        colorBuf[i * 3 + 2] = Math.round(sumB / cnt);
        replaced++;
      }
    }
    if (replaced > 0) console.log(`  [MS] Gentle road replacement: ${replaced} pixels`);
  }

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
  // Use the ORIGINAL image for background detection (same reasoning as water):
  // mean-shift desaturates borderline pixels, pushing land colors below S<25
  // and causing them to be falsely classified as gray background.
  await logStep('Background removal (flood fill from corners)...');

  // Flood fill from corners using RGB distance
  const bgMaskRgb = floodFillBackground(Buffer.from(ctx.origDownBuf), TW, TH, BG_RGB_DIST);

  // Also detect gray/unsaturated background
  const bgMaskGrayRaw = detectGrayBackground(cv, Buffer.from(ctx.origDownBuf), TW, TH);

  // Morphological opening on gray mask: removes thin features (1-3px border lines,
  // admin boundaries) that have low saturation but aren't background. Without this,
  // border lines at narrow map corridors break the country mask CC connectivity,
  // causing foreign land removal to drop entire protrusions (e.g. Xinjiang's west).
  const openKSize = ctx.oddK(5);
  const grayMat = cv.matFromArray(TH, TW, cv.CV_8UC1,
    Uint8Array.from(bgMaskGrayRaw, (v: number) => v ? 255 : 0));
  const openKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(openKSize, openKSize));
  const grayOpened = new cv.Mat();
  cv.morphologyEx(grayMat, grayOpened, cv.MORPH_OPEN, openKernel);
  const bgMaskGray = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) bgMaskGray[i] = grayOpened.data[i] ? 1 : 0;
  grayMat.delete(); openKernel.delete(); grayOpened.delete();

  const grayRawCount = bgMaskGrayRaw.reduce((s: number, v: number) => s + v, 0);
  const grayOpenCount = bgMaskGray.reduce((s: number, v: number) => s + v, 0);
  if (grayRawCount !== grayOpenCount) {
    console.log(`  [MS] Gray bg opening: ${grayRawCount} → ${grayOpenCount} px (removed ${grayRawCount - grayOpenCount} thin features)`);
  }

  // Combine: background = RGB flood fill OR gray flood fill (opened)
  const bgMask = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (bgMaskRgb[i] || bgMaskGray[i]) bgMask[i] = 1;
  }

  // --- Step 3: Water detection (coastal + inland) ---
  // Use the ORIGINAL image for water detection, not the mean-shift filtered one.
  // Mean-shift blurs low-saturation water pixels into surrounding land colors,
  // shifting the reference color and causing flood fill to bleed (e.g. Niger: 233x
  // more false water on filtered vs original). The original preserves sharp
  // color boundaries between water and land.
  await logStep('Water detection (flood fill from edges + inland lakes)...');
  const { mask: waterMask, refColor: waterRefColor } = floodFillWater(cv, Buffer.from(ctx.origDownBuf), TW, TH);

  // Detect inland water bodies: find large connected components of pixels
  // that look like the detected sea color (e.g. Chott el Jerid in Tunisia).
  // Uses RGB distance to the sea reference color — much more specific than HSV
  // hue range, which would false-positive on green-ish map regions.
  const origBuf = ctx.origDownBuf;
  if (waterRefColor) {
    const [wR, wG, wB] = waterRefColor;
    // Tighter threshold than coastal flood-fill — inland lakes must closely match sea color
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

    // Find connected components; mark large ones as inland water
    const visited = new Uint8Array(tp);
    const minLakeSize = Math.max(100, Math.round(tp * 0.005)); // ≥0.5% of image area
    let inlandCount = 0;

    for (let seed = 0; seed < tp; seed++) {
      if (!waterLike[seed] || visited[seed]) continue;

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
        if (x < TW - 1) stack.push(pix + 1);
      }

      if (component.length >= minLakeSize) {
        for (const pix of component) waterMask[pix] = 1;
        inlandCount += component.length;
      }
    }

    if (inlandCount > 0) {
      console.log(`  [MS] Inland water detection: ${inlandCount} pixels (ref color rgb(${wR},${wG},${wB}))`);
    }
  }

  // Debug image: show background + water detection (before review)
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

  // --- Step 4: Interactive water review (shared with classical pipeline) ---
  // CC analysis, narrow-neck splitting, crop generation, user review, mask rebuild
  const waterGrown = await reviewAndFinalizeWater(waterMask, colorBuf, ctx);

  // --- Step 5: Build country mask ---
  const countryMask = new Uint8Array(tp);
  let countrySize = 0;
  for (let i = 0; i < tp; i++) {
    if (!bgMask[i] && !waterGrown[i]) {
      countryMask[i] = 1;
      countrySize++;
    }
  }

  // --- Step 6: Foreign land removal ---
  {
    const cmMat = cv.matFromArray(TH, TW, cv.CV_8UC1, countryMask);
    const ccLabels = new cv.Mat();
    const ccStats = new cv.Mat();
    const ccCents = new cv.Mat();
    const numCC = cv.connectedComponentsWithStats(cmMat, ccLabels, ccStats, ccCents);
    cmMat.delete(); ccCents.delete();

    if (numCC > 2) {
      let mainCC = 1, mainSize = 0;
      for (let c = 1; c < numCC; c++) {
        const area = ccStats.intAt(c, cv.CC_STAT_AREA);
        if (area > mainSize) { mainSize = area; mainCC = c; }
      }

      const ccData = ccLabels.data32S;
      let foreignRemoved = 0;
      for (let c = 1; c < numCC; c++) {
        if (c === mainCC) continue;
        const area = ccStats.intAt(c, cv.CC_STAT_AREA);
        if (area > mainSize * 0.15) continue;
        for (let i = 0; i < tp; i++) {
          if (ccData[i] === c) {
            countryMask[i] = 0;
            countrySize--;
            foreignRemoved++;
          }
        }
      }
      if (foreignRemoved > 0) {
        console.log(`  [MS] Foreign land removal: removed ${foreignRemoved} pixels (kept main CC + exclaves >15%)`);
      }
    }
    ccLabels.delete(); ccStats.delete();
  }

  // Debug image: country mask after foreign land removal (diagnoses lost regions)
  {
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
