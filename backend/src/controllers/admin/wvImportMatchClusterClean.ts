/**
 * Cluster cleaning phase for division matching.
 *
 * Handles spatial splitting of large clusters into disconnected components,
 * merging small clusters into nearest large neighbor, cleaning up isolated
 * patches, and excluding noise clusters (desaturated/tiny).
 *
 * Also builds the ICP mask from active cluster pixels and removes
 * tiny noise connected components from it.
 */

import sharp from 'sharp';

// =============================================================================
// Types
// =============================================================================

export interface CleanParams {
  /** Pixel labels from clustering (mutated in place) */
  pixelLabels: Uint8Array;
  /** Color centroids per cluster (mutated: new entries added for split CCs) */
  colorCentroids: Array<[number, number, number] | null>;
  /** Raw image buffer */
  buf: Buffer;
  /** Country pixel mask */
  countryMask: Uint8Array;
  /** Country pixel count */
  countrySize: number;
  /** Image dimensions */
  TW: number; TH: number;
  /** Original image dimensions (for upscaling debug images) */
  origW: number; origH: number;
  /** Calibrated pixel scale function */
  pxS: (base: number) => number;
  /** Debug image callback */
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
}

export interface CleanResult {
  /** Set of labels still active after cleaning */
  finalLabels: Set<number>;
  /** Per-cluster pixel counts */
  finalClusters: Map<number, number>;
  /** Quantized color buffer for debug images */
  quantBuf: Buffer;
  /** ICP mask (active cluster pixels, noise-cleaned) */
  icpMask: Uint8Array;
}

// =============================================================================
// Main cleaning function
// =============================================================================

export async function cleanClusters(params: CleanParams): Promise<CleanResult> {
  const {
    pixelLabels, colorCentroids, buf, countryMask, countrySize,
    TW, TH, origW, origH,
    pxS, pushDebugImage,
  } = params;

  const tp = TW * TH;

  // ── Spatial split: break large clusters into spatially disconnected regions ──
  const SPATIAL_SPLIT_MIN_CLUSTER_PCT = 0.15;
  const SPATIAL_SPLIT_MIN_CC_PCT = 0.03;
  const SPATIAL_SPLIT_COLOR_DIST = 8;
  // Compute CK from pixelLabels (max label + 1)
  let CK = 0;
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255 && pixelLabels[i] >= CK) CK = pixelLabels[i] + 1;
  }
  let nextLabel = CK;
  for (let k = 0; k < CK; k++) {
    let clusterCount = 0;
    for (let i = 0; i < tp; i++) { if (pixelLabels[i] === k) clusterCount++; }
    if (clusterCount / countrySize < SPATIAL_SPLIT_MIN_CLUSTER_PCT) continue;
    // Find connected components of this cluster
    const ccVisited = new Uint8Array(tp);
    const ccs: number[][] = [];
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] !== k || ccVisited[i]) continue;
      const cc: number[] = [];
      const q = [i]; ccVisited[i] = 1; let h = 0;
      while (h < q.length) {
        const p = q[h++]; cc.push(p);
        for (const n of [p - TW, p + TW, p - 1, p + 1]) {
          if (n >= 0 && n < tp && !ccVisited[n] && pixelLabels[n] === k) { ccVisited[n] = 1; q.push(n); }
        }
      }
      ccs.push(cc);
    }
    ccs.sort((a, b) => b.length - a.length);
    const minCCSize = Math.max(pxS(500), Math.round(countrySize * SPATIAL_SPLIT_MIN_CC_PCT));
    const largeCCs = ccs.filter(cc => cc.length >= minCCSize);
    if (largeCCs.length < 2) continue;
    const ccColors: Array<[number, number, number]> = largeCCs.map(cc => {
      let rr = 0, gg = 0, bb = 0;
      for (const p of cc) { rr += buf[p * 3]; gg += buf[p * 3 + 1]; bb += buf[p * 3 + 2]; }
      return [Math.round(rr / cc.length), Math.round(gg / cc.length), Math.round(bb / cc.length)];
    });
    let shouldSplit = false;
    for (let a = 0; a < ccColors.length && !shouldSplit; a++) {
      for (let b = a + 1; b < ccColors.length; b++) {
        const d = Math.sqrt(
          (ccColors[a][0] - ccColors[b][0]) ** 2 +
          (ccColors[a][1] - ccColors[b][1]) ** 2 +
          (ccColors[a][2] - ccColors[b][2]) ** 2,
        );
        if (d >= SPATIAL_SPLIT_COLOR_DIST) { shouldSplit = true; break; }
      }
    }
    if (!shouldSplit) {
      console.log(`  [Spatial] cluster ${k} (${(clusterCount / countrySize * 100).toFixed(1)}%): ${largeCCs.length} large CCs but colors too similar — no split`);
      continue;
    }
    console.log(`  [Spatial] cluster ${k} (${(clusterCount / countrySize * 100).toFixed(1)}%): splitting ${largeCCs.length} CCs:`);
    console.log(`    CC 0: ${largeCCs[0].length}px RGB(${ccColors[0]}) → stays cluster ${k}`);
    colorCentroids[k] = ccColors[0];
    for (let ci = 1; ci < largeCCs.length; ci++) {
      const newLbl = nextLabel++;
      colorCentroids[newLbl] = ccColors[ci];
      console.log(`    CC ${ci}: ${largeCCs[ci].length}px RGB(${ccColors[ci]}) → new cluster ${newLbl}`);
      for (const p of largeCCs[ci]) pixelLabels[p] = newLbl;
    }
  }

  // Debug image: after K-means + spatial split, before merge/cleanup
  const preMergeBuf = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === 255) {
      preMergeBuf[i * 3] = 220; preMergeBuf[i * 3 + 1] = 220; preMergeBuf[i * 3 + 2] = 220;
    } else {
      const c = colorCentroids[pixelLabels[i]];
      if (c) { preMergeBuf[i * 3] = c[0]; preMergeBuf[i * 3 + 1] = c[1]; preMergeBuf[i * 3 + 2] = c[2]; }
    }
  }
  const preMergePng = await sharp(preMergeBuf, {
    raw: { width: TW, height: TH, channels: 3 },
  }).resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
  await pushDebugImage(
    `K-means + spatial split (before merge/cleanup)`,
    `data:image/png;base64,${preMergePng.toString('base64')}`,
  );

  // Auto-merge tiny clusters (<2% of country) into nearest large cluster
  const MERGE_SIZE_PCT = 0.02;
  const MERGE_MAX_DIST_SQ = 40 * 40;
  const postSplitCounts = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) postSplitCounts.set(pixelLabels[i], (postSplitCounts.get(pixelLabels[i]) || 0) + 1);
  }
  const allLabels = [...postSplitCounts.keys()];
  for (const k of allLabels) {
    const cnt = postSplitCounts.get(k)!;
    if (cnt / countrySize >= MERGE_SIZE_PCT) continue;
    let minDist = Infinity, minK = k;
    for (const j of allLabels) {
      if (j === k) continue;
      const jCnt = postSplitCounts.get(j)!;
      if (jCnt / countrySize < MERGE_SIZE_PCT) continue;
      const ck = colorCentroids[k], cj = colorCentroids[j];
      if (!ck || !cj) continue;
      const d = (ck[0] - cj[0]) ** 2 + (ck[1] - cj[1]) ** 2 + (ck[2] - cj[2]) ** 2;
      if (d < minDist) { minDist = d; minK = j; }
    }
    const rgbDist = Math.sqrt(minDist);
    if (minDist <= MERGE_MAX_DIST_SQ && minK !== k) {
      console.log(`  [Merge] cluster ${k} (${(cnt / countrySize * 100).toFixed(1)}%) → ${minK} (RGB dist=${rgbDist.toFixed(1)})`);
      for (let i = 0; i < tp; i++) { if (pixelLabels[i] === k) pixelLabels[i] = minK; }
      postSplitCounts.set(minK, postSplitCounts.get(minK)! + cnt);
      postSplitCounts.delete(k);
    } else if (minK !== k) {
      console.log(`  [Merge] cluster ${k} (${(cnt / countrySize * 100).toFixed(1)}%) KEPT — nearest ${minK} too far (RGB dist=${rgbDist.toFixed(1)} > 40)`);
    }
  }

  // Clean up small isolated patches per cluster
  const MIN_PATCH = Math.max(pxS(20), Math.round(countrySize * 0.02));
  const uniqueLabels = new Set<number>();
  for (let i = 0; i < tp; i++) if (pixelLabels[i] < 255) uniqueLabels.add(pixelLabels[i]);

  let patchMergeCount = 0;
  for (const lbl of uniqueLabels) {
    const visited = new Uint8Array(tp);
    const patches: number[][] = [];
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] !== lbl || visited[i]) continue;
      const positions: number[] = [];
      const q = [i]; visited[i] = 1; let h = 0;
      while (h < q.length) {
        const p = q[h++]; positions.push(p);
        for (const n of [p - TW, p + TW, p - 1, p + 1]) {
          if (n >= 0 && n < tp && !visited[n] && pixelLabels[n] === lbl) { visited[n] = 1; q.push(n); }
        }
      }
      patches.push(positions);
    }

    patches.sort((a, b) => b.length - a.length);
    if (patches.length <= 1) continue;

    for (let pi = 1; pi < patches.length; pi++) {
      const patch = patches[pi];
      if (patch.length >= MIN_PATCH) continue;
      const nbrCounts = new Map<number, number>();
      for (const pos of patch) {
        for (const n of [pos - TW, pos + TW, pos - 1, pos + 1]) {
          if (n >= 0 && n < tp && pixelLabels[n] < 255 && pixelLabels[n] !== lbl) {
            nbrCounts.set(pixelLabels[n], (nbrCounts.get(pixelLabels[n]) || 0) + 1);
          }
        }
      }
      if (nbrCounts.size === 0) continue;
      let bestNbr = lbl, bestCnt = 0;
      for (const [nl, cnt] of nbrCounts) { if (cnt > bestCnt) { bestCnt = cnt; bestNbr = nl; } }
      patchMergeCount++;
      for (const pos of patch) pixelLabels[pos] = bestNbr;
    }
  }
  if (patchMergeCount > 0) console.log(`  [Patch] ${patchMergeCount} small patches relabeled (threshold: ${MIN_PATCH}px)`);

  // Auto-exclude noise clusters: desaturated (gray/dark), very small, or boundary fragments
  const NOISE_MIN_SAT = 25;
  const NOISE_MIN_VAL = 60;
  const NOISE_TINY_PCT = 0.5;
  {
    const preCounts = new Map<number, number>();
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] < 255) preCounts.set(pixelLabels[i], (preCounts.get(pixelLabels[i]) || 0) + 1);
    }
    const noiseIds: number[] = [];
    const validIds: number[] = [];
    for (const [lbl, cnt] of preCounts) {
      const c = colorCentroids[lbl];
      if (!c) { noiseIds.push(lbl); continue; }
      const pct = cnt / countrySize * 100;
      const maxC = Math.max(c[0], c[1], c[2]);
      const minC = Math.min(c[0], c[1], c[2]);
      const sat = maxC > 0 ? ((maxC - minC) / maxC) * 255 : 0;
      const val = maxC;
      const isColorful = sat >= NOISE_MIN_SAT && val >= NOISE_MIN_VAL;
      const tinyThreshold = isColorful ? 0.15 : NOISE_TINY_PCT;
      if (pct < tinyThreshold) { noiseIds.push(lbl); continue; }
      if ((sat < NOISE_MIN_SAT || val < NOISE_MIN_VAL) && pct < 15) {
        noiseIds.push(lbl); continue;
      }
      validIds.push(lbl);
    }
    if (noiseIds.length > 0 && validIds.length >= 3) {
      let reassigned = 0;
      for (let i = 0; i < tp; i++) {
        if (!noiseIds.includes(pixelLabels[i])) continue;
        let bestDist = Infinity, bestLbl = pixelLabels[i];
        const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
        for (const vl of validIds) {
          const vc = colorCentroids[vl];
          if (!vc) continue;
          const d = (r - vc[0]) ** 2 + (g - vc[1]) ** 2 + (b - vc[2]) ** 2;
          if (d < bestDist) { bestDist = d; bestLbl = vl; }
        }
        pixelLabels[i] = bestLbl;
        reassigned++;
      }
      console.log(`  [Noise] Auto-excluded ${noiseIds.length} noise cluster(s) (${reassigned} px reassigned to nearest valid cluster)`);
      for (const nl of noiseIds) {
        const c = colorCentroids[nl];
        const cnt = preCounts.get(nl) || 0;
        console.log(`    excluded ${nl}: RGB(${c?.[0]},${c?.[1]},${c?.[2]}) ${cnt}px (${(cnt / countrySize * 100).toFixed(1)}%)`);
      }
    }
  }

  // Count final clusters
  const finalLabels = new Set<number>();
  for (let i = 0; i < tp; i++) if (pixelLabels[i] < 255) finalLabels.add(pixelLabels[i]);
  console.log(`  [Clustering] Final: ${finalLabels.size} clusters (from ${CK} initial + spatial splits)`);
  for (const lbl of finalLabels) {
    let cnt = 0;
    for (let i = 0; i < tp; i++) if (pixelLabels[i] === lbl) cnt++;
    const c = colorCentroids[lbl];
    console.log(`    cluster ${lbl}: RGB(${c?.[0]},${c?.[1]},${c?.[2]}) ${cnt}px (${(cnt / countrySize * 100).toFixed(1)}%)`);
  }

  // Push a cluster visualization as debug image
  {
    const vizBuf = Buffer.alloc(tp * 3, 220);
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] !== 255 && colorCentroids[pixelLabels[i]]) {
        const c = colorCentroids[pixelLabels[i]]!;
        vizBuf[i * 3] = c[0]; vizBuf[i * 3 + 1] = c[1]; vizBuf[i * 3 + 2] = c[2];
      }
    }
    const vizPng = await sharp(vizBuf, { raw: { width: TW, height: TH, channels: 3 } })
      .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
    await pushDebugImage(`Clusters (${finalLabels.size} final)`, `data:image/png;base64,${vizPng.toString('base64')}`);
  }

  // Render quantized map + border overlay
  const quantBuf = Buffer.alloc(tp * 3);
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] === 255) {
      quantBuf[i * 3] = 220; quantBuf[i * 3 + 1] = 220; quantBuf[i * 3 + 2] = 220;
    } else {
      const c = colorCentroids[pixelLabels[i]];
      if (c) { quantBuf[i * 3] = c[0]; quantBuf[i * 3 + 1] = c[1]; quantBuf[i * 3 + 2] = c[2]; }
    }
  }

  const overlayBuf = Buffer.from(quantBuf);
  for (let y = 1; y < TH - 1; y++) {
    for (let x = 1; x < TW - 1; x++) {
      const p = y * TW + x;
      if (pixelLabels[p] === 255) continue;
      let isExt = false, isInt = false;
      for (const n of [p - TW, p + TW, p - 1, p + 1]) {
        if (pixelLabels[n] === pixelLabels[p]) continue;
        if (pixelLabels[n] === 255) isExt = true; else isInt = true;
      }
      const o = p * 3;
      if (isExt) { overlayBuf[o] = 213; overlayBuf[o + 1] = 47; overlayBuf[o + 2] = 47; }
      else if (isInt) { overlayBuf[o] = 21; overlayBuf[o + 1] = 101; overlayBuf[o + 2] = 192; }
    }
  }

  // Final cluster pixel counts
  const finalClusters = new Map<number, number>();
  for (let i = 0; i < tp; i++) {
    if (pixelLabels[i] < 255) finalClusters.set(pixelLabels[i], (finalClusters.get(pixelLabels[i]) || 0) + 1);
  }

  // Debug image: CV borders (upscaled)
  const upscaledBordersPng = await sharp(overlayBuf, { raw: { width: TW, height: TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await pushDebugImage(
    `Step 2: Source map CV borders (${finalClusters.size} color regions, red=external, blue=internal)`,
    `data:image/png;base64,${upscaledBordersPng.toString('base64')}`,
  );

  // Build ICP mask from active (non-excluded) cluster pixels
  let icpMask: Uint8Array;
  {
    const baseMask = new Uint8Array(tp);
    let baseSize = 0;
    for (let i = 0; i < tp; i++) {
      if (countryMask[i] && pixelLabels[i] !== 255) {
        baseMask[i] = 1;
        baseSize++;
      }
    }
    icpMask = baseMask;
    if (baseSize < countrySize) {
      console.log(`  [ICP] Excluded-cluster refinement: mask ${countrySize}→${baseSize} px (${(baseSize/tp*100).toFixed(0)}%)`);
    }

    // Further exclude desaturated (gray) clusters
    const grayClusterIds: number[] = [];
    for (const [clusterId] of finalClusters) {
      const c = colorCentroids[clusterId];
      if (!c) continue;
      const maxC = Math.max(c[0], c[1], c[2]);
      const minC = Math.min(c[0], c[1], c[2]);
      const sat = maxC > 0 ? ((maxC - minC) / maxC) * 255 : 0;
      if (sat < 20) grayClusterIds.push(clusterId);
    }
    if (grayClusterIds.length > 0) {
      const refined = new Uint8Array(tp);
      let refinedSize = 0;
      for (let i = 0; i < tp; i++) {
        if (pixelLabels[i] < 255 && !grayClusterIds.includes(pixelLabels[i])) {
          refined[i] = 1;
          refinedSize++;
        }
      }
      if (refinedSize > tp * 0.15 && refinedSize < baseSize * 0.95) {
        console.log(`  [ICP] Excluding ${grayClusterIds.length} gray cluster(s): mask ${baseSize}→${refinedSize} px (${(refinedSize/tp*100).toFixed(0)}%)`);
        icpMask = refined;
      }
    }
  }

  // Remove tiny noise CCs from ICP mask before bbox computation
  {
    const ccLabels = new Int32Array(tp);
    let ccNextLabel = 1;
    const ccSizes = new Map<number, number>();
    for (let i = 0; i < tp; i++) {
      if (!icpMask[i] || ccLabels[i] > 0) continue;
      const label = ccNextLabel++;
      let size = 0;
      const queue = [i];
      while (queue.length > 0) {
        const p = queue.pop()!;
        if (p < 0 || p >= tp || ccLabels[p] > 0 || !icpMask[p]) continue;
        ccLabels[p] = label;
        size++;
        const x = p % TW, y = Math.floor(p / TW);
        if (x > 0) queue.push(p - 1);
        if (x < TW - 1) queue.push(p + 1);
        if (y > 0) queue.push(p - TW);
        if (y < TH - 1) queue.push(p + TW);
      }
      ccSizes.set(label, size);
    }
    if (ccSizes.size > 1) {
      const mainSize = Math.max(...ccSizes.values());
      const threshold = Math.max(10, Math.round(mainSize * 0.01));
      let removed = 0;
      for (let i = 0; i < tp; i++) {
        if (ccLabels[i] > 0 && (ccSizes.get(ccLabels[i]) ?? 0) < threshold) {
          icpMask[i] = 0;
          removed++;
        }
      }
      if (removed > 0) {
        console.log(`  [ICP] Noise cleanup: removed ${removed} pixels in ${[...ccSizes.values()].filter(s => s < threshold).length} tiny CCs (<1% of main)`);
      }
    }
  }

  return { finalLabels, finalClusters, quantBuf, icpMask };
}
