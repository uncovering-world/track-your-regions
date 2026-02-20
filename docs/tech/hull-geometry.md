# Hull Geometry

This document describes how hull visualization works for scattered/island regions.

For the full geometry system reference (columns, triggers, functions, pipeline rules), see [geometry-columns.md](geometry-columns.md).

## Overview

Regions with scattered geography (island groups, small isolated territories) use a concave hull for overview rendering at low zoom levels (z0-8), while real coastline geometry is shown at higher zoom levels (z9+).

## Key Concepts

- **`uses_hull`** flag on `regions` — controls hull display in tile functions and simplified column derivation. Auto-detected on INSERT via `should_use_hull()`, preserved across geometry recomputation, manually editable.
- **`hull_geom`** — concave hull generated for hull regions, providing territorial extent.
- **`hull_params`** — JSONB parameters used to generate the hull (buffer, concavity, simplify tolerance).

## Display Modes

In the World View editor geometry panel:

- `real` — shows the authoritative `geom` (union of member geometries)
- `hull` — shows the concave hull

## Generation Flow

1. Region geometry is computed/updated (`geom`)
2. `uses_hull` auto-detected on INSERT by `should_use_hull()` trigger
3. Hull can be previewed/saved via API
4. Triggers keep 3857 projection and simplified columns in sync
5. Post-batch: `refresh_uses_hull_flags()` re-checks detection after all siblings are computed

## API Endpoints

- `POST /api/world-views/regions/:regionId/hull/preview`
- `POST /api/world-views/regions/:regionId/hull/save`
- `GET /api/world-views/regions/:regionId/hull/params`
- `GET /api/world-views/regions/:regionId/geometry?detail=high|hull|anchor`

## Where It Is Used

- Editor hull tooling: `frontend/src/components/HullEditorDialog.tsx`
- Geometry panel mode toggle: `frontend/src/components/WorldViewEditor/components/GeometryMapPanel.tsx`
- Backend hull operations: `backend/src/controllers/worldView/hullOperations.ts`
- Hull generation services: `backend/src/services/hull/*`

## Practical Notes

- Use hull mode for island groups where raw polygons are visually noisy at low zoom
- Keep real mode for exact geography and boundary editing tasks
- Use region `focus_bbox` when fitting map bounds; it is antimeridian-aware and preferred over raw bbox computation
