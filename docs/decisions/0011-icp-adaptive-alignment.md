# ADR-0011: ICP adaptive alignment for CV-GADM division matching

## Status
Accepted — 2026-04-26

## Context
The CV pipeline matches color-clustered regions to GADM divisions. The initial
matchTemplate-based alignment is bounded-box-driven and fails when the
detected CV bounding box is inflated (by speckle noise or stray pixels).
Iterative Closest Point (ICP) provides a refinement step that aligns based on
boundary point clouds, robust to bbox inflation.

## Decision
Add an "Adjust" affordance after initial match: detect bbox inflation by
comparing CV-bbox to GADM-bbox dimensions. If inflated above threshold, run
ICP between CV-region boundary points and GADM-division boundary points,
producing a corrected affine. Use the corrected affine for subsequent IoU
scoring. Includes spatial-component outlier detection — points far from the
main cluster are filtered before ICP iteration.

## Alternatives considered
- **Always run ICP**: rejected because ICP is slower than matchTemplate and
  most matches don't need it.
- **Skip ICP, use centroid alignment**: rejected because it doesn't correct
  for rotation/scale, only translation.
- **Bayesian probabilistic alignment**: rejected for complexity vs. benefit.

## Consequences
- **+** Robust to bbox inflation; recovers good matches that would otherwise
  fail.
- **+** Optional — only triggers when bbox metrics indicate inflation.
- **−** Adds 200-500ms per region with adjusted ICP (acceptable for admin flow).
- **−** Two alignment strategies in the codebase (matchTemplate + ICP);
  documented complexity.

## Implementation
- Backend: `backend/src/controllers/admin/wvImportMatchIcp.ts` (with tests).
- Frontend: `frontend/src/components/admin/CvIcpAdjustmentSection.tsx`.
- Integration into `wvImportMatchController` SSE flow.
