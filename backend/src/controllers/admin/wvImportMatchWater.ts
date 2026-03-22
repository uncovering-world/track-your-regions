/**
 * Water detection phase.
 *
 * Multi-signal voting on HSV + adaptive edge sampling to detect water bodies.
 * Connected components with narrow-neck splitting. Interactive review.
 *
 * Sets on ctx: waterGrown
 * Consumes: ctx.inpaintedBuf (set to null when done to free memory)
 */

import { reviewAndFinalizeWater } from './wvImportMatchHelpers.js';
import type { PipelineContext } from './wvImportMatchPipeline.js';

export async function detectWater(ctx: PipelineContext): Promise<void> {
  const { cv, TW, TH, tp, logStep, origDownBuf } = ctx;
  const inpaintedBuf = ctx.inpaintedBuf!;

  // --- Step B: Detect water on CLEAN inpainted image (sharp, no blur yet) ---
  // Running after text removal so blue text labels don't get detected as water
  await logStep('Detecting water (on clean sharp image, after text removal)...');
  const cvInpaintedForHsv = new cv.Mat(TH, TW, cv.CV_8UC3);
  cvInpaintedForHsv.data.set(inpaintedBuf);
  const cvHsvClean = new cv.Mat();
  cv.cvtColor(cvInpaintedForHsv, cvHsvClean, cv.COLOR_RGB2HSV);
  cvInpaintedForHsv.delete();
  const hsvClean = Buffer.from(cvHsvClean.data);
  cvHsvClean.delete();

  // Adaptive water thresholds: sample edge pixels to find actual water color
  const edgeHsvSamples: Array<[number, number, number]> = [];
  const edgeRgbSamples: Array<[number, number, number]> = [];
  for (let x = 0; x < TW; x++) {
    for (let band = 0; band < 5; band++) {
      for (const idx of [band * TW + x, (TH - 1 - band) * TW + x]) {
        const h = hsvClean[idx * 3], s = hsvClean[idx * 3 + 1], v = hsvClean[idx * 3 + 2];
        if (h >= 70 && h <= 140 && s > 8) {
          edgeHsvSamples.push([h, s, v]);
          edgeRgbSamples.push([inpaintedBuf[idx * 3], inpaintedBuf[idx * 3 + 1], inpaintedBuf[idx * 3 + 2]]);
        }
      }
    }
  }
  for (let y = 0; y < TH; y++) {
    for (let band = 0; band < 5; band++) {
      for (const idx of [y * TW + band, y * TW + TW - 1 - band]) {
        const h = hsvClean[idx * 3], s = hsvClean[idx * 3 + 1], v = hsvClean[idx * 3 + 2];
        if (h >= 70 && h <= 140 && s > 8) {
          edgeHsvSamples.push([h, s, v]);
          edgeRgbSamples.push([inpaintedBuf[idx * 3], inpaintedBuf[idx * 3 + 1], inpaintedBuf[idx * 3 + 2]]);
        }
      }
    }
  }
  const totalEdgePx = (TW + TH) * 2 * 5;
  const useAdaptiveWater = edgeHsvSamples.length > totalEdgePx * 0.03;
  let adaptiveH = 0, adaptiveS = 0, adaptiveV = 0;
  let adaptiveR = 0, adaptiveG = 0, adaptiveB = 0;
  if (useAdaptiveWater) {
    edgeHsvSamples.sort((a, b) => a[0] - b[0]);
    adaptiveH = edgeHsvSamples[Math.floor(edgeHsvSamples.length / 2)][0];
    edgeHsvSamples.sort((a, b) => a[1] - b[1]);
    adaptiveS = edgeHsvSamples[Math.floor(edgeHsvSamples.length / 2)][1];
    edgeHsvSamples.sort((a, b) => a[2] - b[2]);
    adaptiveV = edgeHsvSamples[Math.floor(edgeHsvSamples.length / 2)][2];
    // Median RGB of edge water (for RGB-proximity supplement)
    edgeRgbSamples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const mid = edgeRgbSamples[Math.floor(edgeRgbSamples.length / 2)];
    adaptiveR = mid[0]; adaptiveG = mid[1]; adaptiveB = mid[2];
    console.log(`  [Water] Adaptive: ${edgeHsvSamples.length} edge samples (${(edgeHsvSamples.length / totalEdgePx * 100).toFixed(1)}%), median HSV=(${adaptiveH},${adaptiveS},${adaptiveV}), median RGB=(${adaptiveR},${adaptiveG},${adaptiveB})`);
  }

  // ── Multi-signal water detection with voting ──
  // Three independent signals vote on each pixel. A pixel is water if ≥2 agree.
  // This handles boundary blur (median + inpainting smears water↔land edges) and
  // text within water (dark text fails on original but inpainted to blue).
  //
  // Signal A: HSV thresholds on inpainted image (text removed → clean inside water)
  // Signal B: HSV thresholds on original image (sharp boundaries, text still present)
  // Signal C: Color proximity to known-water centroid (fills text gaps by color)

  // Helper: does pixel pass water tier thresholds?
  // Always use hardcoded tiers (reliable for standard Wikivoyage blue/teal water).
  // When edge water sampling found water, supplement with a tight adaptive tier
  // that only catches vivid pixels very close to the sampled water color.
  const passesWaterTier = (h: number, s: number, v: number, r: number, g: number, b: number): boolean => {
    // Hardcoded tiers — always active.
    // Saturation floor (s > 40/50): ocean is moderately saturated (S typically 80-180 on 0-255).
    // Desaturated coastal land (S 20-50) has ocean-like hue but is NOT water.
    // Saturation cap (s < 210): deeply saturated pixels are colored land regions.
    if (h >= 90 && h <= 120 && s > 40 && s < 210 && v > 90 && b > g + 12) return true;
    if (h >= 80 && h <= 110 && s > 50 && s < 80 && v > 190 && b > r + 15) return true;
    // Tight adaptive supplement — RGB proximity to edge-sampled water color.
    // Catches water with unusual hue (e.g. teal where g > b) that hardcoded HSV tiers miss.
    if (useAdaptiveWater) {
      const dr = r - adaptiveR, dg = g - adaptiveG, db = b - adaptiveB;
      if (dr * dr + dg * dg + db * db <= 20 * 20) return true;
    }
    return false;
  };

  // Signal A: on inpainted (text-free) image
  const voteA = new Uint8Array(tp);
  let countA = 0;
  for (let i = 0; i < tp; i++) {
    if (passesWaterTier(hsvClean[i * 3], hsvClean[i * 3 + 1], hsvClean[i * 3 + 2],
        inpaintedBuf[i * 3], inpaintedBuf[i * 3 + 1], inpaintedBuf[i * 3 + 2])) {
      voteA[i] = 1; countA++;
    }
  }

  // Signal B: on original (unprocessed) image — sharp region boundaries
  const cvOrigForWater = new cv.Mat(TH, TW, cv.CV_8UC3);
  cvOrigForWater.data.set(origDownBuf);
  const cvHsvOrig = new cv.Mat();
  cv.cvtColor(cvOrigForWater, cvHsvOrig, cv.COLOR_RGB2HSV);
  const hsvOrig = Buffer.from(cvHsvOrig.data);
  cvOrigForWater.delete(); cvHsvOrig.delete();

  const voteB = new Uint8Array(tp);
  let countB = 0;
  for (let i = 0; i < tp; i++) {
    if (passesWaterTier(hsvOrig[i * 3], hsvOrig[i * 3 + 1], hsvOrig[i * 3 + 2],
        origDownBuf[i * 3], origDownBuf[i * 3 + 1], origDownBuf[i * 3 + 2])) {
      voteB[i] = 1; countB++;
    }
  }

  // Seeds = A ∩ B (high-confidence water — both images agree)
  let seedR = 0, seedG = 0, seedB = 0, seedCnt = 0;
  for (let i = 0; i < tp; i++) {
    if (voteA[i] && voteB[i]) {
      seedR += inpaintedBuf[i * 3];
      seedG += inpaintedBuf[i * 3 + 1];
      seedB += inpaintedBuf[i * 3 + 2];
      seedCnt++;
    }
  }

  // Signal C: color proximity to water centroid on inpainted image
  // Fills text gaps (inpainted text → similar blue → close to centroid)
  // Rejects different-colored land (violet, green → far from centroid)
  const voteC = new Uint8Array(tp);
  let countC = 0;
  if (seedCnt > 0) {
    const avgR = seedR / seedCnt, avgG = seedG / seedCnt, avgB = seedB / seedCnt;
    const COLOR_DIST_SQ = 30 * 30; // tightened from 50 — coastal land at distance 50-90 was being caught
    for (let i = 0; i < tp; i++) {
      const dr = inpaintedBuf[i * 3] - avgR;
      const dg = inpaintedBuf[i * 3 + 1] - avgG;
      const db = inpaintedBuf[i * 3 + 2] - avgB;
      if (dr * dr + dg * dg + db * db <= COLOR_DIST_SQ) { voteC[i] = 1; countC++; }
    }
  }

  // Final water = ≥2 votes agree
  const waterRaw = new Uint8Array(tp);
  let waterRawCount = 0;
  for (let i = 0; i < tp; i++) {
    if (voteA[i] + voteB[i] + voteC[i] >= 2) { waterRaw[i] = 255; waterRawCount++; }
  }
  console.log(`  [Water] Voting: A=${countA} B=${countB} C=${countC} seeds(A∩B)=${seedCnt} → final=${waterRawCount} (${(waterRawCount / tp * 100).toFixed(1)}%)`);

  // Convert 0/255 voting output to 0/1 binary mask
  const waterMaskBinary = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (waterRaw[i]) waterMaskBinary[i] = 1;
  }

  // Delegate CC analysis, review, and finalization to shared function
  ctx.waterGrown = await reviewAndFinalizeWater(waterMaskBinary, inpaintedBuf, ctx);
  // Free inpainted buffer — no longer needed after water detection
  ctx.inpaintedBuf = null;
}
