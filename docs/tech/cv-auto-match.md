# CV Auto-Match Pipeline

Automatically matches Wikivoyage map images to GADM administrative divisions using computer vision. Given a region's map image (color-coded by subdivision), the pipeline extracts color clusters, aligns them to known division geometries, and produces division-to-cluster assignments for admin review.

## Pipeline Architecture

The pipeline runs server-side as an SSE stream (`colorMatchDivisionsSSE`), sending progress events, debug images, and interactive review pause points to the frontend in real time.

The pipeline has two phases: preprocessing and post-clustering.

### Preprocessing

1. **Mean-shift filtering** — Edge-preserving color smoothing to clean noise, gradients, and thin features (roads, borders) while preserving solid region color boundaries
2. **K-means clustering** — CIELAB K-means++ on the filtered image to identify subdivision color groups

### Post-Clustering

3. **Cluster cleanup** — Spatial split (connected components), merge (similar small clusters), noise removal
4. **Interactive cluster review** — SSE pause point for admin to approve/reject/merge clusters, or manually paint cluster boundaries using the canvas editor
5. **ICP alignment** — Aligns division geometries to image space (3 approaches: centroid, boundary, hybrid)
6. **Division assignment** — Rasterizes divisions onto the image and matches to clusters by pixel overlap
7. **Result assembly** — Returns division-to-cluster mappings with confidence scores

## Module Organization

All backend modules live in `backend/src/controllers/admin/`:

| Module | Responsibility |
|--------|---------------|
| `wvImportMatchPipeline.ts` | **Orchestrator.** OpenCV WASM loading (cached on `globalThis`), `PipelineContext` type, SSE setup, phase sequencing. Entry point: `colorMatchDivisionsSSE()` |
| `wvImportMatchMeanshift.ts` | **Mean-shift preprocessing.** Edge-preserving color smoothing to clean noise while preserving region boundaries |
| `wvImportMatchCluster.ts` | **K-means clustering.** CIELAB K-means++ with configurable cluster count and chroma boost |
| `wvImportMatchHelpers.ts` | **Pixel utilities.** Color space conversions, line removal, shared low-level helpers |
| `wvImportMatchShared.ts` | **Division matching orchestrator.** Coordinates post-clustering phases: cleanup, review, ICP, assignment, result assembly |
| `wvImportMatchClusterClean.ts` | **Cluster cleanup.** Connected-component spatial splitting, small cluster merging, noise removal |
| `wvImportMatchIcp.ts` | **ICP alignment.** Three alignment approaches (centroid-based, boundary-based, hybrid) to map division geometries onto image coordinates |
| `wvImportMatchAssignment.ts` | **Division assignment.** Rasterizes division polygons and matches to clusters by pixel overlap percentage |
| `wvImportMatchReview.ts` | **Review state.** In-memory pending review callbacks and crop image storage. Leaf dependency (never imports phase modules) |
| `wvImportMatchSvgHelpers.ts` | **SVG parsing.** SVG path `d` attribute parsing and point resampling for geometry alignment |

## PipelineContext

The orchestrator creates a `PipelineContext` struct that flows through all phases. It carries:

- **Inputs** — OpenCV instance, region/world-view IDs, division set, raw image buffer
- **Image dimensions** — target width/height, padding, original dimensions, resolution scale
- **Pixel buffers** — original downsampled, cleaned color, HSV, CIELAB, inpainted
- **Masks** — text-excluded, water-grown, country mask, coastal band (accumulated across phases)
- **K-means state** — pixel labels, color centroids, cluster counts
- **SSE helpers** — `sendEvent()`, `logStep()`, `pushDebugImage()` for streaming progress to the client

## Cluster Review UI

The frontend (`CvMatchDialog.tsx`) connects to the SSE stream and renders review sections as the pipeline progresses. Three interactive review phases can pause the pipeline:

### Review Flow

1. **Water review** — Pipeline detects water components and pauses. Admin sees cropped previews of each component and sub-cluster. Approves water regions or marks mixed regions for sub-clustering.
2. **Park review** — Pipeline detects potential park overlays and pauses. Admin confirms which green components are parks (these get inpainted out before clustering).
3. **Cluster review** — After K-means, pipeline pauses with cluster preview images. Admin can accept, merge, split, or reject clusters before division assignment proceeds.

### SSE Pause Mechanism

Each review type follows the same pattern (defined in `wvImportMatchReview.ts`):

- Pipeline stores a `Promise` resolve callback in a `pendingXReviews` Map (keyed by review ID)
- Pipeline `await`s the promise, pausing execution
- Frontend renders the review UI from SSE event data
- Admin clicks approve/reject buttons, which POST to a review endpoint
- POST handler calls `resolveXReview()`, which resolves the stored promise
- Pipeline resumes with the admin's decision

Crop images are stored in-memory Maps with auto-cleanup after 10 minutes, served via GET endpoints to avoid bloating SSE payloads.

### Frontend Components

| Component | Role |
|-----------|------|
| `CvMatchDialog.tsx` | Full-screen dialog orchestrating all review sections |
| `CvWaterReviewSection.tsx` | Water component approval UI |
| `CvParkReviewSection.tsx` | Park component confirmation UI |
| `CvClusterReviewSection.tsx` | Cluster accept/merge/split UI + manual paint editor entry |
| `ClusterPaintEditor.tsx` | Canvas-based manual cluster painting (Atrament brush/eraser + custom flood fill) |
| `clusterPaintUtils.ts` | Flood fill (source-image-aware), overlay↔pixelLabels conversion, color helpers |
| `CvMatchMap.tsx` | Interactive MapLibre map for geo preview and paint mode |
| `useCvMatchPipeline.ts` | Hook managing SSE connection and dialog state |

All frontend components live in `frontend/src/components/admin/`.

### Manual Cluster Editor

When automated K-means clustering produces incorrect results (wrong boundaries, merged regions, color confusion), the admin can switch to a canvas-based paint editor to manually draw or correct cluster boundaries.

**Two entry modes** from the cluster review step:
- **Fix mode** ("Edit manually") — loads the CV-detected clusters as a starting overlay. Admin corrects problem areas.
- **Scratch mode** ("Draw from scratch") — blank canvas over the source map image. Admin paints all clusters from scratch.

**Tools:**
- **Paint bucket** (primary) — flood fill using the source map image for boundary detection. Click inside a region to fill it with the active cluster color. Fill tolerance slider controls edge sensitivity.
- **Brush** — freehand painting for touch-ups where fill leaked or didn't reach.
- **Eraser** — removes cluster assignment from pixels.

**Technical details:**
- Uses Atrament library (~6kB) for brush/eraser rendering on HTML Canvas
- Custom flood fill reads source image pixel colors for boundary detection (not the overlay), so fill naturally stops at color boundaries on the original map
- Overlay canvas is layered over the source image with adjustable opacity
- Undo/redo via ImageData snapshots (max 50 steps)
- Zoom (scroll wheel) and pan (Space+drag) via CSS transform on the canvas wrapper

**Data flow on submit:**
1. Frontend reads overlay canvas as PNG data URL
2. Sends `{ type: 'manual_clusters', overlayPng, palette }` via the existing cluster review POST endpoint
3. Backend decodes PNG with sharp, maps pixel colors to cluster labels using nearest-color matching
4. Replaces `pixelLabels` and `colorCentroids` in the pipeline context
5. Pipeline resumes at ICP alignment + division assignment — completely transparent to downstream code

## Paint Mode

After the pipeline produces division-to-cluster assignments, `CvMatchMap.tsx` renders an interactive map where the admin can manually correct assignments:

- **Geo preview** — Division polygons colored by their assigned cluster, overlaid on the map
- **Click to assign** — Admin selects a target cluster color, then clicks unassigned or misassigned divisions to reassign them
- **Hover tooltips** — Division name and current assignment shown on hover
- **Accept/reject** — Final assignments are confirmed or rejected before committing to the database

The map uses MapLibre GL with turf.js for geometry merging (`mergeGeometries`) and react-map-gl for declarative source/layer management.

## Key ADRs

| ADR | Decision |
|-----|----------|
| [ADR-0009](../decisions/0009-opencv-js-wasm-for-cv-pipeline.md) | OpenCV.js for server-side image processing (WASM, no native dependencies) |
| [ADR-0010](../decisions/0010-cielab-kmeans-for-map-clustering.md) | CIELAB color space for perceptually uniform color clustering |
| [ADR-0011](../decisions/0011-centralized-ai-service-layer.md) | Centralized AI service layer for shared OpenAI integration |
