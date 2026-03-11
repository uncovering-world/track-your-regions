# Guided CV Match — Design Spec

**Date**: 2026-03-11
**Status**: Implemented

## Overview

Add a "Guided CV Match" feature alongside the existing auto CV match. The user manually clicks on the Wikivoyage map image to identify water, parks, and region colors. The backend uses these seed points for simple color-distance clustering, then joins the existing division-matching pipeline for geo preview and assignment.

## Frontend Flow

### New Button
- Target/crosshair icon in `TreeNodeActions`, next to existing palette CV match button
- Same visibility condition: `hasChildren && regionMapUrl`
- Tooltip: "Guided CV Match"
- New `onGuidedCVMatch` callback prop added to `TreeNodeActionsProps`

### GuidedCvMatchDialog (new component)

Single dialog with a clickable canvas showing the Wikivoyage map image. Three sequential steps:

**Step 1 — Water**
- Banner: "Click on water/ocean areas"
- User clicks on map → blue dots appear at click positions
- Multiple clicks allowed (ocean, lakes, rivers)
- Buttons: "Done" (proceed) / "No water" (skip, set empty water seeds)

**Step 2 — Parks** (optional)
- Banner: "Click on park overlays (dark green areas)"
- User clicks → green dots appear
- Buttons: "Skip" (no parks) / "Done" (proceed)

**Step 3 — Regions**
- Iterates through child regions one at a time
- Banner: **"Click on \<Region Name\>"** (bold region name)
- User clicks → labeled colored dot appears on map
- Auto-advances to next region after click
- Progress indicator: "3/12 regions marked"
- "Undo last" button removes last dot and goes back one region. At first region (index 0), undo removes the dot but stays at region 0 (does not go back to Parks step).
- After all regions clicked → "Start Matching" button appears

**After submission**:
- Dialog transitions to progress view (reuse existing progress display pattern)
- SSE streams progress events
- On complete → renders existing `CvMatchMap` component with geo preview
- Same paint mode, same assignment flow as current auto CV match

### Canvas Interaction Details
- Map image loaded as `<img>` inside a positioned container
- Click coordinates use `img.naturalWidth` / `img.naturalHeight` (the actual fetched image dimensions, NOT CSS `clientWidth`/`clientHeight`) to normalize click positions to original image pixel space. This matches what the backend gets when it downloads the same URL via `sharp().metadata()`.
- Dots rendered as absolutely-positioned colored circles with labels
- Seed points stored in component state: `{ waterPoints: Point[], parkPoints: Point[], regionSeeds: RegionSeed[] }`
- `Point = { x: number, y: number }` — coordinates in original image pixel space
- `RegionSeed = { x: number, y: number, regionId: number, regionName: string }`

## Backend

### Two-Step Handshake (POST prepare → GET SSE stream)

Seed data can be large (~50+ seeds with coordinates). URL length limits make query params unreliable. Use the same pattern as water/park review responses:

**Step 1**: `POST /api/admin/wv-import/matches/:worldViewId/guided-match-prepare`
- Body: `{ regionId, seeds: { waterPoints, parkPoints, regionSeeds } }`
- Validates seed coordinates are within bounds (0 ≤ x < imageWidth, 0 ≤ y < imageHeight) — downloads image to check dimensions. Stores seeds in an in-memory Map keyed by `sessionId` (UUID).
- Returns: `{ sessionId: string }`

**Step 2**: `GET /api/admin/wv-import/matches/:worldViewId/guided-match-stream?sessionId=<id>&token=<jwt>`
- Retrieves seeds from in-memory Map by `sessionId` (one-time use, deleted after retrieval)
- Opens SSE stream, runs the guided pipeline

**Zod validation**: Schema for POST body with coordinate arrays and regionId references.

### Processing Pipeline

1. **Download + downscale** map image to working resolution (same `TW`/`TH` as current pipeline)
2. **Validate + scale seed coordinates** from original image space to working resolution: `sx = Math.round(x * TW / origW)`, `sy = Math.round(y * TH / origH)`. Reject any seed where `sx >= TW || sy >= TH` with an error SSE event.
3. **Sample RGB** at each scaled seed pixel coordinate from the downscaled image buffer
4. **Water mask**: For each pixel, check color distance to any water seed color. Pixel is water if `min_RGB_distance < threshold` (tunable, ~40). Morphological close to fill gaps. Connected components to keep only large water bodies.
5. **Park mask**: Same approach with park seed colors. Inpaint park areas with boundary colors using existing BFS boundary-fill logic.
6. **Country mask**: Everything that's not water and not image background (use existing edge-sampling bg detection — this is reliable and doesn't depend on text removal)
7. **Region clustering**:
   - Use region seed colors as initial K-means centroids (CK = exact number of region seeds)
   - Assign every country-mask pixel to nearest seed color (Euclidean RGB distance)
   - Run 5-10 K-means iterations to refine centroids
   - No guessing of cluster count — user defined it exactly
8. **Fetch child regions** from DB: `SELECT id, name FROM regions WHERE parent_region_id = $1 AND world_view_id = $2` (same query as auto pipeline)
9. **Call shared `matchDivisionsFromClusters`**: Feed `countryMask`, `pixelLabels`, `colorCentroids`, `waterGrown`, `childRegions` into shared function for spatial-split → merge → division geo-matching → geo preview
10. **SSE events**: Same format as current — `progress`, `debug_image`, `complete`

### No HITL Review Steps
Unlike the auto pipeline, the guided pipeline has NO water_review, park_review, or cluster_review pauses. The user already provided all this information via clicks. The pipeline runs straight through to `complete`. The shared `matchDivisionsFromClusters` function takes a `skipClusterReview: boolean` parameter to conditionally bypass the cluster review pause.

### Shared Logic Extraction
Extract the division-matching phase from `wvImportMatchController.ts` into a shared function that both `colorMatchDivisionsSSE` (auto) and `guidedMatchDivisionsSSE` (guided) can call:

```typescript
async function matchDivisionsFromClusters(params: {
  worldViewId: number;
  regionId: number;
  buf: Buffer;              // working image (for debug viz)
  countryMask: Uint8Array;
  waterGrown: Uint8Array;
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number]>;
  // clusterCounts computed internally from pixelLabels (not passed in,
  // because spatial split changes label indices)
  TW: number; TH: number;
  origW: number; origH: number;
  skipClusterReview: boolean;
  sendEvent: (event: SSEEvent) => void;
  logStep: (msg: string) => Promise<void>;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
}): Promise<CompleteEventData>
```

This function:
- Computes `clusterCounts` from `pixelLabels` internally
- Loads `divPaths` and country boundary SVG from DB (not passed as params)
- Fetches `childRegions` from DB
- Runs: spatial split → cluster merge → division geo-matching → unsplittable detection → out-of-bounds handling → geo preview generation
- Conditionally skips cluster review when `skipClusterReview = true`

## Files to Create/Modify

| File | Change |
|------|--------|
| `frontend/src/components/admin/GuidedCvMatchDialog.tsx` | **New** — clickable canvas wizard with 3 steps |
| `frontend/src/components/admin/TreeNodeActions.tsx` | Add guided match button + `onGuidedCVMatch` prop |
| `frontend/src/components/admin/WorldViewImportTree.tsx` | Add `handleGuidedMatch` handler, dialog open/close state |
| `frontend/src/api/adminWorldViewImport.ts` | Add `prepareGuidedMatch()` POST + `guidedMatchWithProgress()` SSE client |
| `backend/src/controllers/admin/wvImportMatchController.ts` | Add `prepareGuidedMatch` + `guidedMatchDivisionsSSE` handlers; extract shared `matchDivisionsFromClusters` |
| `backend/src/routes/adminRoutes.ts` | Register new POST + GET endpoints with Zod schemas |
| `backend/src/types/index.ts` | Add Zod schemas for guided match body + query params |

## What We Skip (vs Auto Pipeline)

- No text detection (Black Hat morphology)
- No text inpainting (Telea)
- No bilateral/median/mean-shift filtering for color
- No multi-signal water voting
- No park overlay detection
- No cluster review HITL
- No water review HITL
- No park review HITL

## What We Reuse

- Map download + downscale
- Background detection (edge-sampling)
- Morphological operations for mask cleanup
- Spatial split (break large clusters into disconnected regions)
- Division geo-matching (centroid-based)
- Unsplittable detection
- Out-of-bounds handling
- Geo preview generation (GeoJSON + cluster info)
- `CvMatchMap` component (paint mode, assignment)
- SSE streaming infrastructure
- `acceptBatchMatches` API for persisting assignments
