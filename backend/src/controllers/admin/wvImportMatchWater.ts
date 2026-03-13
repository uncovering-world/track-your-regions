/**
 * Water detection phase.
 *
 * Multi-signal voting on HSV + adaptive edge sampling to detect water bodies.
 * Connected components with narrow-neck splitting. Interactive review.
 *
 * Sets on ctx: waterGrown
 * Consumes: ctx.inpaintedBuf (set to null when done to free memory)
 */

import sharp from 'sharp';
import { generateOutlineCrop } from './wvImportMatchHelpers.js';
import { pendingWaterReviews, storeWaterCrops, type WaterReviewDecision } from './wvImportMatchReview.js';
import type { PipelineContext } from './wvImportMatchPipeline.js';

export async function detectWater(ctx: PipelineContext): Promise<void> {
  const { cv, TW, TH, tp, oddK, origW, origH, regionId, logStep, pushDebugImage, sendEvent, origDownBuf } = ctx;
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
    // Saturation cap (s < 210): map water is always pastel/soft (S typically 50-180).
    // Deeply saturated pixels (S > 210) are colored land regions, not water — e.g.
    // Morocco's blue coastal strip at S=255 has ocean-like hue but is a land region.
    if (h >= 90 && h <= 120 && s > 40 && s < 210 && v > 90 && b > g + 12) return true;
    if (h >= 80 && h <= 110 && s > 18 && s < 80 && v > 190 && b > r + 15) return true;
    // Tight adaptive supplement — RGB proximity to edge-sampled water color.
    // Catches water with unusual hue (e.g. teal where g > b) that hardcoded HSV tiers miss.
    if (useAdaptiveWater) {
      const dr = r - adaptiveR, dg = g - adaptiveG, db = b - adaptiveB;
      if (dr * dr + dg * dg + db * db <= 35 * 35) return true;
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
    const COLOR_DIST_SQ = 50 * 50;
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

  // Morphological close on water mask to fill small gaps, then keep large regions
  const waterRawMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterRaw);
  const wkSize = oddK(7);
  const waterKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wkSize, wkSize));
  const waterClosedMat = new cv.Mat();
  cv.morphologyEx(waterRawMat, waterClosedMat, cv.MORPH_CLOSE, waterKernel);
  waterRawMat.delete();
  // Connected components: keep water regions (>0.3% of image to catch lakes)
  const waterLabels = new cv.Mat();
  const waterStats = new cv.Mat();
  const waterCents = new cv.Mat();
  const numWaterCC = cv.connectedComponentsWithStats(waterClosedMat, waterLabels, waterStats, waterCents);
  waterClosedMat.delete(); waterCents.delete();
  // Collect water components with bounding boxes, crops, and pre-computed sub-clusters
  interface WaterSubCluster { idx: number; pct: number; cropDataUrl: string }
  interface WaterComponent { id: number; area: number; pct: number; cropDataUrl: string; subClusters: WaterSubCluster[] }
  const waterComponents: WaterComponent[] = [];
  const waterMask = new Uint8Array(tp);
  const minWaterSize = Math.round(tp * 0.003); // 0.3% — catch lakes like Tanganyika, Kivu
  const waterLabelData = waterLabels.data32S;
  // Store sub-cluster centroids for "Mix" response handling
  const compSubCentroids = new Map<number, Array<[number, number, number]>>();

  // --- Split large water blobs at narrow necks ---
  // When a coastal strip connects to the ocean through a narrow bridge,
  // they form one CC. Erode to break the neck, reassign via BFS.
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

  const SPLIT_MIN_AREA = Math.round(tp * 0.05); // only split CCs > 5% of image
  const splitKSize = oddK(10);
  const splitKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(splitKSize, splitKSize));
  let nextWaterLabel = numWaterCC;

  for (let c = 1; c < numWaterCC; c++) {
    const stat = compStats.get(c)!;
    if (stat.area < SPLIT_MIN_AREA) continue;

    // Create binary mask for this CC
    const ccMask = new Uint8Array(tp);
    for (let i = 0; i < tp; i++) {
      if (waterLabelData[i] === c) ccMask[i] = 255;
    }

    // Erode to break narrow necks
    const compMaskMat = cv.matFromArray(TH, TW, cv.CV_8UC1, ccMask);
    const erodedMat = new cv.Mat();
    cv.erode(compMaskMat, erodedMat, splitKernel);
    compMaskMat.delete();

    // CC on eroded mask
    const erodedLabels = new cv.Mat();
    const erodedStats = new cv.Mat();
    const erodedCents = new cv.Mat();
    const numEroded = cv.connectedComponentsWithStats(erodedMat, erodedLabels, erodedStats, erodedCents);
    erodedMat.delete(); erodedCents.delete();

    // Count significant sub-blobs (>1% of original component area)
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

    // Sort by area descending (ocean first, coastal strip second)
    significantSubs.sort((a, b) => b.area - a.area);

    console.log(`  [Water] Splitting CC ${c} (${stat.area}px, ${(stat.area / tp * 100).toFixed(1)}%) into ${significantSubs.length} sub-blobs`);

    // Map eroded sub-labels to new global labels
    const subLabelMap = new Map<number, number>();
    for (const sub of significantSubs) {
      subLabelMap.set(sub.eLabel, nextWaterLabel++);
    }

    // Seed BFS: pixels in both original CC and an eroded sub-blob get new label
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

    // BFS outward (8-connectivity to match CC): assign remaining pixels to nearest sub-blob
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
          if (waterLabelData[ni] !== c) continue; // not this CC or already assigned
          waterLabelData[ni] = label;
          bfsQueue.push(ni);
        }
      }
    }

    // Compute stats for new sub-labels
    for (const [eLabel, newLabel] of subLabelMap) {
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
        console.log(`    sub-blob ${eLabel} → label ${newLabel}: ${subArea}px (${(subArea / tp * 100).toFixed(1)}%) bbox ${maxX - minX + 1}×${maxY - minY + 1}`);
      }
    }

    // Remove original label (it's been split)
    compStats.delete(c);

    erodedLabels.delete(); erodedStats.delete();
  }
  splitKernel.delete();

  for (const [c, stat] of compStats) {
    const { area } = stat;
    if (area < minWaterSize) continue;
    const bw = stat.width;
    const bh = stat.height;
    const aspect = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
    const solidity = area / Math.max(1, bw * bh);
    if (aspect > 4 && solidity < 0.3) continue; // elongated + sparse = river

    // Mark this component in the mask
    for (let i = 0; i < tp; i++) {
      if (waterLabelData[i] === c) waterMask[i] = 1;
    }

    const cx = stat.left;
    const cy = stat.top;

    // Generate main crop
    let mainCrop: string | undefined;
    try {
      mainCrop = (await generateOutlineCrop(origDownBuf, TW, TH, si => waterLabelData[si] === c, cx, cy, bw, bh)) ?? undefined;
    } catch { /* skip */ }
    if (!mainCrop) continue;

    // K=2 sub-clustering on component pixels (for "Mix" option)
    const compPx: Array<[number, number, number, number]> = []; // [r, g, b, pixelIndex]
    for (let y = cy; y < cy + bh && y < TH; y++) {
      for (let x = cx; x < cx + bw && x < TW; x++) {
        const si = y * TW + x;
        if (waterLabelData[si] === c) {
          compPx.push([inpaintedBuf[si * 3], inpaintedBuf[si * 3 + 1], inpaintedBuf[si * 3 + 2], si]);
        }
      }
    }

    const subClusters: WaterSubCluster[] = [];
    if (compPx.length > 20) {
      // Farthest-point K=2 init
      const cents: Array<[number, number, number]> = [[compPx[0][0], compPx[0][1], compPx[0][2]]];
      let maxD = 0, bestI = 0;
      for (let i = 1; i < compPx.length; i++) {
        const d = (compPx[i][0] - cents[0][0]) ** 2 + (compPx[i][1] - cents[0][1]) ** 2 + (compPx[i][2] - cents[0][2]) ** 2;
        if (d > maxD) { maxD = d; bestI = i; }
      }
      cents.push([compPx[bestI][0], compPx[bestI][1], compPx[bestI][2]]);

      // K-means iterations
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

      // Generate sub-cluster crops with distinct outline colors
      const subPixelSets = [new Set<number>(), new Set<number>()];
      const subAreas = [0, 0];
      for (let i = 0; i < compPx.length; i++) {
        subPixelSets[assignments[i]].add(compPx[i][3]);
        subAreas[assignments[i]]++;
      }
      // Compute bounding box per sub-cluster
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
            subClusters.push({
              idx: k,
              pct: Math.round(subAreas[k] / tp * 1000) / 10,
              cropDataUrl: subCrop,
            });
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
  // Save split-aware labels before deleting Mats (needed for rebuild after review)
  const savedWaterLabels = new Int32Array(waterLabelData);
  waterLabels.delete(); waterStats.delete();

  console.log(`  [Water] ${waterComponents.length} component(s) after CC filter (from ${numWaterCC - 1} raw)`);

  // Dilate water mask with elliptical kernel for safety margin
  const waterMaskMat = cv.matFromArray(TH, TW, cv.CV_8UC1, waterMask);
  const wdSize = oddK(5);
  const waterDilateKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(wdSize, wdSize));
  const waterGrownMat = new cv.Mat();
  cv.dilate(waterMaskMat, waterGrownMat, waterDilateKernel);
  const waterGrown = new Uint8Array(waterGrownMat.data);
  waterMaskMat.delete(); waterGrownMat.delete(); waterKernel.delete(); waterDilateKernel.delete();

  // Debug: water mask overlay on original image
  const waterVizBuf = Buffer.from(inpaintedBuf);
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

  // Interactive per-component water review
  if (waterComponents.length > 0) {
    const reviewId = `wr-${regionId}-${Date.now()}`;
    // Store crop images in memory — served via GET endpoint (avoids SSE stalling)
    storeWaterCrops(reviewId, waterComponents);
    const cropCount = waterComponents.reduce((n, wc) => n + 1 + wc.subClusters.length, 0);
    console.log(`  [Water] Stored ${cropCount} crop(s) for review ${reviewId}`);
    // Lightweight SSE event — no images, just metadata + reviewId
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

    // Wait for user response: approved IDs + mix decisions
    // The POST endpoint calls resolveWaterReview() which resolves this promise.
    // Only auto-resolve on timeout (5 min); do NOT auto-resolve on req.close
    // because the SSE connection may drop transiently while the user is deciding.
    const decision = await new Promise<WaterReviewDecision>((resolve) => {
      pendingWaterReviews.set(reviewId, resolve);
      setTimeout(() => {
        if (pendingWaterReviews.has(reviewId)) {
          console.log(`  [Water] Review ${reviewId} timed out — auto-approving all`);
          pendingWaterReviews.delete(reviewId);
          resolve({ approvedIds: waterComponents.map(wc => wc.id), mixDecisions: [] });
        }
      }, 300000);
    });

    // Check if any components were rejected or mixed
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

      // Use saved split-aware labels (includes blob-split sub-labels)
      waterMask.fill(0);
      for (let i = 0; i < tp; i++) {
        const label = savedWaterLabels[i];
        if (label <= 0) continue;
        if (!compStats.has(label)) continue; // filtered out (too small, river-like)

        if (approvedSet.has(label)) {
          waterMask[i] = 1; // Fully approved
        } else if (mixMap.has(label)) {
          // Mix: keep only approved sub-clusters
          const approvedSubs = mixMap.get(label)!;
          const cents = compSubCentroids.get(label);
          if (cents) {
            const r = inpaintedBuf[i * 3], g = inpaintedBuf[i * 3 + 1], b = inpaintedBuf[i * 3 + 2];
            const d0 = (r - cents[0][0]) ** 2 + (g - cents[0][1]) ** 2 + (b - cents[0][2]) ** 2;
            const d1 = (r - cents[1][0]) ** 2 + (g - cents[1][1]) ** 2 + (b - cents[1][2]) ** 2;
            const nearest = d0 <= d1 ? 0 : 1;
            if (approvedSubs.has(nearest)) waterMask[i] = 1;
          }
        }
        // Else: rejected — waterMask stays 0
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
      const viz = Buffer.from(inpaintedBuf);
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

  // Publish results to context
  ctx.waterGrown = waterGrown;
  // Free inpainted buffer — no longer needed after water detection
  ctx.inpaintedBuf = null;
}
