import sharp from 'sharp';
import { cvMorphOp } from './wvImportMatchHelpers.js';
import type { PipelineContext } from './wvImportMatchPipeline.js';

/**
 * Background/foreground detection phase.
 *
 * Detects background via edge K-means, builds foreground mask, extracts country
 * silhouette via connected components, removes foreign land, applies saturation
 * refinement. Also computes hsvBuf and coastalBand.
 *
 * Sets on ctx: countryMask, countrySize, coastalBand, hsvBuf
 */
export async function detectBackground(ctx: PipelineContext): Promise<void> {
  const {
    cv, TW, TH, tp, origW, origH,
    oddK, pxS,
    colorBuf, waterGrown, textExcluded, labBufEarly,
    logStep, pushDebugImage,
  } = ctx;

  // --- Step C: colorBuf is the single clean buffer for all downstream processing ---
  // Pipeline: origDownBuf (no spatial filter) → line removal. No text removal from colorBuf.
  // Text pixels are handled via textExcluded (K-means exclusion + forced foreground).
  // No bilateral/median/mean-shift = zero cross-boundary contamination.
  // Used for: foreground detection, park detection, K-means, debug visualization.
  // Debug: show clean colorBuf (text NOT removed — excluded from K-means instead)
  const colorBufPng = await sharp(Buffer.from(colorBuf), {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    '🔴 Clean image (no text removal, no spatial filter — text excluded from K-means)',
    `data:image/png;base64,${colorBufPng.toString('base64')}`,
  );

  // HSV of the clean image for foreground detection
  const cvBufFinal = new cv.Mat(TH, TW, cv.CV_8UC3);
  cvBufFinal.data.set(colorBuf);
  const cvHsvFinal = new cv.Mat();
  cv.cvtColor(cvBufFinal, cvHsvFinal, cv.COLOR_RGB2HSV);
  const hsvBuf = Buffer.from(cvHsvFinal.data);
  cvBufFinal.delete(); cvHsvFinal.delete();

  await logStep('Background detection + foreground mask...');

  // Detect background colors via K-means on 5px-band image edge pixels
  const edgePx: Array<[number, number, number]> = [];
  for (let x = 0; x < TW; x++) {
    for (let band = 0; band < 5; band++) {
      const tIdx = (band * TW + x) * 3;
      const bIdx = ((TH - 1 - band) * TW + x) * 3;
      edgePx.push([colorBuf[tIdx], colorBuf[tIdx + 1], colorBuf[tIdx + 2]]);
      edgePx.push([colorBuf[bIdx], colorBuf[bIdx + 1], colorBuf[bIdx + 2]]);
    }
  }
  for (let y = 0; y < TH; y++) {
    for (let band = 0; band < 5; band++) {
      const lIdx = (y * TW + band) * 3;
      const rIdx = (y * TW + TW - 1 - band) * 3;
      edgePx.push([colorBuf[lIdx], colorBuf[lIdx + 1], colorBuf[lIdx + 2]]);
      edgePx.push([colorBuf[rIdx], colorBuf[rIdx + 1], colorBuf[rIdx + 2]]);
    }
  }

  // K-means (K=3) on edge pixels with farthest-point initialization
  const BK = 3;
  const bgCentroids: Array<[number, number, number]> = [edgePx[0]];
  for (let c = 1; c < BK; c++) {
    let maxDist = 0, bestIdx = 0;
    for (let i = 0; i < edgePx.length; i++) {
      let minDist = Infinity;
      for (const ct of bgCentroids) {
        const d = (edgePx[i][0] - ct[0]) ** 2 + (edgePx[i][1] - ct[1]) ** 2 + (edgePx[i][2] - ct[2]) ** 2;
        if (d < minDist) minDist = d;
      }
      if (minDist > maxDist) { maxDist = minDist; bestIdx = i; }
    }
    bgCentroids.push([...edgePx[bestIdx]]);
  }
  for (let iter = 0; iter < 20; iter++) {
    const sums = bgCentroids.map(() => [0, 0, 0, 0]);
    for (const px of edgePx) {
      let bestDist = Infinity, bestK = 0;
      for (let k = 0; k < BK; k++) {
        const d = (px[0] - bgCentroids[k][0]) ** 2 + (px[1] - bgCentroids[k][1]) ** 2 + (px[2] - bgCentroids[k][2]) ** 2;
        if (d < bestDist) { bestDist = d; bestK = k; }
      }
      sums[bestK][0] += px[0]; sums[bestK][1] += px[1]; sums[bestK][2] += px[2]; sums[bestK][3]++;
    }
    for (let k = 0; k < BK; k++) {
      if (sums[k][3] > 0) {
        bgCentroids[k] = [
          Math.round(sums[k][0] / sums[k][3]),
          Math.round(sums[k][1] / sums[k][3]),
          Math.round(sums[k][2] / sums[k][3]),
        ];
      }
    }
  }

  // Active background = edge clusters with >10% of edge pixels
  const bgCnts = new Array(BK).fill(0);
  for (const px of edgePx) {
    let bestDist = Infinity, bestK = 0;
    for (let k = 0; k < BK; k++) {
      const d = (px[0] - bgCentroids[k][0]) ** 2 + (px[1] - bgCentroids[k][1]) ** 2 + (px[2] - bgCentroids[k][2]) ** 2;
      if (d < bestDist) { bestDist = d; bestK = k; }
    }
    bgCnts[bestK]++;
  }
  const activeBg: Array<[number, number, number]> = [];
  for (let k = 0; k < BK; k++) {
    if (bgCnts[k] / edgePx.length > 0.10) activeBg.push(bgCentroids[k]);
  }

  // Convert active BG centroids to Lab for chrominance-weighted distance
  const activeBgLab: Array<[number, number, number]> = activeBg.map(bg => {
    const px = new cv.Mat(1, 1, cv.CV_8UC3);
    px.data[0] = bg[0]; px.data[1] = bg[1]; px.data[2] = bg[2];
    const lab = new cv.Mat();
    cv.cvtColor(px, lab, cv.COLOR_RGB2Lab);
    const result: [number, number, number] = [lab.data[0], lab.data[1], lab.data[2]];
    px.delete(); lab.delete();
    return result;
  });

  // ── Coastal band: the water detector found the coastline with a fine border.
  // Pixels adjacent to detected water on the land side are guaranteed foreground —
  // use this to protect thin coastal strips from being erased by bg detection.
  const COAST_BAND_R = pxS(5);
  const coastalBand = new Uint8Array(tp);
  let coastalCount = 0;
  for (let i = 0; i < tp; i++) {
    if (!waterGrown[i]) continue;
    const wx = i % TW, wy = Math.floor(i / TW);
    for (let dy = -COAST_BAND_R; dy <= COAST_BAND_R; dy++) {
      for (let dx = -COAST_BAND_R; dx <= COAST_BAND_R; dx++) {
        if (dx * dx + dy * dy > COAST_BAND_R * COAST_BAND_R) continue;
        const nx = wx + dx, ny = wy + dy;
        if (nx < 0 || nx >= TW || ny < 0 || ny >= TH) continue;
        const ni = ny * TW + nx;
        if (!waterGrown[ni] && !coastalBand[ni]) { coastalBand[ni] = 1; coastalCount++; }
      }
    }
  }
  console.log(`  [FG] Coastal band: ${coastalCount} pixels marked as guaranteed foreground (within ${COAST_BAND_R}px of water)`);

  // Foreground mask: pixel is foreground if it's far from background AND has saturation.
  // Three additional forced-foreground signals prevent thin strips from disappearing:
  //  1. textExcluded: text was detected there → on top of the map region, not background
  //  2. coastalBand: adjacent to detected water → land side of coastline
  const fgMask = new Uint8Array(tp);
  const BG_DE_SQ = 12 * 12; // Chrominance-weighted Lab ΔE² threshold
  const MIN_FG_SAT = 25;
  for (let i = 0; i < tp; i++) {
    if (waterGrown[i]) continue;
    if (textExcluded[i] || coastalBand[i]) { fgMask[i] = 1; continue; }
    const sat = hsvBuf[i * 3 + 1];
    let isBg = false;
    const pL = labBufEarly[i * 3], pA = labBufEarly[i * 3 + 1], pB = labBufEarly[i * 3 + 2];
    for (const bg of activeBgLab) {
      const dL = (pL - bg[0]) * 0.5; // de-weight luminance
      const dA = pA - bg[1];
      const dB = pB - bg[2];
      if (dL * dL + dA * dA + dB * dB <= BG_DE_SQ) { isBg = true; break; }
    }
    if (!isBg || sat > MIN_FG_SAT) fgMask[i] = 1;
  }

  // Smooth the binary mask with Gaussian blur + re-threshold.
  // This removes noisy spikes from colored lines in the gray background area,
  // filling small gaps and smoothing the boundary before morphological close.
  const fgMat = cv.matFromArray(TH, TW, cv.CV_8UC1, fgMask);
  // Scale to 0-255 for blur
  for (let i = 0; i < tp; i++) fgMat.data[i] = fgMat.data[i] ? 255 : 0;
  const fgBlurred = new cv.Mat();
  const gbSize = oddK(15);
  cv.GaussianBlur(fgMat, fgBlurred, new cv.Size(gbSize, gbSize), 0);
  const fgSmoothed = new cv.Mat();
  cv.threshold(fgBlurred, fgSmoothed, 128, 1, cv.THRESH_BINARY);
  const smoothedFg = new Uint8Array(fgSmoothed.data);
  fgMat.delete(); fgBlurred.delete(); fgSmoothed.delete();

  // Close: fills gaps from region borders (scales with resolution).
  // Reduced from oddK(31)→oddK(15) to stop bridging gaps to neighboring countries
  // (e.g., Morocco→Western Sahara, Morocco→Algeria). Internal region boundaries
  // are 5-10px gaps, well within 24px close range.
  const closed = cvMorphOp(cv, smoothedFg, TW, TH, cv.MORPH_CLOSE, oddK(15));

  await logStep('Connected components + country silhouette...');
  // Connected components via OpenCV (8-connectivity, faster than manual BFS)
  const closedMat = cv.matFromArray(TH, TW, cv.CV_8UC1, closed);
  const ccLabelsMat = new cv.Mat();
  const ccStats = new cv.Mat();
  const ccCents = new cv.Mat();
  const numCC = cv.connectedComponentsWithStats(closedMat, ccLabelsMat, ccStats, ccCents);
  closedMat.delete(); ccCents.delete();
  const ccLabels = ccLabelsMat.data32S; // Int32Array view

  // Prefer largest component that doesn't touch image border (country surrounded by bg)
  const touchesBorder = new Set<number>();
  for (let x = 0; x < TW; x++) {
    if (ccLabels[x] > 0) touchesBorder.add(ccLabels[x]);
    if (ccLabels[(TH - 1) * TW + x] > 0) touchesBorder.add(ccLabels[(TH - 1) * TW + x]);
  }
  for (let y = 0; y < TH; y++) {
    if (ccLabels[y * TW] > 0) touchesBorder.add(ccLabels[y * TW]);
    if (ccLabels[y * TW + TW - 1] > 0) touchesBorder.add(ccLabels[y * TW + TW - 1]);
  }
  // Build sorted list of components by area (skip label 0 = background)
  const componentSizes: Array<{ id: number; size: number }> = [];
  for (let c = 1; c < numCC; c++) {
    componentSizes.push({ id: c, size: ccStats.intAt(c, cv.CC_STAT_AREA) });
  }
  componentSizes.sort((a, b) => b.size - a.size);
  let countryComp = componentSizes.length > 0 ? componentSizes[0].id : 0;
  for (const c of componentSizes) {
    if (!touchesBorder.has(c.id) && c.size > tp * 0.10) { countryComp = c.id; break; }
  }
  if (componentSizes.length > 0 && ccStats.intAt(countryComp, cv.CC_STAT_AREA) < tp * 0.10) {
    countryComp = componentSizes[0].id;
  }
  ccStats.delete();

  // Fill interior holes (flood from image border, anything not reached = country)
  const outerMask = new Uint8Array(tp);
  const borderQueue: number[] = [];
  for (let x = 0; x < TW; x++) { borderQueue.push(x); borderQueue.push((TH - 1) * TW + x); }
  for (let y = 0; y < TH; y++) { borderQueue.push(y * TW); borderQueue.push(y * TW + TW - 1); }
  for (const p of borderQueue) outerMask[p] = 1;
  let bHead = 0;
  while (bHead < borderQueue.length) {
    const p = borderQueue[bHead++];
    for (const n of [p - TW, p + TW, p - 1, p + 1]) {
      if (n >= 0 && n < tp && !outerMask[n] && ccLabels[n] !== countryComp) {
        outerMask[n] = 1;
        borderQueue.push(n);
      }
    }
  }

  let countryMask = new Uint8Array(tp);
  let countrySize = 0;
  for (let i = 0; i < tp; i++) {
    // Exclude water pixels — interior hole fill would otherwise re-include lakes
    // surrounded by land (e.g. Lake Victoria) since flood can't reach them
    countryMask[i] = ((ccLabels[i] === countryComp || !outerMask[i]) && !waterGrown[i]) ? 1 : 0;
    if (countryMask[i]) countrySize++;
  }
  ccLabelsMat.delete(); // done with ccLabels view

  // Restore forced-foreground pixels that morphological pipeline erased.
  // Gaussian blur (25px kernel) destroys thin strips (~15px wide), and CC selection
  // drops fragments disconnected from the main body. But textExcluded (text on map
  // regions) and coastalBand (land adjacent to water) are known foreground — re-add them.
  let forcedRestored = 0;
  for (let i = 0; i < tp; i++) {
    if (!waterGrown[i] && !countryMask[i] && (textExcluded[i] || coastalBand[i])) {
      countryMask[i] = 1;
      countrySize++;
      forcedRestored++;
    }
  }
  if (forcedRestored > 0) {
    console.log(`  [FG] Restored ${forcedRestored} forced-foreground pixels erased by morph pipeline`);
  }

  // Reclaim water pixels near the coast that are actually colored land regions.
  // Some maps use a region color identical to the ocean (e.g., Morocco's cyan coastal strip).
  // If a water pixel is adjacent to the country (within coastalBand) AND has a color that
  // differs from the water-edge median by saturation or brightness, reclaim it as land.
  // We expand the reclaim zone slightly (dilate coastalBand by 5px) to catch thin strips.
  {
    const cbMat = cv.matFromArray(TH, TW, cv.CV_8UC1, coastalBand);
    const reclaimDilateK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(oddK(8), oddK(8)));
    const cbExpanded = new cv.Mat();
    cv.dilate(cbMat, cbExpanded, reclaimDilateK);
    reclaimDilateK.delete(); cbMat.delete();

    // BFS reclaim: grow country mask into water only from existing country edge.
    // This ensures we only reclaim water pixels directly adjacent to the country,
    // not random ocean text/fragments further out.
    // Only reclaim colored pixels (S>=15%, V>=128) — not gray background.
    const reclaimQ: number[] = [];
    // Seed: country pixels adjacent to water
    for (let i = 0; i < tp; i++) {
      if (!countryMask[i]) continue;
      const x = i % TW, y = Math.floor(i / TW);
      for (const n of [i - 1, i + 1, i - TW, i + TW]) {
        if (n >= 0 && n < tp && waterGrown[n] && cbExpanded.data[n]) {
          reclaimQ.push(i);
          break;
        }
      }
    }
    let waterReclaimed = 0;
    let rHead = 0;
    while (rHead < reclaimQ.length) {
      const p = reclaimQ[rHead++];
      for (const n of [p - 1, p + 1, p - TW, p + TW]) {
        if (n < 0 || n >= tp) continue;
        if (!waterGrown[n] || countryMask[n]) continue;
        if (!cbExpanded.data[n]) continue;
        if (textExcluded[n]) continue;
        const r = colorBuf[n * 3], g = colorBuf[n * 3 + 1], b = colorBuf[n * 3 + 2];
        const v = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = v > 0 ? (v - mn) / v : 0;
        if (sat >= 0.15 && v >= 128) {
          waterGrown[n] = 0;
          countryMask[n] = 1;
          countrySize++;
          waterReclaimed++;
          reclaimQ.push(n);
        }
      }
    }
    cbExpanded.delete();
    if (waterReclaimed > 0) {
      console.log(`  [FG] Reclaimed ${waterReclaimed} water pixels near coast as colored land`);
    }
  }

  // Remove foreign land: neighboring countries (e.g. Europe visible on Morocco map)
  // get connected to the target country through narrow straits bridged by morph close.
  // Erode to break narrow bridges, identify separate bodies, remove small foreign ones.
  // Preserves exclaves: only removes bodies that are BOTH outside the main bbox AND
  // smaller than 15% of the main body (real exclaves like Kaliningrad are kept).
  {
    const cmMat = cv.matFromArray(TH, TW, cv.CV_8UC1, countryMask);
    // Scale-aware erosion: bridge must be < 15 base pixels wide to break
    const erodeK = oddK(15);
    const erodeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(erodeK, erodeK));
    const eroded = new cv.Mat();
    cv.erode(cmMat, eroded, erodeKernel);
    erodeKernel.delete(); cmMat.delete();

    const erodedLabels = new cv.Mat();
    const erodedStats = new cv.Mat();
    const erodedCents = new cv.Mat();
    const numErodedCC = cv.connectedComponentsWithStats(eroded, erodedLabels, erodedStats, erodedCents);
    eroded.delete(); erodedCents.delete();

    if (numErodedCC > 2) { // >2 means at least 2 foreground bodies
      // Find the largest foreground body
      let mainCC = 1, mainSize = 0;
      for (let c = 1; c < numErodedCC; c++) {
        const area = erodedStats.intAt(c, cv.CC_STAT_AREA);
        if (area > mainSize) { mainSize = area; mainCC = c; }
      }
      // Get bounding box of main body
      const mainTop = erodedStats.intAt(mainCC, cv.CC_STAT_TOP);
      const mainLeft = erodedStats.intAt(mainCC, cv.CC_STAT_LEFT);
      const mainW = erodedStats.intAt(mainCC, cv.CC_STAT_WIDTH);
      const mainH = erodedStats.intAt(mainCC, cv.CC_STAT_HEIGHT);
      const mainBottom = mainTop + mainH;
      const mainRight = mainLeft + mainW;
      const margin = pxS(20); // generous margin around main body

      // Identify which secondary CCs are foreign land vs exclaves
      const foreignCCs = new Set<number>();
      const erodedLabelData = erodedLabels.data32S;
      for (let c = 1; c < numErodedCC; c++) {
        if (c === mainCC) continue;
        const area = erodedStats.intAt(c, cv.CC_STAT_AREA);
        // Keep large bodies (>15% of main) — likely exclaves, not decoration
        if (area > mainSize * 0.15) continue;
        // Keep bodies inside main bbox + margin — could be islands or nearby exclaves
        const cTop = erodedStats.intAt(c, cv.CC_STAT_TOP);
        const cLeft = erodedStats.intAt(c, cv.CC_STAT_LEFT);
        const cW = erodedStats.intAt(c, cv.CC_STAT_WIDTH);
        const cH = erodedStats.intAt(c, cv.CC_STAT_HEIGHT);
        const cBottom = cTop + cH;
        const cRight = cLeft + cW;
        const overlapsMain = cBottom >= mainTop - margin && cTop <= mainBottom + margin &&
                             cRight >= mainLeft - margin && cLeft <= mainRight + margin;
        if (!overlapsMain) {
          foreignCCs.add(c);
          continue;
        }
        // Blob overlaps main bbox — check if it's actually a colored region (exclave)
        // or just gray background/text area that leaked into the country mask.
        // Compute mean saturation of this blob's pixels in colorBuf.
        let satSum = 0, satN = 0;
        for (let i = 0; i < tp; i++) {
          if (erodedLabelData[i] !== c) continue;
          const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b = colorBuf[i * 3 + 2];
          const v = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (v > 0) satSum += (v - mn) / v;
          satN++;
        }
        const meanSat = satN > 0 ? satSum / satN : 0;
        // Desaturated blobs (mean S < 12%) near the main body are background/text areas,
        // not real exclaves. Real exclaves have colored region fills (S > 15%).
        if (meanSat < 0.12) {
          foreignCCs.add(c);
          console.log(`    [FG] Blob ${c}: area=${area}, meanSat=${(meanSat * 100).toFixed(1)}% → removed (desaturated, likely background)`);
        }
      }

      if (foreignCCs.size > 0) {
        // Remove foreign pixels from country mask
        // Also remove non-eroded pixels in the bridge zone between foreign and main
        let foreignRemoved = 0;
        for (let i = 0; i < tp; i++) {
          if (!countryMask[i]) continue;
          // Check eroded label — if pixel belongs to a foreign CC, remove it
          if (erodedLabelData[i] > 0 && foreignCCs.has(erodedLabelData[i])) {
            countryMask[i] = 0;
            countrySize--;
            foreignRemoved++;
            continue;
          }
          // Also remove non-eroded bridge pixels outside main bbox that have
          // no eroded body (these are the bridge zone lost during erosion)
          if (erodedLabelData[i] === 0 && countryMask[i]) {
            const x = i % TW, y = Math.floor(i / TW);
            const outsideMain = y < mainTop - margin || y > mainBottom + margin ||
                                x < mainLeft - margin || x > mainRight + margin;
            if (outsideMain) {
              countryMask[i] = 0;
              countrySize--;
              foreignRemoved++;
            }
          }
        }
        if (foreignRemoved > 0) {
          console.log(`  [FG] Removed ${foreignRemoved} foreign land pixels (${foreignCCs.size} neighboring country blob(s))`);
        }
      }
    }
    erodedLabels.delete(); erodedStats.delete();
  }

  // Remove thin line artifacts (roads, borders drawn on map) via morphological opening.
  // Opening = erode + dilate: removes features thinner than the kernel while preserving
  // the country shape. Kernel ~13px removes border line tails up to ~12px wide.
  // Real regions are typically 30px+ wide at TW=800.
  {
    const cmOpenMat = cv.matFromArray(TH, TW, cv.CV_8UC1, countryMask);
    const openK = oddK(8);
    const openKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(openK, openK));
    const openedMat = new cv.Mat();
    cv.morphologyEx(cmOpenMat, openedMat, cv.MORPH_OPEN, openKernel);
    let openRemoved = 0;
    for (let i = 0; i < tp; i++) {
      if (countryMask[i] && !openedMat.data[i]) {
        countryMask[i] = 0;
        countrySize--;
        openRemoved++;
      }
    }
    cmOpenMat.delete(); openedMat.delete(); openKernel.delete();
    if (openRemoved > 0) console.log(`  [FG] Morphological opening removed ${openRemoved} thin-line artifact pixels`);
  }

  // Saturation refinement: neighboring countries (Western Sahara, Algeria for Morocco)
  // may have slightly different gray from map background, escaping background detection.
  // Use Otsu on saturation to separate colorful country regions from muted gray neighbors.
  // Guards below ensure this only applies when it makes a meaningful difference.
  const initialMaskPct = countrySize / tp;
  {
    // Compute per-pixel saturation: sat = (max - min) / max
    const sat = new Uint8Array(tp);
    for (let i = 0; i < tp; i++) {
      const r = colorBuf[i * 3], g = colorBuf[i * 3 + 1], b = colorBuf[i * 3 + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      sat[i] = max === 0 ? 0 : Math.round(((max - min) / max) * 255);
    }

    // Otsu threshold on saturation histogram of country-mask pixels
    const satHist = new Array(256).fill(0);
    let satTotal = 0;
    for (let i = 0; i < tp; i++) {
      if (countryMask[i]) { satHist[sat[i]]++; satTotal++; }
    }
    let totalSum = 0;
    for (let i = 0; i < 256; i++) totalSum += i * satHist[i];

    let bestThresh = 0, bestVariance = 0, bgSum = 0, bgCount = 0;
    for (let t = 0; t < 256; t++) {
      bgCount += satHist[t];
      bgSum += t * satHist[t];
      const fgCount = satTotal - bgCount;
      if (bgCount === 0 || fgCount === 0) continue;
      const bgMean = bgSum / bgCount;
      const fgMean = (totalSum - bgSum) / fgCount;
      const variance = bgCount * fgCount * (bgMean - fgMean) ** 2;
      if (variance > bestVariance) { bestVariance = variance; bestThresh = t; }
    }
    const satThreshold = Math.max(15, Math.min(80, bestThresh));

    // Smooth saturation with OpenCV 5×5 median for robustness
    const satMat = cv.matFromArray(TH, TW, cv.CV_8UC1, sat);
    const satBlurred = new cv.Mat();
    cv.medianBlur(satMat, satBlurred, oddK(9));
    const satSmooth = new Uint8Array(satBlurred.data);
    satMat.delete(); satBlurred.delete();

    // Keep only saturated pixels, then close gaps and find largest CC
    const refinedFg = new Uint8Array(tp);
    for (let i = 0; i < tp; i++) {
      if (countryMask[i] && satSmooth[i] >= satThreshold) refinedFg[i] = 1;
    }
    // Close: fill holes from text inpainting (scales with resolution)
    const refinedClosed = cvMorphOp(cv, refinedFg, TW, TH, cv.MORPH_CLOSE, oddK(41));

    // Find largest CC via OpenCV
    const rClosedMat = cv.matFromArray(TH, TW, cv.CV_8UC1, refinedClosed);
    const rLabels = new cv.Mat();
    const rStats = new cv.Mat();
    const rCents = new cv.Mat();
    const numRCC = cv.connectedComponentsWithStats(rClosedMat, rLabels, rStats, rCents);
    rClosedMat.delete(); rCents.delete();
    const rccLabels = rLabels.data32S;
    let rcc = 0, rccMaxSize = 0;
    for (let c = 1; c < numRCC; c++) {
      const area = rStats.intAt(c, cv.CC_STAT_AREA);
      if (area > rccMaxSize) { rccMaxSize = area; rcc = c; }
    }
    rStats.delete();

    // Rebuild country mask with outer flood fill
    const rOuterMask = new Uint8Array(tp);
    const rBorderQ: number[] = [];
    for (let x = 0; x < TW; x++) { rBorderQ.push(x); rBorderQ.push((TH - 1) * TW + x); }
    for (let y = 0; y < TH; y++) { rBorderQ.push(y * TW); rBorderQ.push(y * TW + TW - 1); }
    for (const p of rBorderQ) rOuterMask[p] = 1;
    let rHead = 0;
    while (rHead < rBorderQ.length) {
      const p = rBorderQ[rHead++];
      for (const n of [p - TW, p + TW, p - 1, p + 1])
        if (n >= 0 && n < tp && !rOuterMask[n] && rccLabels[n] !== rcc) { rOuterMask[n] = 1; rBorderQ.push(n); }
    }

    const refinedCountry = new Uint8Array(tp);
    let refinedSize = 0;
    for (let i = 0; i < tp; i++) {
      refinedCountry[i] = ((rccLabels[i] === rcc || !rOuterMask[i]) && !waterGrown[i]) ? 1 : 0;
      if (refinedCountry[i]) refinedSize++;
    }
    rLabels.delete(); // done with rccLabels view

    // Restore forced-foreground pixels in refined mask too
    for (let i = 0; i < tp; i++) {
      if (!waterGrown[i] && !refinedCountry[i] && (textExcluded[i] || coastalBand[i])) {
        refinedCountry[i] = 1;
        refinedSize++;
      }
    }

    // Use refined mask if significantly smaller and still reasonable
    const refinedPct = refinedSize / tp;
    if (refinedPct < initialMaskPct * 0.85 && refinedPct > 0.10) {
      const removed = countrySize - refinedSize;
      console.log(`  [FG] Saturation refinement: removed ${removed} desaturated pixels (${(initialMaskPct * 100).toFixed(1)}% → ${(refinedPct * 100).toFixed(1)}%, Otsu threshold=${satThreshold})`);
      countryMask = refinedCountry;
      countrySize = refinedSize;
    } else {
      console.log(`  [FG] Saturation refinement: skipped (initial=${(initialMaskPct * 100).toFixed(1)}%, refined=${(refinedPct * 100).toFixed(1)}%, threshold=${satThreshold})`);
    }
  }

  // Debug: show country mask + water mask overlay
  const maskVizBuf = Buffer.alloc(tp * 3, 200); // gray background
  for (let i = 0; i < tp; i++) {
    if (waterGrown[i]) {
      maskVizBuf[i * 3] = 60; maskVizBuf[i * 3 + 1] = 120; maskVizBuf[i * 3 + 2] = 200; // blue = water
    } else if (countryMask[i]) {
      maskVizBuf[i * 3] = colorBuf[i * 3]; maskVizBuf[i * 3 + 1] = colorBuf[i * 3 + 1]; maskVizBuf[i * 3 + 2] = colorBuf[i * 3 + 2]; // original colors
    }
  }
  const maskPng = await sharp(maskVizBuf, {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    `Country mask (${(countrySize / tp * 100).toFixed(0)}% of image) + water (blue)`,
    `data:image/png;base64,${maskPng.toString('base64')}`,
  );

  // Write results to context
  ctx.countryMask = countryMask;
  ctx.countrySize = countrySize;
  ctx.coastalBand = coastalBand;
  ctx.hsvBuf = hsvBuf;
}
