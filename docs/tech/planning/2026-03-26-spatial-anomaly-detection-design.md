# Spatial Anomaly Detection for Region Assignments

## Problem

After auto-matching (especially CV-based matching), region assignments can contain spatial anomalies:

- **Exclaves** — A division assigned to Region X is geographically surrounded by divisions of Region Y (e.g., a single district of "Eastern India" sitting inside "Western India")
- **Disconnected fragments** — A region's territory splits into 2+ disconnected groups where one group is much smaller than the others

These are currently invisible until someone manually inspects the map. We need automated detection with admin review.

## Design Decisions

- **Connectivity-based algorithm** — Group each region's divisions into connected components via adjacency. Regions with 2+ components have fragments; smaller components are flagged as anomalies.
- **Hybrid PostGIS + TypeScript** — PostGIS computes the adjacency graph (spatial indexing), TypeScript does graph analysis (testable, reusable).
- **No auto-fix** — All anomalies are presented as suggestions with Accept/Skip, same UX as existing Smart Simplify moves.
- **No size threshold** — Flag all disconnected components regardless of size. Sort by suspiciousness (smaller fraction = more likely anomaly). Admin decides.
- **Two integration points:**
  1. Smart Simplify button — runs both GADM-parent and spatial anomaly detection, returns results in one response
  2. CV pipeline (end of Phase 5, before `complete` SSE event) — runs spatial detection on combined existing + suggested assignments, shows warnings in paint mode before commit
- **Identity safety** — Always reference by database IDs, never array indices. Recompute anomaly list after every mutation.

## Architecture

### Core Algorithm

Three-step process:

1. **Build per-region adjacency graph** — For each region, collect its divisions and filter adjacency edges to those connecting divisions within the same region.
2. **Find connected components** — BFS per region. A region with 1 component is clean. 2+ components = fragments.
3. **Score and build suggestions** — For each non-largest component, find the dominant neighboring region via cross-region adjacency edges. Build a move suggestion. Score = `fragmentSize / totalRegionSize` (lower = more suspicious). Note: "largest component = main body" is a heuristic — in rare cases the smaller group is actually correct. The Accept/Skip UX is the safety net; no auto-fix means the admin always decides.

### Data Types

```typescript
// -- Backend types (spatialAnomalyDetector.ts) --

interface DivisionAssignment {
  divisionId: number;
  memberRowId: number | null; // null for suggested (not yet committed) assignments
  regionId: number;
  regionName: string;
}

interface AdjacencyEdge {
  divA: number; // divisionId
  divB: number; // divisionId
}

interface SpatialAnomalyDivision {
  divisionId: number;
  name: string;
  memberRowId: number | null; // null for suggested assignments in CV pipeline
  sourceRegionId: number;
  sourceRegionName: string;
}

interface SpatialAnomaly {
  divisions: SpatialAnomalyDivision[];
  suggestedTargetRegionId: number;
  suggestedTargetRegionName: string;
  fragmentSize: number;      // division count in this fragment
  totalRegionSize: number;   // total divisions in source region
  score: number;             // fragmentSize / totalRegionSize (lower = more suspicious)
}

// -- Extended Smart Simplify response --

interface SmartSimplifyResult {
  moves: SmartSimplifyMove[];              // existing GADM-parent moves
  spatialAnomalies: SpatialAnomaly[];      // new — separate array, different shape
}
```

The `SpatialAnomaly` type is deliberately kept separate from `SmartSimplifyMove` because their shapes differ fundamentally — spatial anomalies are not about GADM parents, and their division lists need different fields. The Smart Simplify dialog renders both lists in one scrollable view but with distinct section headers.

### Backend Service Layer

**New file:** `backend/src/services/worldViewImport/spatialAnomalyDetector.ts`

Three exported functions:

1. **`getAdjacencyGraph(divisionIds: number[]): Promise<AdjacencyEdge[]>`**
   - PostGIS query on `administrative_divisions` using `geom_simplified_medium` (not full `geom` — adjacency is topology-invariant at this resolution, and it matches what the CV pipeline uses)
   - Uses `ST_Touches(a.geom_simplified_medium, b.geom_simplified_medium) OR ST_DWithin(a.geom_simplified_medium, b.geom_simplified_medium, 0.0001)` — matches the existing codebase adjacency pattern (see `geometryComputeSingle.ts`). The `ST_DWithin` fallback is essential because `geom_simplified_medium` can have micro-gaps between topologically adjacent polygons due to simplification tolerance.
   - `WHERE a.id < b.id` to halve pair count (each edge found once)
   - Returns flat edge list

2. **`detectSpatialAnomalies(assignments: DivisionAssignment[], edges: AdjacencyEdge[]): SpatialAnomaly[]`**
   - Pure function, no DB access — fully testable
   - Runs the 3-step algorithm
   - Sorted by score ascending (most suspicious first)

3. **`detectAnomaliesForRegion(worldViewId: number, parentRegionId: number): Promise<SpatialAnomaly[]>`**
   - Convenience wrapper for the Smart Simplify button path
   - Queries `region_members` + `administrative_divisions` for all children of `parentRegionId`
   - Filters to full-coverage members only (`custom_geom IS NULL`) — custom geometry members represent partial divisions and would confuse adjacency analysis
   - Calls `getAdjacencyGraph()` then `detectSpatialAnomalies()`

The CV pipeline calls `getAdjacencyGraph()` + `detectSpatialAnomalies()` directly with its in-memory suggested assignments (where `memberRowId` is null since they're not yet committed).

### Smart Simplify Integration

**Modified:** `wvImportTreeOpsController.ts`

The `POST /smart-simplify` endpoint:
- After existing GADM-parent move detection, calls `detectAnomaliesForRegion()`
- Returns both in the response as separate arrays: `{ moves, spatialAnomalies }`
- No conversion between types — each keeps its own shape

Apply-move endpoint: reused for spatial anomaly moves with one addition. It takes `ownerRegionId` + `memberRowIds` + `parentRegionId`, which maps to:
- `ownerRegionId` = `suggestedTargetRegionId`
- `memberRowIds` = `divisions.map(d => d.memberRowId)`
- `parentRegionId` = same parent from the dialog

The endpoint's existing validation (owner must be a child of parent) holds true since spatial anomalies are detected within the same parent's children.

**Simplification opt-out:** The existing endpoint calls `runSimplifyHierarchy()` after moving members, which consolidates GADM groups in the target region. For spatial anomaly moves this is unnecessary and potentially surprising — the admin expects divisions to move, not collapse. Add an optional `skipSimplify: boolean` flag to the endpoint request body. Smart Simplify GADM-parent moves pass `false` (existing behavior), spatial anomaly moves pass `true`.

**Modified:** `SmartSimplifyDialog.tsx`

- Renders GADM-parent moves first (existing), then spatial anomaly section with a "Spatial Anomalies" header
- Each spatial anomaly shows: fragment divisions, source region, suggested target, with Accept/Skip
- Accept calls the same `applySmartSimplifyMove()` API
- Map highlights fragment divisions in the context of surrounding regions

### CV Pipeline Integration

**Modified:** `wvImportMatchShared.ts` — end of Phase 5 (result assembly), before sending the `complete` SSE event (~line 722)

After division assignment produces suggested cluster-to-division mappings and cluster-to-region voting:
1. Build combined picture: existing `region_members` (already in DB for this parent) + new suggested assignments from CV result
2. Call `getAdjacencyGraph()` for all involved division IDs
3. Call `detectSpatialAnomalies()` on combined assignments (suggested assignments have `memberRowId: null`)
4. Include in `complete` SSE event:

```typescript
sendEvent({
  type: 'complete',
  data: {
    // ... existing fields ...
    spatialAnomalies: SpatialAnomaly[],
    adjacencyEdges: AdjacencyEdge[], // for client-side re-check in paint mode
  }
});
```

**Modified:** `adminWvImportCvMatch.ts` — Update `ColorMatchResult` type to include `spatialAnomalies` and `adjacencyEdges` fields.

**Modified:** `useCvMatchPipeline.ts` — Update `CvMatchDialogState` interface and `complete` event handler to store the new fields.

**Modified:** `CvGeoPreviewSection.tsx` + `CvMatchMap.tsx` (paint mode)

- Warning banner when anomalies found: "N potential exclaves detected"
- Visual indicator on anomalous divisions (dashed outline or warning icon at centroid)
- Client-side `detectSpatialAnomalies()` for instant re-check when admin reassigns divisions in paint mode
- Adjacency edges are static (geometry doesn't change), only recompute components on reassignment
- Types (`DivisionAssignment`, `AdjacencyEdge`, `SpatialAnomaly`) shared from the client-side utility file

### Identity Safety

Core principle across all integration points:

1. **Anomaly suggestions keyed by division IDs** — `divisions[].divisionId` and `suggestedTargetRegionId` are database IDs, never array indices.
2. **After any mutation, recompute anomaly list** — The assignment map (`Map<divisionId, regionId>`) is the single source of truth. Re-run `detectSpatialAnomalies()` against current state.
3. **No positional coupling** — Anomaly detector only sees `divisionId -> regionId` mapping, not cluster indices or list positions.
4. **Audit existing flows** — During implementation, audit Smart Simplify apply flow and paint mode for stale-ID issues. Specifically check that `SmartSimplifyDialog` does not hold stale `memberRowIds` after sibling moves shift row ownership.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/worldViewImport/spatialAnomalyDetector.ts` | **New** — core algorithm (3 functions) |
| `backend/src/controllers/admin/wvImportTreeOpsController.ts` | Smart Simplify endpoint calls spatial detector, returns `spatialAnomalies` alongside `moves` |
| `backend/src/controllers/admin/wvImportMatchShared.ts` | CV pipeline end-of-Phase-5 calls spatial detector, adds to `complete` SSE event |
| `frontend/src/api/adminWvImportTreeOps.ts` | Add `SpatialAnomaly` types, update `SmartSimplifyResult` with `spatialAnomalies` field |
| `frontend/src/api/adminWvImportCvMatch.ts` | Update `ColorMatchResult` / `ColorMatchSSEEvent` with `spatialAnomalies` + `adjacencyEdges` |
| `frontend/src/api/adminWorldViewImport.ts` | Update barrel re-exports for new types |
| `frontend/src/components/admin/SmartSimplifyDialog.tsx` | Render spatial anomaly section below GADM-parent moves |
| `frontend/src/components/admin/useCvMatchPipeline.ts` | Update `CvMatchDialogState` and `complete` event handler |
| `frontend/src/components/admin/CvGeoPreviewSection.tsx` | Warning banner, visual indicators for anomalous divisions |
| `frontend/src/components/admin/CvMatchMap.tsx` | Highlight anomalous divisions on map |
| `frontend/src/utils/spatialAnomalyDetector.ts` | **New** — client-side pure `detectSpatialAnomalies()` + shared types. Intentional duplication of backend pure function — no shared code path exists in this project (Node/ESM vs Vite/browser). Both copies are ~50 lines and must stay in sync. |

## Not In Scope

- Auto-fixing anomalies without admin review
- Size-based filtering thresholds
- Border sliver detection (separate concern)
- Cross-parent anomaly detection (only checks within one parent's children)
