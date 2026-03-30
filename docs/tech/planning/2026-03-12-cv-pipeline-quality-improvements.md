# CV Pipeline Quality Improvements — Design Spec

**Date**: 2026-03-12
**Status**: Implemented

## Problem

The auto CV match pipeline (`wvImportMatchController.ts`) produces poor results on maps with muted/pastel color palettes (e.g., Morocco). Three root causes:

1. **K-means in RGB space** — perceptually distinct colors cluster together, similar colors split apart
2. **Text removal residue** — BFS nearest-neighbor fill creates seam artifacts at region boundaries that K-means picks up as spurious clusters
3. **No recovery mechanism** — when clustering fails, the only option is to start over from scratch

## Improvements

Seven changes, ordered by impact. All modify the existing auto pipeline — no new endpoints or UI components except the re-cluster button.

---

### 1. CIELAB Color Space + Chromatic Stretching for K-means

**Impact: Critical** | ~30 lines changed

**Current**: K-means runs on raw RGB values. Euclidean distance in RGB does not correspond to perceptual color difference. Morocco's 8 pastel regions span ~30-40 RGB units — K-means cannot reliably separate them.

**Change**: Convert `colorBuf` to CIELAB before K-means. Apply per-channel z-score normalization to stretch whatever color variation exists. Weight channels: L×0.5, a\*×1.0, b\*×1.0 (de-emphasize luminance, boost chrominance).

**Implementation**:
- After the park inpainting stage, convert `buf` (which is `colorBuf`) to Lab via `cv.cvtColor(cvMat, labMat, cv.COLOR_RGB2Lab)`
- **OpenCV 8-bit Lab ranges**: L in [0, 255] (mapped from 0–100), a\* in [0, 255] (centered at 128), b\* in [0, 255] (centered at 128). All downstream thresholds and normalization must account for this scaling.
- Compute mean and stddev of L, a\*, b\* across country-mask non-text pixels
- **Stddev guard**: if σ < 0.01 on any channel, use σ = 1.0 (prevents division by zero when all pixels have the same value on a channel — e.g., monochromatic maps)
- Create normalized float arrays: `L' = (L - μ_L) / σ_L * 0.5`, `a' = (a - μ_a) / σ_a`, `b' = (b - μ_b) / σ_b`
- Run K-means on `[L', a', b']` Float64Array triples instead of `[R, G, B]` Uint8
- Store original Lab centroids (for debug viz, convert back to RGB via `cv.cvtColor(labMat, rgbMat, cv.COLOR_Lab2RGB)`)
- Label assignment (Phase 1) also uses normalized Lab distance

**Why Lab + normalization**: Lab distance ≈ perceptual difference. Normalization then amplifies whatever chromatic variation the map has — if all regions are within a 20-unit range of a\*, that range gets stretched to fill standard-deviation units. This is the user's "make colors more distinguishable" idea, formalized as the standard preprocessing step for color-based clustering.

**Files**: `wvImportMatchController.ts` — K-means section (lines 3054–3159)

---

### 2. Raise CK Cap + K-means++ Initialization

**Impact: High** | ~20 lines changed

**Current**: `CK = max(6, min(expectedRegionCount * 2, 16))`. Farthest-point initialization picks the most extreme outlier color as each new centroid.

**Change**:
- Raise cap: `CK = max(8, min(expectedRegionCount * 3, 32))`. Oversampling then merging (already done in shared pipeline) is safer than undersampling.
- Replace farthest-point with **K-means++**: sample each new centroid with probability proportional to D² (distance to nearest existing centroid). Same spread preference as farthest-point but probabilistic — outlier artifacts don't deterministically become centroids. If a sampled centroid is within ΔE < 2 of an existing centroid, resample (max 5 retries, then accept).
- Add convergence check: stop early if total centroid movement < 1.0 between iterations.

**Why**: For a 16-region country (e.g., Morocco), current CK = `min(16 * 2, 16)` = 16. That's exactly one cluster per region with zero margin for similar colors. Proposed: `min(16 * 3, 32)` = 32. K-means can use 2 clusters for each region, and the merge step consolidates them.

**Files**: `wvImportMatchController.ts` — K-means init + iteration loop (lines 3077–3109)

---

### 3. Spatial Mode Filter Post-Clustering

**Impact: Medium** | ~25 lines

**Current**: After label assignment, no spatial cleanup. Noisy single-pixel label assignments from BFS seams and line removal residue persist.

**Change**: After BFS label propagation (Phase 2), run a single-pass spatial mode filter:
- For each country-mask pixel, examine a `pxS(5)` × `pxS(5)` neighborhood (at TW=800, pxS(5)=8 → 8×8 = 64 neighbors per pixel)
- Count label frequencies among neighbors
- If the majority label differs from the pixel's label AND the pixel's normalized-Lab distance to the majority centroid is < 2× its distance to its own centroid, relabel it
- The 2× guard prevents forcibly relabeling pixels that genuinely belong to a different region (e.g., a thin coastal strip)

**Performance**: For a typical country with ~200k country-mask pixels at 800px width, this is ~12.8M neighbor lookups — comparable to the existing BFS operations and completes in <100ms. No sampling or striding needed.

**Why**: Standard post-processing for any pixel-level classification. Removes salt-and-pepper noise without destroying legitimate thin features.

**Files**: `wvImportMatchController.ts` — after Phase 2 BFS (lines 3131–3150)

---

### 4. Mark BFS Text-Fill Seam Pixels as Excluded

**Impact: Medium** | ~10 lines

**Current**: BFS fills each text pixel with the color of its SINGLE nearest non-text neighbor. Where two BFS wavefronts from different-colored regions meet, there's a hard color seam — an artifact that K-means can pick up.

**Change**: After BFS text fill, identify seam pixels: any filled pixel whose color differs significantly (Lab ΔE > 8, using OpenCV 8-bit Lab) from at least one filled 4-neighbor. Mark these as `textExcluded` so they get BFS-label-propagated (Phase 2) instead of color-assigned (Phase 1). The ΔE=8 threshold (in OpenCV's scaled Lab space where 1 unit ≈ 0.4 perceptual ΔE) catches boundary seams while ignoring gentle gradients within a single region. May need tuning for maps with very narrow color ranges.

**Why**: Seam pixels have unreliable colors — they're the last pixels filled when two wavefronts collide. By marking them for spatial label propagation, they inherit the label of their spatial neighborhood rather than being assigned by their artifact color.

**Files**: `wvImportMatchController.ts` — after BFS text fill block (lines 1829–1850)

---

### 5. Adaptive Water Detection Thresholds

**Impact: Medium** | ~30 lines

**Current**: `passesWaterTier` uses hardcoded HSV ranges: H∈[80,120], S>18-40, V>90-190. Only detects blue-to-cyan water. Maps with pale blue, teal, or gray-blue water may fail.

**Change**: Hardcoded tiers remain the primary water detector (reliable for standard Wikivoyage blue/teal). Edge sampling provides a tight RGB-proximity adaptive supplement:
- From the 5px edge band, find pixels with loose blue/cyan check: H∈[70,140], S>8 (OpenCV scale)
- If >3% of edge pixels match, compute their median H, S, V AND median R, G, B
- Add one tight adaptive tier using **RGB proximity** (not HSV): pixel distance to median edge RGB ≤ 35
- This catches water with unusual hue (e.g., teal where g > b) that hardcoded HSV tiers miss

**POC validation (Morocco)**: Morocco's ocean is teal RGB(131,207,202) with g > b, which breaks all HSV tier `b > g` checks. The original HSV-based adaptive supplement also failed because `b > g + 10` is false for teal. RGB proximity at threshold 35 catches ocean (distance 0 from edge median) while excluding green region RGB(66,180,121) at distance ~100. Final POC results: water 40.6%, country mask 24.1% (203K pixels), 5 major regions cleanly separated, yellow Rabat-Sale region preserved at 0.9%.

**Why**: Wikivoyage maps always show surrounding ocean at the image edges. By sampling the actual water color, we adapt to each map's palette instead of assuming standard blue.

**Edge case**: Landlocked countries (no ocean at edges). The 3% threshold handles this — if no blue pixels at edges, we fall back to hardcoded tiers. Landlocked countries typically have only rivers (caught by colored line removal) and small lakes (caught by current tiers).

**Files**: `wvImportMatchController.ts` — water detection section (lines 1852–1937)

---

### 6. Lab Distance for Background Detection

**Impact: Low-medium** | ~10 lines

**Current**: Background matching uses RGB distance threshold of 35. Sandy/olive country pixels can be confused with gray background in RGB space because RGB mixes luminance and chrominance.

**Change**: Convert BG centroids and test pixels to Lab (reuses the Lab buffer from improvement #1). Use chrominance-weighted ΔE that penalizes hue differences from neutral gray more than luminance differences.

**Proposed formula**: `ΔE_weighted = sqrt((ΔL * 0.5)² + Δa² + Δb²)`. Threshold: 12 (in OpenCV's 8-bit Lab space). This makes luminance-only differences (gray vs slightly-lighter gray) easy to match as BG, but any chrominance (a\* or b\* ≠ 128) increases the distance, keeping colored pixels as foreground.

**Why**: A gray background at RGB(200,200,200) maps to Lab≈(201,128,128) — perfectly neutral. A sandy region at RGB(210,195,175) maps to Lab≈(200,131,138) — similar luminance but with warm chrominance (a\*=131, b\*=138). Standard RGB distance = 27 < threshold 35 → incorrectly classified as background. With the weighted formula: ΔL=0.5, Δa=3, Δb=10 → ΔE_weighted = sqrt(0.0625 + 9 + 100) ≈ 10.4. The chrominance contribution (9 + 100 = 109) dominates over luminance (0.06), correctly identifying this as a colored pixel distinct from gray background.

**Files**: `wvImportMatchController.ts` — background detection section (lines 2388–2407)

---

### 7. Retry/Re-cluster Mechanism

**Impact: High (UX)** | ~120 lines backend + ~100 lines frontend

**Current**: The cluster review pause (`cluster_review` SSE event) allows merging small clusters and excluding artifact clusters. The existing `ClusterReviewDecision` interface is `{ merges: Record<number, number>; excludes?: number[] }`. There is no option to re-run clustering with different parameters.

**Change**: Add a "Re-cluster" response option to the existing cluster review:

**Backend — protocol change**:
- The `ClusterReviewDecision` interface (defined in both `wvImportMatchController.ts:118-123` and `wvImportMatchShared.ts:522-525`) currently has `merges` and `excludes` fields
- Add optional `recluster` field: `recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' }`
- When `recluster` is present, `merges` and `excludes` are ignored — the pipeline loops back to K-means

**Backend — retry loop**:
- The cluster review lives in `wvImportMatchShared.ts` (line 508+), but K-means runs in `wvImportMatchController.ts` (line 3054+). Re-clustering requires re-running K-means in the controller and re-calling `matchDivisionsFromClusters`.
- Restructure: wrap the K-means + `matchDivisionsFromClusters` call sequence in a `while` loop in the controller. `matchDivisionsFromClusters` returns a new signal when the user requests recluster (e.g., by returning `{ recluster: preset }` instead of `{ complete: data }`)
- On recluster, modify parameters and re-run:
  - `more_clusters`: CK += 4 (up to 32)
  - `different_seed`: randomize K-means++ seed (use `Math.random()` for initial centroid selection)
  - `boost_chroma`: increase a\*/b\* weight from 1.0 to 1.5 in the normalization
- Max 3 re-cluster attempts (tracked by counter), then force proceed

**Frontend**:
- The `ClusterReviewDecision` type in `adminWorldViewImport.ts:902-904` must also be extended
- The cluster review state/handler in `WorldViewImportTree.tsx` (lines 584-595) needs updating
- In the cluster review UI, add a "Re-cluster" dropdown button (MUI `ButtonGroup` + `Menu`) next to "Looks good":
  - "More clusters" — tells backend to use higher K
  - "Different seed" — different random initialization
  - "Boost color contrast" — increases chrominance weight
- After clicking, show a brief spinner while backend re-runs (reuse existing SSE progress display)

**State management**: All buffers needed for re-clustering (`colorBuf`/`buf`, `countryMask`, `textExcluded`, `waterGrown`) are still in scope in the controller at the point where `matchDivisionsFromClusters` is called — the enclosing function hasn't returned. The retry loop wraps around K-means → call shared → check result.

**Backward compatibility**: Existing frontend sending `{ merges, excludes }` without `recluster` field continues to work unchanged. The `recluster` field is optional.

**Files** (changes in all three):
- `wvImportMatchController.ts` — wrap K-means + shared call in retry loop
- `wvImportMatchShared.ts` — extend `ClusterReviewDecision`, return recluster signal
- `WorldViewImportTree.tsx` + `adminWorldViewImport.ts` — extend type, add re-cluster button

---

## Implementation Order

**Dependencies**: #1 (Lab conversion) is a prerequisite for #4 (seam marking uses Lab ΔE) and #6 (background detection uses Lab). #3 (mode filter) should follow #1/#2 since it operates on the improved clusters. #5 (water) is fully independent. #7 (retry) benefits from all prior improvements.

Recommended sequence:

1. **Lab + normalization** (#1) — biggest single improvement, foundation for #4 and #6
2. **CK cap + K-means++** (#2) — complements #1, no dependency
3. **BFS seam marking** (#4) — small change, requires Lab from #1 for ΔE check
4. **Spatial mode filter** (#3) — cleanup after improved clustering from #1/#2
5. **Adaptive water** (#5) — independent of clustering changes, can be done in any order
6. **Lab background** (#6) — reuses Lab conversion from #1
7. **Retry/re-cluster** (#7) — largest change, benefits from all prior improvements

## What We Don't Change

- Water review HITL — already works well, no changes needed
- Park detection + review — well-engineered, no changes needed
- ICP alignment — downstream of clustering, unaffected
- Division matching — downstream, benefits automatically from better clusters
- SSE streaming infrastructure — reused as-is
- Debug image output — existing debug images still generated, new ones added for Lab visualization

## Backward Compatibility

Improvements #1–#6 are purely internal processing changes. No SSE event formats, API contracts, or frontend interfaces change. The `complete` event payload remains identical. Frontend code consuming cluster previews, water review crops, park review crops, and geo previews is unaffected.

Improvement #7 extends the `ClusterReviewDecision` interface with an optional `recluster` field. Existing frontends that don't send this field continue to work — the backend treats missing `recluster` the same as before. The new "Re-cluster" button is additive UI.

## Testing

- Run Morocco through the improved pipeline — the motivating case
- Run Tanzania (known water detection edge case from 2026-03-09 plan)
- Run a country with many regions (e.g., France with 18+ regions) to test CK cap
- Run a country with parks (e.g., Kenya, Tanzania) to verify park detection still works
- Test re-cluster UI: trigger cluster review, click each preset, verify new clusters appear
