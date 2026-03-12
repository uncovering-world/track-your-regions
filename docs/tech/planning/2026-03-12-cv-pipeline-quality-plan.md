# CV Pipeline Quality Improvements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the auto CV match pipeline's color clustering accuracy for maps with muted/pastel palettes (e.g., Morocco), and add a retry/re-cluster mechanism.

**Architecture:** Seven changes to the existing pipeline in `wvImportMatchController.ts` and `wvImportMatchShared.ts`. Core change: switch K-means from RGB to normalized CIELAB color space. Supporting changes: better initialization, spatial cleanup, seam marking, adaptive water detection, Lab-based background detection. UX addition: re-cluster button in cluster review.

**Tech Stack:** TypeScript, OpenCV WASM (`@techstark/opencv-js` — `cv.COLOR_RGB2Lab`), sharp, Express SSE, React/MUI

**Spec:** `docs/tech/planning/2026-03-12-cv-pipeline-quality-improvements.md`

---

## Chunk 1: Core K-means Improvements (Tasks 1–4)

### Task 1: CIELAB Color Space + Chromatic Stretching for K-means

The single highest-impact change. Convert pixel colors to CIELAB and z-score normalize before K-means so perceptually distinct colors are separable.

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:3054-3159`

**Context:** The K-means section starts at line 3054. It collects `countryPixels` as RGB tuples (line 3063–3071), runs farthest-point init (3077–3089), iterates (3090–3109), then assigns labels (3116–3150). We replace the color space used for pixel collection, centroid init, iteration, and label assignment.

OpenCV 8-bit Lab: L ∈ [0,255] (from 0–100), a\* ∈ [0,255] (centered 128), b\* ∈ [0,255] (centered 128).

- [ ] **Step 1: Add Lab conversion after park inpainting**

Insert right before the K-means `await logStep` (line 3054). This converts `buf` (which is `colorBuf` after all text/park processing) to Lab:

```typescript
      // Convert clean color buffer to CIELAB for perceptually-accurate K-means
      const cvBufForLab = new cv.Mat(TH, TW, cv.CV_8UC3);
      cvBufForLab.data.set(buf);
      const cvLabMat = new cv.Mat();
      cv.cvtColor(cvBufForLab, cvLabMat, cv.COLOR_RGB2Lab);
      const labBuf = Buffer.from(cvLabMat.data);
      cvBufForLab.delete(); cvLabMat.delete();
```

- [ ] **Step 2: Compute per-channel mean, stddev, and normalization weights**

Insert after Lab conversion, before pixel collection loop. Computes stats across country-mask non-text pixels:

```typescript
      // Per-channel stats for z-score normalization (amplifies chromatic differences)
      let sumL = 0, sumA = 0, sumB = 0, sumL2 = 0, sumA2 = 0, sumB2 = 0;
      let statCount = 0;
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || textExcluded[i]) continue;
        const L = labBuf[i * 3], a = labBuf[i * 3 + 1], b = labBuf[i * 3 + 2];
        sumL += L; sumA += a; sumB += b;
        sumL2 += L * L; sumA2 += a * a; sumB2 += b * b;
        statCount++;
      }
      const meanL = sumL / statCount, meanA = sumA / statCount, meanB = sumB / statCount;
      // Guard: Math.max(0,...) prevents NaN from floating-point E[X²]-E[X]² instability;
      // σ < 0.01 → use 1.0 so zero-variance channels get minimal weight (not amplified)
      const rawStdL = Math.sqrt(Math.max(0, sumL2 / statCount - meanL * meanL));
      const rawStdA = Math.sqrt(Math.max(0, sumA2 / statCount - meanA * meanA));
      const rawStdB = Math.sqrt(Math.max(0, sumB2 / statCount - meanB * meanB));
      const stdL = rawStdL < 0.01 ? 1.0 : rawStdL;
      const stdA = rawStdA < 0.01 ? 1.0 : rawStdA;
      const stdB = rawStdB < 0.01 ? 1.0 : rawStdB;
      // Weights: de-emphasize luminance (0.5), full chrominance (1.0)
      const wL = 0.5 / stdL, wA = 1.0 / stdA, wB = 1.0 / stdB;
      console.log(`  [Lab] mean=(${meanL.toFixed(1)},${meanA.toFixed(1)},${meanB.toFixed(1)}) std=(${stdL.toFixed(1)},${stdA.toFixed(1)},${stdB.toFixed(1)})`);
```

- [ ] **Step 3: Change pixel collection to normalized Lab**

Replace the `countryPixels` collection loop (lines 3063–3071). Change from `[R,G,B]` Uint8 to `[L',a',b']` Float64:

```typescript
      const countryPixels: Array<[number, number, number]> = [];
      const countryIndices: number[] = [];
      let textExcludedCount = 0;
      for (let i = 0; i < tp; i++) {
        if (countryMask[i]) {
          if (textExcluded[i]) { textExcludedCount++; continue; }
          countryPixels.push([
            (labBuf[i * 3] - meanL) * wL,
            (labBuf[i * 3 + 1] - meanA) * wA,
            (labBuf[i * 3 + 2] - meanB) * wB,
          ]);
          countryIndices.push(i);
        }
      }
```

- [ ] **Step 4: Change label assignment (Phase 1) to use normalized Lab**

Replace lines 3118–3129. Instead of reading RGB from `buf`, read Lab from `labBuf` and normalize:

```typescript
      // Phase 1: color-based assignment for clean pixels only (normalized Lab)
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || textExcluded[i]) continue;
        const nL = (labBuf[i * 3] - meanL) * wL;
        const nA = (labBuf[i * 3 + 1] - meanA) * wA;
        const nB = (labBuf[i * 3 + 2] - meanB) * wB;
        let bestDist = Infinity, bestK = 0;
        for (let k = 0; k < CK; k++) {
          const d = (nL - colorCentroids[k][0]) ** 2 + (nA - colorCentroids[k][1]) ** 2 + (nB - colorCentroids[k][2]) ** 2;
          if (d < bestDist) { bestDist = d; bestK = k; }
        }
        pixelLabels[i] = bestK;
        clusterCounts[bestK]++;
      }
```

- [ ] **Step 5: Convert centroids back to RGB for debug viz and downstream**

After the K-means iteration loop (after line 3109), convert normalized Lab centroids back to RGB for the cluster preview images and the shared pipeline (which uses RGB centroids for visualization):

```typescript
      // Convert centroids: normalized Lab → original Lab → RGB (for debug viz + shared pipeline)
      const rgbCentroids: Array<[number, number, number]> = colorCentroids.map(c => {
        // Denormalize: nVal = (val - mean) * weight → val = nVal / weight + mean
        const oL = Math.round(Math.min(255, Math.max(0, c[0] / wL + meanL)));
        const oA = Math.round(Math.min(255, Math.max(0, c[1] / wA + meanA)));
        const oB = Math.round(Math.min(255, Math.max(0, c[2] / wB + meanB)));
        // Lab→RGB via OpenCV (single-pixel Mat)
        const labPx = new cv.Mat(1, 1, cv.CV_8UC3);
        labPx.data[0] = oL; labPx.data[1] = oA; labPx.data[2] = oB;
        const rgbPx = new cv.Mat();
        cv.cvtColor(labPx, rgbPx, cv.COLOR_Lab2RGB);
        const rgb: [number, number, number] = [rgbPx.data[0], rgbPx.data[1], rgbPx.data[2]];
        labPx.delete(); rgbPx.delete();
        return rgb;
      });
```

- [ ] **Step 6: Pass `rgbCentroids` to `matchDivisionsFromClusters`**

Change the call at line 3163 to pass `rgbCentroids` instead of `colorCentroids`:

```typescript
      await matchDivisionsFromClusters({
        ...
        colorCentroids: rgbCentroids,  // was: colorCentroids (normalized Lab → RGB converted)
        ...
      });
```

Also update the K-means results logging (lines 3152–3159) to print RGB centroids:

```typescript
      console.log(`  [K-means] ${CK} clusters, countrySize=${countrySize}:`);
      for (let k = 0; k < CK; k++) {
        if (clusterCounts[k] === 0) continue;
        const pct = (clusterCounts[k] / countrySize * 100).toFixed(1);
        const c = rgbCentroids[k];
        console.log(`    cluster ${k}: RGB(${c[0]},${c[1]},${c[2]}) ${clusterCounts[k]}px (${pct}%)`);
      }
```

- [ ] **Step 7: Verify typecheck passes**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

Expected: No new errors (the `colorCentroids` type remains `Array<[number, number, number]>` throughout — only the values change from RGB to normalized-Lab internally, and we pass `rgbCentroids` downstream).

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchController.ts
git commit -m "feat: switch K-means to normalized CIELAB color space

Convert pixel colors to CIELAB and apply z-score normalization with
chrominance-weighted channels before K-means clustering. Perceptually
distinct but RGB-close colors (e.g., Morocco's pastels) now separate
cleanly. Centroids converted back to RGB for downstream pipeline.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Raise CK Cap + K-means++ Initialization

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:3058` (CK formula)
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:3077-3089` (centroid init)
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:3090-3109` (iteration loop)

- [ ] **Step 1: Raise CK cap**

Replace line 3058:

```typescript
      // Old: const CK = Math.max(6, Math.min(expectedRegionCount * 2, 16));
      const CK = Math.max(8, Math.min(expectedRegionCount * 3, 32));
```

- [ ] **Step 2: Replace farthest-point init with K-means++**

Replace lines 3077–3089. K-means++ selects centroids with probability proportional to D² (distance to nearest existing centroid):

```typescript
      // K-means++ initialization: probabilistic distance-weighted sampling
      const colorCentroids: Array<[number, number, number]> = [countryPixels[Math.floor(Math.random() * countryPixels.length)]];
      for (let c = 1; c < CK; c++) {
        // Compute D² for each pixel (distance to nearest existing centroid)
        const d2 = new Float64Array(countryPixels.length);
        let totalD2 = 0;
        for (let i = 0; i < countryPixels.length; i++) {
          let minDist = Infinity;
          for (const ct of colorCentroids) {
            const d = (countryPixels[i][0] - ct[0]) ** 2 + (countryPixels[i][1] - ct[1]) ** 2 + (countryPixels[i][2] - ct[2]) ** 2;
            if (d < minDist) minDist = d;
          }
          d2[i] = minDist;
          totalD2 += minDist;
        }
        // Sample with probability proportional to D²
        let target = Math.random() * totalD2;
        let chosen = 0;
        for (let i = 0; i < countryPixels.length; i++) {
          target -= d2[i];
          if (target <= 0) { chosen = i; break; }
        }
        // Deduplicate: if chosen is too close to existing centroid, resample (max 5 retries)
        let retries = 0;
        while (retries < 5) {
          const p = countryPixels[chosen];
          let tooClose = false;
          for (const ct of colorCentroids) {
            if ((p[0] - ct[0]) ** 2 + (p[1] - ct[1]) ** 2 + (p[2] - ct[2]) ** 2 < 4) { tooClose = true; break; }
          }
          if (!tooClose) break;
          chosen = Math.floor(Math.random() * countryPixels.length);
          retries++;
        }
        colorCentroids.push([...countryPixels[chosen]]);
      }
```

- [ ] **Step 3: Add convergence check to iteration loop**

Replace lines 3090–3109. Add early termination when centroids stop moving:

```typescript
      const MAX_ITER = 40;
      for (let iter = 0; iter < MAX_ITER; iter++) {
        const sums = colorCentroids.map(() => [0, 0, 0, 0]);
        for (const px of countryPixels) {
          let bestDist = Infinity, bestK = 0;
          for (let k = 0; k < CK; k++) {
            const d = (px[0] - colorCentroids[k][0]) ** 2 + (px[1] - colorCentroids[k][1]) ** 2 + (px[2] - colorCentroids[k][2]) ** 2;
            if (d < bestDist) { bestDist = d; bestK = k; }
          }
          sums[bestK][0] += px[0]; sums[bestK][1] += px[1]; sums[bestK][2] += px[2]; sums[bestK][3]++;
        }
        let totalMovement = 0;
        for (let k = 0; k < CK; k++) {
          if (sums[k][3] > 0) {
            const newC: [number, number, number] = [
              sums[k][0] / sums[k][3],
              sums[k][1] / sums[k][3],
              sums[k][2] / sums[k][3],
            ];
            totalMovement += Math.abs(newC[0] - colorCentroids[k][0]) + Math.abs(newC[1] - colorCentroids[k][1]) + Math.abs(newC[2] - colorCentroids[k][2]);
            colorCentroids[k] = newC;
          }
        }
        if (totalMovement < 1.0) {
          console.log(`  [K-means] Converged at iteration ${iter + 1}`);
          break;
        }
      }
```

Note: centroids are now float (not rounded) during iteration for smoother convergence. The downstream centroid→RGB conversion (Task 1, Step 5) handles rounding.

- [ ] **Step 4: Verify typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchController.ts
git commit -m "feat: raise CK cap to 32 and use K-means++ initialization

Raise cluster count cap from 16 to min(N*3, 32) for better separation
of similar colors. Replace deterministic farthest-point init with
probabilistic K-means++ (D²-weighted sampling) to avoid outlier bias.
Add early convergence check to save iterations.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Mark BFS Text-Fill Seam Pixels as Excluded

Depends on Task 1 (uses Lab buffer for ΔE computation).

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:1849` (after BFS text fill block)

**Context:** The BFS text fill block (lines 1829–1849) fills text pixels in `colorBuf` with nearest non-text neighbor colors. Where two wavefronts from different regions meet, there's a hard color seam. We detect these seam pixels and add them to `textExcluded` so they get BFS-label-propagated instead of color-assigned.

- [ ] **Step 1: Add Lab conversion of colorBuf after BFS text fill**

Insert right after the BFS block's closing brace (after line 1849), before the water detection section:

```typescript
      // Convert colorBuf to Lab for seam detection and later BG detection
      const cvBufForSeam = new cv.Mat(TH, TW, cv.CV_8UC3);
      cvBufForSeam.data.set(colorBuf);
      const cvLabSeam = new cv.Mat();
      cv.cvtColor(cvBufForSeam, cvLabSeam, cv.COLOR_RGB2Lab);
      const labBufEarly = Buffer.from(cvLabSeam.data);
      cvBufForSeam.delete(); cvLabSeam.delete();
```

- [ ] **Step 2: Detect and mark seam pixels**

Insert immediately after the Lab conversion:

```typescript
      // Mark BFS seam pixels: filled text pixels with large Lab ΔE to a filled neighbor.
      // These are artifacts where two BFS wavefronts from different regions collide.
      const SEAM_DE_SQ = 8 * 8; // ΔE² threshold in OpenCV 8-bit Lab space
      let seamCount = 0;
      for (let i = 0; i < tp; i++) {
        if (!textExcluded[i]) continue; // only check filled text pixels
        const L1 = labBufEarly[i * 3], a1 = labBufEarly[i * 3 + 1], b1 = labBufEarly[i * 3 + 2];
        for (const n of [i - TW, i + TW, i - 1, i + 1]) {
          if (n < 0 || n >= tp) continue;
          if (!textExcluded[n]) continue; // neighbor must also be a filled text pixel
          const dL = L1 - labBufEarly[n * 3];
          const dA = a1 - labBufEarly[n * 3 + 1];
          const dB = b1 - labBufEarly[n * 3 + 2];
          if (dL * dL + dA * dA + dB * dB > SEAM_DE_SQ) {
            // This pixel and its neighbor have very different colors → seam
            // textExcluded is already 1, so it will be BFS-label-propagated (Phase 2)
            // No action needed — it's already excluded from Phase 1 color assignment.
            // But mark both sides of the seam for logging.
            seamCount++;
            break;
          }
        }
      }
      console.log(`  [Seam] Detected ${seamCount} BFS seam pixels (already excluded from K-means color assignment)`);
```

Wait — re-reading the spec and code: `textExcluded` pixels are ALREADY excluded from Phase 1. The seam pixels we detect are a subset of `textExcluded`. So they're already handled correctly! The issue is that during BFS text fill, the seam pixels get filled with the color of ONE side, and then during Phase 1, they're skipped (good), and during Phase 2, they get BFS-label-propagated (good).

The actual improvement: currently, the BFS fill copies one side's color to each text pixel. On the seam, adjacent pixels have completely different colors. When Phase 2 BFS-propagates labels INTO text regions, the propagation starts from non-text pixels at the edges and works inward. The seam pixels in the middle of the text region get labels from whichever side's wavefront reaches them first — which is exactly the correct behavior.

So the seam marking improvement is actually a **no-op** for the existing two-phase system! The text pixels are already excluded from color-based assignment. The only scenario where seam marking would help is if we ALSO wanted to exclude the pixels immediately adjacent to the seam on both sides — extending the excluded zone. But this risks over-excluding.

**Revised approach**: Instead of seam marking, extend `textExcluded` by 1 pixel around seam boundaries to catch anti-aliased edges that the fixed 5×5 dilation didn't cover. Only mark the seam-adjacent pixels (not all text pixels):

```typescript
      // Extend textExcluded at BFS seam boundaries: where two different fill colors meet,
      // the boundary pixels may have been assigned the wrong side's color. Mark the
      // immediate neighbors of high-ΔE transitions as excluded too.
      const SEAM_DE_SQ = 8 * 8;
      let seamExtended = 0;
      const seamMark = new Uint8Array(tp);
      for (let i = 0; i < tp; i++) {
        if (!textExcluded[i]) continue;
        const L1 = labBufEarly[i * 3], a1 = labBufEarly[i * 3 + 1], b1 = labBufEarly[i * 3 + 2];
        for (const n of [i - TW, i + TW, i - 1, i + 1]) {
          if (n < 0 || n >= tp || !textExcluded[n]) continue;
          const dL = L1 - labBufEarly[n * 3], dA = a1 - labBufEarly[n * 3 + 1], dB = b1 - labBufEarly[n * 3 + 2];
          if (dL * dL + dA * dA + dB * dB > SEAM_DE_SQ) { seamMark[i] = 1; seamMark[n] = 1; break; }
        }
      }
      // Extend exclusion: mark non-excluded neighbors of seam pixels
      for (let i = 0; i < tp; i++) {
        if (!seamMark[i]) continue;
        for (const n of [i - TW, i + TW, i - 1, i + 1]) {
          if (n >= 0 && n < tp && !textExcluded[n] && countryMask[n]) {
            textExcluded[n] = 1;
            seamExtended++;
          }
        }
      }
      if (seamExtended > 0) {
        console.log(`  [Seam] Extended textExcluded by ${seamExtended} pixels around ${[...seamMark].filter(Boolean).length} seam pixels`);
      }
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchController.ts
git commit -m "feat: detect BFS text-fill seams and extend exclusion zone

After BFS text fill, detect seam pixels (high Lab ΔE between adjacent
filled pixels) and extend textExcluded to their non-text neighbors.
Prevents K-means from assigning boundary-adjacent pixels based on
artifact colors from BFS wavefront collisions.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Spatial Mode Filter Post-Clustering

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:3150` (after Phase 2 BFS label propagation)

- [ ] **Step 1: Add spatial mode filter after Phase 2 BFS**

Insert after the Phase 2 BFS log line (line 3150, after `console.log(...BFS propagated...)`), before the K-means results logging:

```typescript
      // Spatial mode filter: clean up salt-and-pepper noise from BFS seams and line residue.
      // For each pixel, if the majority of its neighborhood has a different label AND the
      // pixel's color is reasonably close to the majority's centroid, relabel it.
      const MODE_R = pxS(5); // radius in pixels (8 at TW=800)
      let modeRelabeled = 0;
      const newLabels = new Uint8Array(pixelLabels); // copy — don't modify during iteration
      for (let i = 0; i < tp; i++) {
        if (!countryMask[i] || pixelLabels[i] === 255) continue;
        const ix = i % TW, iy = Math.floor(i / TW);
        const votes = new Map<number, number>();
        for (let dy = -MODE_R; dy <= MODE_R; dy++) {
          const ny = iy + dy;
          if (ny < 0 || ny >= TH) continue;
          for (let dx = -MODE_R; dx <= MODE_R; dx++) {
            const nx = ix + dx;
            if (nx < 0 || nx >= TW) continue;
            const ni = ny * TW + nx;
            if (pixelLabels[ni] !== 255) votes.set(pixelLabels[ni], (votes.get(pixelLabels[ni]) || 0) + 1);
          }
        }
        const myLabel = pixelLabels[i];
        let bestLabel = myLabel, bestCount = 0;
        for (const [lbl, cnt] of votes) {
          if (cnt > bestCount) { bestCount = cnt; bestLabel = lbl; }
        }
        if (bestLabel === myLabel) continue;
        // Guard: only relabel if pixel's color is close enough to majority centroid
        const nL = (labBuf[i * 3] - meanL) * wL;
        const nA = (labBuf[i * 3 + 1] - meanA) * wA;
        const nB = (labBuf[i * 3 + 2] - meanB) * wB;
        const distOwn = (nL - colorCentroids[myLabel][0]) ** 2 + (nA - colorCentroids[myLabel][1]) ** 2 + (nB - colorCentroids[myLabel][2]) ** 2;
        const distMaj = (nL - colorCentroids[bestLabel][0]) ** 2 + (nA - colorCentroids[bestLabel][1]) ** 2 + (nB - colorCentroids[bestLabel][2]) ** 2;
        if (distMaj < distOwn * 2.0) {
          newLabels[i] = bestLabel;
          modeRelabeled++;
        }
      }
      // Apply relabeling
      if (modeRelabeled > 0) {
        for (let i = 0; i < tp; i++) pixelLabels[i] = newLabels[i];
        // Recount
        clusterCounts.fill(0);
        for (let i = 0; i < tp; i++) {
          if (countryMask[i] && pixelLabels[i] < 255) clusterCounts[pixelLabels[i]]++;
        }
        console.log(`  [Mode filter] Relabeled ${modeRelabeled} noisy pixels to neighborhood majority`);
      }
```

Note: This uses `labBuf` and normalization weights (`meanL`, `wL`, etc.) from Task 1, and `colorCentroids` in normalized Lab space. The `labBuf` here is the one computed in Task 1 (after park inpainting), which is correct since this code runs after that conversion.

- [ ] **Step 2: Verify typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchController.ts
git commit -m "feat: spatial mode filter to clean noisy pixel labels

After K-means label assignment, run a single-pass spatial mode filter
that relabels isolated pixels to match their neighborhood majority when
the color distance permits. Removes salt-and-pepper noise from BFS
seams and line removal residue.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Typecheck + lint all Chunk 1 changes

- [ ] **Step 1: Run full checks**

```bash
cd /home/nikolay/projects/track-your-regions
npm run check
npm run knip
```

- [ ] **Step 2: Fix any issues**

Common issues to watch for:
- `labBuf` used in Task 4 must reference the one created in Task 1 (after park inpainting), not the `labBufEarly` from Task 3 (before water detection)
- `colorCentroids` in Task 4 is in normalized Lab space (from Task 1's K-means), which is correct since we compare against same-space centroids
- Unused variable `countryIndices` if nothing downstream uses it after the color space switch

---

## Chunk 2: Water + Background Improvements (Tasks 6–7)

### Task 6: Adaptive Water Detection Thresholds

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:1852-1876` (water detection section)

**Context:** The `passesWaterTier` function (line 1870) uses hardcoded HSV ranges. We add adaptive thresholds by sampling edge water pixels first. The HSV buffers `hsvClean` and `hsvOrig` are already available at this point.

- [ ] **Step 1: Sample water color from edge pixels**

Insert after the `hsvClean` buffer is created (after line 1859), before the `passesWaterTier` function definition:

```typescript
      // Adaptive water thresholds: sample edge pixels to find actual water color
      const edgeHsvSamples: Array<[number, number, number]> = [];
      for (let x = 0; x < TW; x++) {
        for (let band = 0; band < 5; band++) {
          for (const idx of [band * TW + x, (TH - 1 - band) * TW + x]) {
            const h = hsvClean[idx * 3], s = hsvClean[idx * 3 + 1], v = hsvClean[idx * 3 + 2];
            if (h >= 70 && h <= 140 && s > 8) edgeHsvSamples.push([h, s, v]);
          }
        }
      }
      for (let y = 0; y < TH; y++) {
        for (let band = 0; band < 5; band++) {
          for (const idx of [y * TW + band, y * TW + TW - 1 - band]) {
            const h = hsvClean[idx * 3], s = hsvClean[idx * 3 + 1], v = hsvClean[idx * 3 + 2];
            if (h >= 70 && h <= 140 && s > 8) edgeHsvSamples.push([h, s, v]);
          }
        }
      }
      const totalEdgePx = (TW + TH) * 2 * 5;
      const useAdaptiveWater = edgeHsvSamples.length > totalEdgePx * 0.03;
      let adaptiveH = 0, adaptiveS = 0, adaptiveV = 0;
      if (useAdaptiveWater) {
        edgeHsvSamples.sort((a, b) => a[0] - b[0]);
        adaptiveH = edgeHsvSamples[Math.floor(edgeHsvSamples.length / 2)][0];
        edgeHsvSamples.sort((a, b) => a[1] - b[1]);
        adaptiveS = edgeHsvSamples[Math.floor(edgeHsvSamples.length / 2)][1];
        edgeHsvSamples.sort((a, b) => a[2] - b[2]);
        adaptiveV = edgeHsvSamples[Math.floor(edgeHsvSamples.length / 2)][2];
        console.log(`  [Water] Adaptive: ${edgeHsvSamples.length} edge samples (${(edgeHsvSamples.length / totalEdgePx * 100).toFixed(1)}%), median HSV=(${adaptiveH},${adaptiveS},${adaptiveV})`);
      }
```

- [ ] **Step 2: Replace passesWaterTier with adaptive version**

Replace the `passesWaterTier` function (lines 1870–1876):

```typescript
      const passesWaterTier = (h: number, s: number, v: number, r: number, g: number, b: number): boolean => {
        if (useAdaptiveWater) {
          // Adaptive tiers centered on sampled water color
          // Tier 1 (vivid): tight hue, moderate S/V
          if (Math.abs(h - adaptiveH) <= 20 && s > adaptiveS * 0.5 && v > adaptiveV * 0.5 && b > g) return true;
          // Tier 2 (pale): wider hue, lower thresholds (min S floor prevents matching beige/sand)
          if (Math.abs(h - adaptiveH) <= 30 && s > Math.max(adaptiveS * 0.25, 8) && v > adaptiveV * 0.6) return true;
          return false;
        }
        // Fallback: hardcoded tiers (for landlocked countries with no edge water)
        if (h >= 90 && h <= 120 && s > 40 && v > 90 && b > g + 12) return true;
        if (h >= 80 && h <= 110 && s > 18 && s < 80 && v > 190 && b > r + 15) return true;
        return false;
      };
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchController.ts
git commit -m "feat: adaptive water detection from edge pixel sampling

Sample edge pixels with loose blue/cyan check. If >3% match, build
adaptive HSV tiers centered on the actual water color. Falls back to
hardcoded tiers for landlocked countries. Handles maps with non-standard
water colors (pale blue, teal, gray-blue).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Lab Distance for Background Detection

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:2388-2407` (foreground mask)

**Context:** The `labBufEarly` buffer from Task 3 is in scope here (computed after BFS text fill, before water detection). `buf` has not been modified since then (water detection operates on separate buffers). We use `labBufEarly` for per-pixel Lab values and convert the BG centroids to Lab.

- [ ] **Step 1: Convert BG centroids to Lab**

Insert right before the foreground mask loop (before line 2392), after `activeBg` is computed:

```typescript
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
```

- [ ] **Step 2: Replace RGB distance with chrominance-weighted Lab ΔE**

Replace the foreground mask loop (lines 2392–2407):

```typescript
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
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchController.ts
git commit -m "feat: chrominance-weighted Lab distance for BG detection

Replace RGB distance threshold with Lab ΔE using de-weighted luminance
(0.5) and full chrominance. Sandy/olive pixels close to gray in RGB but
with warm chrominance are now correctly kept as foreground.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Chunk 2 checks

- [ ] **Step 1: Run full checks**

```bash
cd /home/nikolay/projects/track-your-regions
npm run check
npm run knip
```

- [ ] **Step 2: Fix any issues**

Watch for: `labBufEarly` must be in scope at line 2392. It's defined in Task 3 after line 1849. The foreground mask is at line 2392. Both are inside the same `try` block in `colorMatchDivisionsSSE`, so scope is fine.

---

## Chunk 3: Retry/Re-cluster Mechanism (Tasks 9–11)

### Task 9: Backend — Extend ClusterReviewDecision + return recluster signal

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:118-123` (interface)
- Modify: `backend/src/controllers/admin/wvImportMatchShared.ts:521-563` (cluster review handler)
- Modify: `backend/src/types/index.ts` (Zod schema for cluster review POST body, if exists)

- [ ] **Step 1: Extend ClusterReviewDecision in controller**

At line 118-123 of `wvImportMatchController.ts`, add `recluster` field:

```typescript
interface ClusterReviewDecision {
  merges: Record<number, number>;
  excludes?: number[];
  /** If set, ignore merges/excludes and signal the controller to re-run K-means */
  recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' };
}
```

- [ ] **Step 2: Extend ClusterReviewDecision in shared file**

At line 521-524 of `wvImportMatchShared.ts`, add same field:

```typescript
      interface ClusterReviewDecision {
        merges: Record<number, number>;
        excludes?: number[];
        recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' };
      }
```

- [ ] **Step 3: Update route handler to pass recluster field**

The route handler at `backend/src/routes/adminRoutes.ts:415-430` manually destructures `merges` and `excludes` from `req.body` but does NOT pass `recluster`. Update it to extract and forward the field:

```typescript
  // After the existing merges/excludes extraction (line 423):
  const validPresets = new Set(['more_clusters', 'different_seed', 'boost_chroma']);
  const rawPreset = req.body?.recluster?.preset;
  const recluster = typeof rawPreset === 'string' && validPresets.has(rawPreset)
    ? { preset: rawPreset as 'more_clusters' | 'different_seed' | 'boost_chroma' }
    : undefined;
  console.log(`  [Cluster Review POST] reviewId=${reviewId} merges=${JSON.stringify(merges)} excludes=[${excludes}]${recluster ? ` recluster=${recluster.preset}` : ''}`);
  const found = resolveClusterReview(reviewId, { merges, excludes, recluster });
```

- [ ] **Step 4: Change `matchDivisionsFromClusters` return type**

Currently returns `Promise<void>`. Change to return a recluster signal when requested. In `wvImportMatchShared.ts`:

Change function signature (line 110):
```typescript
export interface ReclusterSignal {
  recluster: true;
  preset: 'more_clusters' | 'different_seed' | 'boost_chroma';
}

export async function matchDivisionsFromClusters(params: MatchDivisionsParams): Promise<ReclusterSignal | void> {
```

- [ ] **Step 5: Add recluster detection in cluster review handler**

In the cluster review section of `wvImportMatchShared.ts` (after line 534 where `decision` is received), add early return:

```typescript
      // Check for recluster request
      if (decision.recluster) {
        console.log(`  [Cluster Review] Recluster requested: ${decision.recluster.preset}`);
        return { recluster: true, preset: decision.recluster.preset };
      }
```

Insert this before the "Apply excludes" section (before line 536).

- [ ] **Step 6: Verify typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchController.ts backend/src/controllers/admin/wvImportMatchShared.ts backend/src/routes/adminRoutes.ts
git commit -m "feat: extend ClusterReviewDecision with recluster signal

Add optional recluster field to ClusterReviewDecision. When present,
matchDivisionsFromClusters returns a ReclusterSignal instead of running
the division-matching pipeline, allowing the controller to re-run
K-means with modified parameters.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Backend — Wrap K-means in retry loop

**Files:**
- Modify: `backend/src/controllers/admin/wvImportMatchController.ts:3054-3172` (K-means + shared call)

**Context:** Currently the K-means section runs once and calls `matchDivisionsFromClusters` which never returns a value. With Task 9's changes, it can return a `ReclusterSignal`. We wrap the K-means + shared call in a loop.

- [ ] **Step 1: Add recluster parameter state before K-means**

Insert before the K-means `await logStep` (line 3054):

```typescript
      // Recluster loop: re-run K-means with modified params when user requests
      let reclusterAttempt = 0;
      const MAX_RECLUSTER = 3;
      let ckOverride: number | null = null;
      let chromaBoost = 1.0; // multiplier for a*/b* weights
      let randomSeed = false;
```

- [ ] **Step 2: Wrap K-means through shared call in while loop**

The entire block from `await logStep('K-means color clustering...')` (line 3054) through `await matchDivisionsFromClusters(...)` (line 3163-3172) becomes the body of:

```typescript
      let reclusterResult: ReclusterSignal | void;
      do {
        // === K-means section (all existing code from line 3054-3172) ===
        // ... but with these modifications:
```

At the CK computation (line 3058), use override:
```typescript
        const CK = ckOverride ?? Math.max(8, Math.min(expectedRegionCount * 3, 32));
```

At the normalization weights (from Task 1), apply chromaBoost:
```typescript
        const wA = chromaBoost / stdA, wB = chromaBoost / stdB;
```

At the K-means++ init (from Task 2), use randomSeed for first centroid:
```typescript
        const firstIdx = randomSeed
          ? Math.floor(Math.random() * countryPixels.length)
          : Math.floor(countryPixels.length / 2);
        const colorCentroids: Array<[number, number, number]> = [countryPixels[firstIdx]];
```

At the end, capture the return value:
```typescript
        reclusterResult = await matchDivisionsFromClusters({ ... });

        // Handle recluster signal
        if (reclusterResult?.recluster) {
          reclusterAttempt++;
          if (reclusterAttempt >= MAX_RECLUSTER) {
            console.log(`  [Recluster] Max attempts (${MAX_RECLUSTER}) reached, proceeding with current clusters`);
            // Re-call with skipClusterReview: true — force proceed with last-computed clusters
            // Reconstruct params from current scope (not a `params` variable — these are individual vars)
            await matchDivisionsFromClusters({
              worldViewId, regionId, knownDivisionIds,
              buf, mapBuffer, countryMask, waterGrown, pixelLabels, colorCentroids: rgbCentroids,
              TW, TH, origW, origH,
              skipClusterReview: true,
              sendEvent: sendEvent as (event: Record<string, unknown>) => void,
              logStep, pushDebugImage, debugImages, startTime,
            });
            break;
          }
          const preset = reclusterResult.preset;
          if (preset === 'more_clusters') {
            const baseCK = ckOverride ?? Math.max(8, Math.min(expectedRegionCount * 3, 32));
            ckOverride = Math.min(baseCK + 4, 32);
            console.log(`  [Recluster] More clusters: CK → ${ckOverride}`);
          } else if (preset === 'different_seed') {
            randomSeed = true;
            console.log(`  [Recluster] Different seed: randomizing K-means++ init`);
          } else if (preset === 'boost_chroma') {
            chromaBoost = 1.5;
            console.log(`  [Recluster] Boost chroma: a*/b* weight → ${chromaBoost}`);
          }
          await logStep(`Re-clustering (attempt ${reclusterAttempt + 1})...`);
        }
      } while (reclusterResult?.recluster);
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchController.ts
git commit -m "feat: wrap K-means in recluster retry loop

When matchDivisionsFromClusters returns a recluster signal, re-run
K-means with modified parameters (more clusters, different seed, or
boosted chrominance weight). Max 3 retries, then force proceed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Frontend — Add re-cluster button to cluster review UI

**Files:**
- Modify: `frontend/src/api/adminWorldViewImport.ts:902-905` (extend type)
- Modify: `frontend/src/components/admin/WorldViewImportTree.tsx:2144-2167` (add button)

- [ ] **Step 1: Extend frontend ClusterReviewDecision type**

At line 902-905 of `adminWorldViewImport.ts`:

```typescript
export interface ClusterReviewDecision {
  merges: Record<number, number>;
  excludes?: number[];
  recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' };
}
```

- [ ] **Step 2: Add re-cluster buttons to cluster review UI**

In `WorldViewImportTree.tsx`, find the "Confirm clusters" button (line 2144-2167). Add re-cluster buttons right after it. The buttons send a `recluster` decision and reset the clusterReview state (the SSE stream will send a new `cluster_review` event after re-clustering):

```typescript
                    {/* Re-cluster options */}
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                      {[
                        { preset: 'more_clusters' as const, label: 'More clusters' },
                        { preset: 'different_seed' as const, label: 'Different seed' },
                        { preset: 'boost_chroma' as const, label: 'Boost colors' },
                      ].map(opt => (
                        <Button
                          key={opt.preset}
                          size="small"
                          variant="outlined"
                          color="warning"
                          sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75 }}
                          title={opt.label}
                          onClick={async () => {
                            setCVMatchDialog(prev => prev ? {
                              ...prev,
                              clusterReview: undefined,
                              progressText: `Re-clustering (${opt.label.toLowerCase()})...`,
                            } : prev);
                            try {
                              await respondToClusterReview(cr.reviewId, {
                                merges: {},
                                recluster: { preset: opt.preset },
                              });
                            } catch (e) {
                              console.error('[Recluster] POST failed:', e);
                            }
                          }}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </Box>
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `cd /home/nikolay/projects/track-your-regions && npm run check`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/adminWorldViewImport.ts frontend/src/components/admin/WorldViewImportTree.tsx
git commit -m "feat: add re-cluster buttons to cluster review UI

Three options: 'More clusters' (bumps K+4), 'Different seed'
(randomizes K-means++ init), 'Boost colors' (increases chrominance
weight to 1.5x). Sends recluster decision via existing review endpoint.
Pipeline re-runs K-means and sends new cluster_review SSE event.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Final Verification (Task 12)

### Task 12: Pre-commit checks + docs update

- [ ] **Step 1: Run all mandatory checks**

```bash
cd /home/nikolay/projects/track-your-regions
npm run check
npm run knip
npm run security:all
TEST_REPORT_LOCAL=1 npm test
```

Then run `/security-check` (Claude Code security review of changed files — required by CLAUDE.md).

- [ ] **Step 2: Update docs**

Update `docs/tech/planning/2026-03-12-cv-pipeline-quality-improvements.md` — change status from "Draft" to "Implemented".

- [ ] **Step 3: Manual verification**

Run the CV match pipeline on Morocco via the UI:
- Verify debug images show Lab color space in use
- Verify adaptive water detection log shows edge sampling
- Verify K-means++ init and convergence logging
- Verify cluster review shows re-cluster buttons
- Test each re-cluster preset (More clusters, Different seed, Boost colors)
- Accept final result and verify division assignments improve vs. pre-change

- [ ] **Step 4: Final commit for docs**

```bash
git add docs/tech/planning/2026-03-12-cv-pipeline-quality-improvements.md
git commit -m "docs: mark CV pipeline quality improvements as implemented

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
