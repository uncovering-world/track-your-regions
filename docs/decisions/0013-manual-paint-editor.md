# ADR-0013: Manual cluster-paint editor for CV match recovery

## Status
Accepted — 2026-04-26

## Context
The CV color-match pipeline produces cluster-to-division assignments that are
sometimes wrong — fragments are misclassified, water bleeds into land, road
pixels get assigned to the wrong region. Auto-recovery (recluster, mean-shift
re-tuning) fixes most cases but not all. For the remaining cases, the user
needs a manual reassignment tool.

## Decision
Add a paint-mode editor that overlays a cluster-color canvas on the CV-region
output. Users click or drag to paint a cluster color onto areas, with flood
fill reading boundaries from the processed (mean-shift) image. A separate
border tool (polygon/polyline) allows drawing magenta barriers before filling.
An eraser removes border pixels from the processed-image layer. Background visibility toggles between the
original and processed images so users can verify their paint work against
the source.

The editor edits the **processed** (post-CV-cleanup) image directly as the
border layer, and maintains a separate transparent color layer for cluster
fills. On confirm, the color canvas PNG is sent to the backend, which maps
pixel colors back to cluster labels using nearest-color matching, then
continues the ICP alignment and division assignment phases.

## Alternatives considered
- **Auto-recovery only**: rejected; some maps have inherently ambiguous regions
  that no algorithm reliably resolves.
- **Edit raw image, re-run CV**: rejected because the user's mental model is
  "fix this region's assignment", not "tune the CV input."
- **Vector-region drawing tool**: rejected for complexity; pixel-paint is
  simpler and matches the cluster-output data model directly.

## Consequences
- **+** Recovery path for ~5-10% of regions that auto-CV gets wrong.
- **+** UI is intuitive (paint-like) and integrates into the existing cluster
  review step.
- **−** Adds `atrament` as a frontend dependency for brush/eraser rendering.
- **−** Painted results are submitted as PNG data URLs (~50-200kB for typical
  maps), sent via the existing cluster-review POST endpoint.

## Implementation
- Frontend: `ClusterPaintEditor.tsx` — two-canvas architecture (border canvas
  for processed image + border edits; color canvas for cluster fills).
- Frontend: `clusterPaintUtils.ts` — flood fill (magenta-border-aware),
  overlay↔pixelLabels conversion, color helpers. Unit tests in
  `clusterPaintUtils.test.ts`.
- Backend: `wvImportMatchReview.ts` — `ManualClusterDecision` type,
  `ClusterReviewResponse` union, `clusterOverlayImages` store,
  `storeClusterOverlay()`, `getClusterOverlayImage()`.
- Backend: `adminRoutes.ts` — GET `/cluster-overlay/:reviewId` endpoint;
  POST `/cluster-review/:reviewId` extended to handle `manual_clusters` body.
- Frontend API: `adminWorldViewImport.ts` — `ClusterReviewCluster`,
  `ClusterReviewDecision`, `ManualClusterResponse` types;
  `clusterOverlayUrl()`, `clusterHighlightUrl()`, `clusterPreviewUrl()`,
  `respondToClusterReview()` functions.
- `ClusterPaintEditor` is wired into `CvClusterReviewSection` in Chain D
  (CV pipeline UI).
