# ADR-0010: Spatial anomaly detection algorithm (BFS adjacency over division graph)

## Status
Accepted — 2026-04-26

## Context
When users assign GADM divisions to their world-view regions, two failure
modes degrade the resulting map:
- **Exclaves**: a division is assigned to a region whose other members are
  geographically far away (e.g. assigning Alaska to "USA Eastern Region").
- **Disconnected fragments**: a region's divisions split into two or more
  geographically isolated groups, indicating the region should probably be
  split.

Smart Simplify (introduced in PR-21) moves divisions across user-regions; the
move can introduce or expose either anomaly. The user needs visual feedback
before accepting the move.

## Decision
Compute adjacency over the division graph (two divisions adjacent ⇔ their
geometries share a boundary segment > N meters), then BFS from each region's
largest connected component. Divisions not reached are exclaves; secondary
components are disconnected fragments.

The algorithm runs both server-side
(`backend/src/services/worldViewImport/spatialAnomalyDetector.ts`) and
client-side (`frontend/src/utils/spatialAnomalyDetector.ts`) — server-side
for backend integrations (Smart Simplify response, future CV pipeline
events), client-side for interactive UI feedback.

## Alternatives considered
- **Centroid distance threshold**: flag any division whose centroid is more
  than X km from the region's centroid. Rejected because thresholds are
  fragile across region scales (Alaska vs. Liechtenstein) and centroids
  don't account for shape.
- **Convex hull containment**: an exclave is anything outside the convex hull
  of the rest of the region. Rejected because concave regions (e.g.
  archipelagos) produce false positives.
- **Voronoi-based clustering**: build a Voronoi diagram of region centroids,
  flag divisions on the wrong side. Rejected for complexity vs. benefit;
  BFS adjacency is simpler and gives the same answers in practice.

## Consequences
- **+** Algorithm is independent of region scale (no thresholds tied to km).
- **+** Same algorithm runs server- and client-side (shared in two locations).
- **−** Adjacency computation is O(N) per region, with N = divisions in the
  region. For very large regions (e.g. continents) this is the dominant cost
  in the Smart Simplify response. Acceptable for an admin-only flow.
- **−** Two source-of-truth files (server + client) must stay in sync.
  Logged here; if drift becomes a maintenance issue, future work could move
  detection to the backend only and have the frontend consume backend
  responses.

## Implementation
- Backend: `backend/src/services/worldViewImport/spatialAnomalyDetector.ts`
  (with `spatialAnomalyDetector.test.ts` covering BFS connectivity, exclave
  identification, and adjacency edge construction).
- Frontend: `frontend/src/utils/spatialAnomalyDetector.ts`.
- Smart Simplify integration: PR-22 of the rebuild plan.
