# ICP Adaptive Alignment — Design Spec

**Date**: 2026-03-27
**Status**: Approved

## Problem

When a GADM division includes distant small islands, the GADM bounding box is much larger than the land mass depicted on the Wikivoyage map. The CV pipeline's water detection, noise removal, and cluster cleanup strips these islands from the output, so the CV bbox covers only the mainland. The ICP alignment computes initial scale as `initSx = cvBboxWidth / gadmBboxWidth` — an inflated GADM bbox makes this scale too small. All three ICP options start from this scale and are constrained to ±10%, so they cannot recover from a fundamentally wrong starting point.

The result: GADM boundaries are projected too small and offset from the CV silhouette, producing poor division assignments.

## Design

### Detection (Dual Signal)

Two conditions must both be true to trigger the adjustment suggestion:

1. **Pre-ICP aspect ratio mismatch**: Compute `gadmRatio = gadmBboxWidth / gadmBboxHeight` and `cvRatio = cvBboxWidth / cvBboxHeight`. If `max(gadmRatio, cvRatio) / min(gadmRatio, cvRatio) > 1.4`, flag bbox inflation. This catches one axis being stretched by distant islands.

2. **Post-ICP overflow check**: After the standard ICP runs, if `bestOverflow > 0.12 * max(TW, TH)` (~96px at 800px working resolution), confirm the alignment actually failed.

Both must agree to avoid false positives — some countries are legitimately elongated (Chile, Norway) but ICP still works fine for them.

### Adjustment Strategies

When detection triggers, the system runs two strategies internally and picks the best result:

#### Strategy B — BBox Contribution Analysis

Directly targets the root cause: divisions that inflate the GADM bbox disproportionately.

1. Compute each division's bbox from its SVG path points (already parsed as `divPaths`)
2. Compute each division's area via shoelace formula on its SVG path points (no DB query needed — all geometry is already parsed)
3. Compute the "full" GADM bbox from all divisions
4. Iteratively find the division whose removal shrinks the GADM bbox the most (measured as reduction in bbox area)
5. **Area guard**: Never exclude a division with shoelace area > 10% of the sum of all division areas (prevents removing mainland provinces)
6. **Stop condition**: Remaining bbox aspect ratio is within 1.3× of the CV bbox aspect ratio, OR no division's removal would shrink the bbox by more than 5%
7. Override `gBbox` with the tighter bbox and re-run all 3 ICP options (A/B/C) with **relaxed scale constraint: ±25%** instead of ±10%. This is NOT a recursive call — the `alignDivisionsToImage` function gets a new optional parameter for bbox override + scale constraint range

#### Strategy C — CV-GADM Overlap Check

Uses the CV output as ground truth about what's actually depicted on the map.

1. Use the initial (bad) `gadmToPixel` transform to project each division's centroid into pixel space
2. Check if the projected centroid falls within the CV silhouette mask (`icpMask`)
3. Divisions whose centroid projects outside the mask (or outside the image entirely) are excluded
4. Recompute GADM bbox from remaining divisions
5. Override `gBbox` with the tighter bbox and re-run all 3 ICP options (A/B/C) with **relaxed scale constraint: ±25%**

#### Selection

- Run both strategies
- Compare their `overflow + meanError` against each other AND against the original ICP result
- Pick the best (lowest overflow, with meanError as tiebreak within 3px)
- If neither strategy improves on the original, keep the original (no harm done)

### Division Assignment

Excluded islands are still assigned in the division assignment phase — the `gadmToPixel` transform applies to all divisions. Islands that land off the CV image get `confidence = 0` or the existing water-masked fallback. This is unchanged from current behavior.

### UX Flow

The pipeline already streams progress via SSE and supports interactive review pauses (cluster review, water review). The adjustment reuses this pattern:

1. **ICP runs as normal** → produces result with overflow + error metrics
2. **Detection check runs** — instant computation, no user delay
3. **If triggered**: Pipeline sends a new SSE event type `icp_adjustment_available` with message:
   > "Alignment quality is lower than expected, possibly due to small islands or features not shown on the map."
4. **Frontend shows a banner** in the existing diagnostic image area with two buttons:
   - **"Adjust alignment"** — triggers the adjustment
   - **"Continue anyway"** — uses original ICP result
5. **Pipeline pauses** (same mechanism as cluster review — waits for user decision via POST endpoint)
6. **On "Adjust"**: Backend runs both strategies, picks best, updates `gadmToPixel` transform
7. **New diagnostic images pushed** via SSE — user sees updated ICP bbox overlay + division overlay
8. **Debug log** records: which divisions were excluded, which strategy won, before/after overflow + meanError
9. **Pipeline continues** to division assignment with the adjusted (or original) transform

### What Doesn't Change

- All 3 existing ICP options (A/B/C) still run — adjustment fixes the input bbox, then ICP runs again with all 3
- No new API endpoints — reuses SSE pause/resume pattern from cluster review
- Debug images keep the same format; new ones show the adjusted overlay
- Technical details (excluded divisions, before/after metrics) go to `console.log` debug stream only
- The `ClusterReviewDecision` interface and cluster review flow are unaffected

## Files to Modify

### Backend

- **`wvImportMatchIcp.ts`** — Main changes:
  - Add detection logic (aspect ratio + overflow check) after current ICP runs
  - Add `computeDivisionBboxes()` helper for Strategy B
  - Add `findBboxOutliers()` (iterative removal with area guard + stop condition)
  - Add `findOverlapOutliers()` (centroid projection + mask check) for Strategy C
  - Add `runAdjustedIcp()` wrapper that tries both strategies and picks best
  - Export new `AdjustmentResult` type with excluded divisions + strategy label
  - Relaxed scale constraint parameter (±25%) passed into ICP options when adjusting

- **`wvImportMatchShared.ts`** — SSE orchestration:
  - Add `icp_adjustment_available` SSE event type after ICP completes
  - Add pause/resume handler for adjustment decision (same pattern as `cluster_review`)
  - Wire up the adjustment result back to the pipeline flow

- **`wvImportMatchPipeline.ts`** — Pipeline flow:
  - After ICP alignment, check if adjustment was triggered
  - If so, pause for user decision, then run adjustment or continue

### Frontend

- **`useCvMatchPipeline.ts`** — SSE handling:
  - Handle new `icp_adjustment_available` event type
  - Track adjustment state (available / in-progress / completed / skipped)

- **`CvMatchDialog.tsx`** (or new `CvIcpAdjustmentSection.tsx`):
  - Render adjustment banner with message + buttons when state is `available`
  - Send decision back to backend via POST
  - Show updated diagnostic images after adjustment completes

## Backward Compatibility

- The `icp_adjustment_available` event is new — old frontends that don't handle it will simply never see the banner. The pipeline will continue after a timeout (same pattern as other review steps).
- No changes to the `complete` event payload or division assignment API.
- The adjustment is purely additive — maps that don't trigger detection behave identically to before.

## Testing

- **Island country**: Run a country with distant islands (e.g., France with overseas territories, Portugal with Azores/Madeira, Spain with Canary Islands) — should trigger detection and improve alignment
- **Normal country**: Run a compact country (e.g., Switzerland, Czech Republic) — should NOT trigger detection, zero behavior change
- **Elongated country**: Run Chile or Norway — aspect ratio mismatch might flag but overflow should be low, so detection should NOT trigger (dual signal prevents false positive)
- **Verify division assignment**: Excluded islands should still appear in the assignment results with confidence=0
- **"Continue anyway"**: Verify clicking it proceeds with original ICP, no regression
