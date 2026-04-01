# CV Pipeline Refactor — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `wvImportMatchController.ts` (3,622 lines) into focused files under 1,000 lines each, using a shared `PipelineContext` object to pass state between phases.

**Architecture:** Extract the 2,282-line `colorMatchDivisionsSSE()` function into a thin orchestrator that calls phase functions. Each phase receives and mutates a `PipelineContext` that holds all shared buffers, masks, and helpers. Review state, CRUD routes, and helpers also move to their own files.

**Tech Stack:** TypeScript, OpenCV WASM, sharp

---

## File Structure

All files live in `backend/src/controllers/admin/`:

| File | Responsibility | Est. lines |
|------|---------------|------------|
| `wvImportMatchController.ts` | CRUD routes + geometry + AI match + barrel exports | ~700 |
| `wvImportMatchPipeline.ts` | OpenCV init + `PipelineContext` type + `colorMatchDivisionsSSE` orchestrator | ~550 |
| `wvImportMatchText.ts` | Text/symbol detection (BlackHat + dark spots) | ~120 |
| `wvImportMatchWater.ts` | Water detection + component splitting + user review | ~550 |
| `wvImportMatchBackground.ts` | BG detection, foreground mask, country mask, saturation refinement | ~550 |
| `wvImportMatchParks.ts` | Park overlay detection + review + inpainting | ~420 |
| `wvImportMatchCluster.ts` | Lab conversion, K-means++, label assignment, mode filter | ~250 |
| `wvImportMatchReview.ts` | Review types, pending maps, resolve/get functions, storage | ~150 |
| `wvImportMatchHelpers.ts` | `rgbToHsl`, `replaceWithNeighborMedian`, `minRunLength`, `removeColoredLines`, `generateDivisionsSvg`, `fetchMarkersForDivisions`, `cvMorphOp`, `generateOutlineCrop` | ~300 |

### `PipelineContext` — the shared state object

Every phase function signature: `async function phaseXxx(ctx: PipelineContext): Promise<void>`

```typescript
export interface PipelineContext {
  // --- Inputs (set by orchestrator before first phase) ---
  cv: any;                          // OpenCV WASM instance
  regionId: number;
  worldViewId: number;
  regionName: string;
  knownDivisionIds: Set<number>;
  expectedRegionCount: number;
  assignedMap: Map<number, { regionId: number; regionName: string }>;
  mapBuffer: Buffer;                // original image bytes

  // --- Image dimensions ---
  TW: number;                       // target width (800)
  TH: number;                       // target height (proportional)
  tp: number;                       // TW * TH
  origW: number;                    // original image width
  origH: number;                    // original image height
  RES_SCALE: number;                // TW / 500

  // --- Pixel buffers (set during noise removal) ---
  origDownBuf: Buffer;              // clean Lanczos3 downscale (no processing)
  rawBuf: Buffer;                   // median(5) + line removal
  colorBuf: Buffer;                 // origDownBuf + line removal (no text removal)
  // NOTE: no separate `buf` alias — all phases use `colorBuf` directly

  // --- Derived buffers (set during various phases) ---
  hsvSharp: Buffer;                 // HSV of rawBuf
  labBufEarly: Buffer;              // Lab of colorBuf (for BG detection)
  hsvBuf: Buffer;                   // HSV of colorBuf (for foreground detection)
  inpaintedBuf: Buffer | null;      // Telea-inpainted rawBuf — set by text phase, consumed
                                    // by water phase, then set to null to free ~1.9MB

  // --- Masks (built up across phases) ---
  textExcluded: Uint8Array;         // text pixels (excluded from K-means)
  waterGrown: Uint8Array;           // dilated water mask
  countryMask: Uint8Array;          // foreground country pixels
  countrySize: number;              // count of country mask pixels
  coastalBand: Uint8Array;          // land pixels adjacent to water

  // --- K-means state (set by cluster phase) ---
  pixelLabels: Uint8Array;          // per-pixel cluster label
  colorCentroids: Array<[number, number, number]>;  // RGB centroids
  clusterCounts: number[];

  // --- Recluster params (mutated by orchestrator loop) ---
  ckOverride: number | null;
  chromaBoost: number;
  randomSeed: boolean;

  // --- SSE / debug helpers (set by orchestrator) ---
  sendEvent: (event: Record<string, unknown>) => void;
  logStep: (step: string) => Promise<void>;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;

  // --- Utility functions (set by orchestrator, depend on TW/RES_SCALE) ---
  oddK: (base: number) => number;   // scale + ensure odd
  pxS: (base: number) => number;    // scale pixel constant
}
```

---

## Task 1: Create review state module

**Files:**
- Create: `wvImportMatchReview.ts`
- Modify: `wvImportMatchController.ts` (remove review code, add re-exports)
- Modify: `wvImportMatchShared.ts` (update import source)

Extract lines 42–141 from the controller:
- `WaterReviewDecision`, `ParkReviewDecision`, `ClusterReviewDecision` interfaces
- All 6 pending Maps + their resolve/get/store functions
- The 2 exported const Maps (`pendingClusterReviews`, `clusterPreviewImages`)

- [ ] **Step 1: Create `wvImportMatchReview.ts`** — copy types, maps, and all 8 functions. Export `storeWaterCrops` and `storeParkCrops` (needed by water/park phases). Keep the underlying Maps (`waterCropImages`, `parkCropImages`) private (module-scoped).
- [ ] **Step 2: Update `wvImportMatchShared.ts`** — change import from `./wvImportMatchController.js` to `./wvImportMatchReview.js`
- [ ] **Step 3: Update `wvImportMatchController.ts`** — remove lines 42–141, add `export { ... } from './wvImportMatchReview.js'` for all 6 exports consumed by `adminRoutes.ts`
- **Guardrail:** The review module must NEVER import from any phase module (water, parks, etc.) to prevent circular dependencies.
- [ ] **Step 4: Run `npm run check`** — verify no type errors
- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/admin/wvImportMatchReview.ts \
      backend/src/controllers/admin/wvImportMatchController.ts \
      backend/src/controllers/admin/wvImportMatchShared.ts
git commit -m "refactor: extract review state to wvImportMatchReview.ts"
```

---

## Task 2: Create helpers module

**Files:**
- Create: `wvImportMatchHelpers.ts`
- Modify: `wvImportMatchController.ts` (remove helper code, import from new file)

Extract lines 154–411 from the controller:
- `rgbToHsl`, `replaceWithNeighborMedian`, `minRunLength`, `removeColoredLines`
- `PointInfo`, `SvgDivision` types
- `generateDivisionsSvg`, `fetchMarkersForDivisions`

Also extract the `cvMorphOp` closure (lines 2560–2568) and `generateOutlineCrop` (lines 2148–2198) — these are currently closures inside `colorMatchDivisionsSSE` that capture local variables. Refactor:
- `cvMorphOp(cv, mask, w, h, op, kernelSize)` — lightweight, takes explicit params
- `generateOutlineCrop(ctx, pixelTest, cx, cy, bw, bh)` — needs `origDownBuf`, `TW`, `TH`, sharp

- [ ] **Step 1: Create `wvImportMatchHelpers.ts`** — move all helper functions, making `cvMorphOp` and `generateOutlineCrop` accept explicit params instead of closure captures
- [ ] **Step 2: Update `wvImportMatchController.ts`** — remove extracted code, add imports from new file
- [ ] **Step 3: Run `npm run check`**
- [ ] **Step 4: Commit**

---

## Task 3: Create PipelineContext type + orchestrator skeleton

**Files:**
- Create: `wvImportMatchPipeline.ts`
- Modify: `wvImportMatchController.ts` (replace `colorMatchDivisionsSSE` body with delegation)

- [ ] **Step 1: Create `wvImportMatchPipeline.ts`** with:
  - OpenCV WASM init block (moved from controller lines 16–41)
  - `PipelineContext` interface (as designed above)
  - `colorMatchDivisionsSSE` function — SSE setup, data prep (lines 1340–1718), phase calls, recluster loop
  - Data-prep vars (`divPaths`, `centroids`, `divNameMap`, `allDivisionIds`) stay local in orchestrator — passed directly to `matchDivisionsFromClusters`, not on PipelineContext
  - `pushDebugImage` closure captures `debugSlug`/`debugIdx` internally — no need to expose these on ctx
  - Replace all `buf` references with `colorBuf`
- [ ] **Step 2: Update controller** — remove OpenCV init, `colorMatchDivisionsSSE` re-exported from pipeline module
- [ ] **Step 3: Run `npm run check`**
- [ ] **Step 4: Commit**

---

## Task 4: Extract text detection phase

**Files:**
- Create: `wvImportMatchText.ts`
- Modify: `wvImportMatchPipeline.ts` (call text phase)

Extract lines 1728–1826 into `detectText(ctx: PipelineContext)`:
- BlackHat morphology on rawBuf
- Dark spot connected components
- Dilation → `textExcluded` array
- Ocean buffer + Telea inpaint (produces `inpaintedBuf` for water phase)
- Lab conversion for early BG detection (`labBufEarly`)
- Debug: text mask image

Sets on ctx: `textExcluded`, `hsvSharp`, `inpaintedBuf` (non-null), `labBufEarly`

- [ ] **Step 1: Create `wvImportMatchText.ts`** with `detectText(ctx)` function
- [ ] **Step 2: Update pipeline orchestrator** to call `detectText(ctx)`
- [ ] **Step 3: Run `npm run check`**
- [ ] **Step 4: Commit**

---

## Task 5: Extract water detection phase

**Files:**
- Create: `wvImportMatchWater.ts`
- Modify: `wvImportMatchPipeline.ts` (call water phase)

Extract lines 1827–2433 into `detectWater(ctx: PipelineContext)`:
- Adaptive edge sampling
- Multi-signal voting (A/B/C)
- Connected components + split at narrow necks
- Crop generation (uses `generateOutlineCrop` from helpers)
- Interactive water review (uses review maps from review module)
- Water mask rebuild after review
- Dilate → `waterGrown`

Sets on ctx: `waterGrown`. Also sets `ctx.inpaintedBuf = null` when done to free memory.

Note: extensive local state (`savedWaterLabels`, `compSubCentroids`, `waterComponents`, `waterMask`) is internal to this phase — do NOT put on PipelineContext.

- [ ] **Step 1: Create `wvImportMatchWater.ts`** with `detectWater(ctx)` function (imports `storeWaterCrops` from review module)
- [ ] **Step 2: Update pipeline orchestrator**
- [ ] **Step 3: Run `npm run check`**
- [ ] **Step 4: Commit**

---

## Task 6: Extract background/foreground detection phase

**Files:**
- Create: `wvImportMatchBackground.ts`
- Modify: `wvImportMatchPipeline.ts` (call background phase)

Extract lines 2435–2901 into `detectBackground(ctx: PipelineContext)`:
- Edge K-means for BG colors
- Lab-weighted BG detection
- Coastal band computation
- Foreground mask (with forced-foreground signals)
- Gaussian smooth + morphological close
- Connected components → country silhouette
- Interior hole fill
- Foreign land removal
- Thin line opening
- Saturation refinement (Otsu)
- Country mask debug image

Sets on ctx: `countryMask`, `countrySize`, `coastalBand`, `hsvBuf`

- [ ] **Step 1: Create `wvImportMatchBackground.ts`** with `detectBackground(ctx)` function
- [ ] **Step 2: Update pipeline orchestrator**
- [ ] **Step 3: Run `npm run check`**
- [ ] **Step 4: Commit**

---

## Task 7: Extract park detection phase

**Files:**
- Create: `wvImportMatchParks.ts`
- Modify: `wvImportMatchPipeline.ts` (call parks phase)

Extract lines 2902–3321 into `detectParks(ctx: PipelineContext)`:
- Dark-saturated-green candidate detection
- Morphological close + connected components
- Boundary contrast check
- Interactive park review
- 3-pass inpainting (BFS fill + remnant cleanup + harmonize)
- Debug images

Mutates ctx: `colorBuf` (park pixels replaced with boundary colors)

- [ ] **Step 1: Create `wvImportMatchParks.ts`** with `detectParks(ctx)` function
- [ ] **Step 2: Update pipeline orchestrator**
- [ ] **Step 3: Run `npm run check`**
- [ ] **Step 4: Commit**

---

## Task 8: Extract K-means clustering phase

**Files:**
- Create: `wvImportMatchCluster.ts`
- Modify: `wvImportMatchPipeline.ts` (call cluster phase in recluster loop)

Extract lines 3323–3557 into `runKMeansClustering(ctx: PipelineContext)`:
- Lab conversion + z-score normalization
- K-means++ initialization (with random seed support)
- K-means iteration with convergence check
- Centroid conversion (normalized Lab → RGB)
- Phase 1: color-based label assignment
- Phase 2: BFS propagation into text gaps
- Spatial mode filter

The recluster loop stays in the orchestrator — it calls `runKMeansClustering(ctx)` repeatedly, adjusting `ctx.ckOverride`/`ctx.chromaBoost`/`ctx.randomSeed` between iterations.

Sets on ctx: `pixelLabels`, `colorCentroids`, `clusterCounts`

- [ ] **Step 1: Create `wvImportMatchCluster.ts`** with `runKMeansClustering(ctx)` function
- [ ] **Step 2: Update pipeline orchestrator** — recluster loop calls `runKMeansClustering(ctx)` + `matchDivisionsFromClusters()`
- [ ] **Step 3: Run `npm run check`**
- [ ] **Step 4: Commit**

---

## Task 9: Clean up controller — CRUD only

**Files:**
- Modify: `wvImportMatchController.ts`

After all extractions, the controller should contain only:
- Imports from the new modules
- CRUD route handlers (lines 412–986): `getMatchStats`, `acceptMatch`, `rejectMatch`, `rejectRemaining`, `clearMembers`, `acceptAndRejectRest`, `acceptBatchMatches`, `getMatchTree`, `selectMapImage`, `markManualFix`
- Geometry functions (lines 1012–1266): `getUnionGeometry`, `splitDivisionsDeeper`
- AI match (lines 1267–1339): `visionMatchDivisions`
- Re-exports for `adminRoutes.ts` (review functions, `colorMatchDivisionsSSE`)

- [ ] **Step 1: Verify all re-exports match what `adminRoutes.ts` imports**
- [ ] **Step 2: Remove any dead imports/code from controller**
- [ ] **Step 3: Run `npm run check`**
- [ ] **Step 4: Run `npm run knip`** — verify no unused exports
- [ ] **Step 5: Run `TEST_REPORT_LOCAL=1 npm test`**
- [ ] **Step 6: Run `npm run security:all`**
- [ ] **Step 7: Commit**

---

## Task 10: Final verification

- [ ] **Step 1: Verify no file exceeds 1,000 lines** — `wc -l backend/src/controllers/admin/wvImportMatch*.ts`
- [ ] **Step 2: Run full pre-commit suite** — check, knip, test, security
- [ ] **Step 3: Manually trigger pipeline on a test region** — verify SSE events, debug images, and clustering all work identically to before
