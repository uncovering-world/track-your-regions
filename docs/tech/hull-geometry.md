# Archipelago Geometry (TS Hull)

This document describes how archipelago visualization works in the current codebase.

## Geometry Columns Used

`regions` stores multiple geometry forms:

- `geom`: merged real member geometry (authoritative)
- `ts_hull_geom`: TypeScript-generated hull for archipelagos
- `focus_bbox`, `anchor_point`: camera/label helpers

3857 derivatives and simplifications are trigger-maintained (`*_3857`, `geom_simplified_*`).

## Render Geometry Selection

The render geometry for a region is determined by a simple rule:

```
IF archipelago AND ts_hull_geom IS NOT NULL → ts_hull_geom
ELSE → geom
```

This logic is centralized in the `region_render_geom` database view.

## Current Display Modes

In the World View editor, display mode is:

- `real` — shows the authoritative `geom` (union of member geometries)
- `ts_hull` — shows the concave hull for archipelagos

## Generation Flow

1. Region geometry is computed/updated (`geom`)
2. Archipelago detection (`is_archipelago`) is maintained in DB metadata
3. TS hull can be previewed/saved via API
4. Triggers keep projection/simplified columns in sync

Non-archipelago recompute paths clear stale hull fields.

## API Endpoints

- `POST /api/world-views/regions/:regionId/hull/preview`
- `POST /api/world-views/regions/:regionId/hull/save`
- `GET /api/world-views/regions/:regionId/hull/params`
- `GET /api/world-views/regions/:regionId/geometry?detail=high|ts_hull|anchor`

## Where It Is Used

- Editor hull tooling: `frontend/src/components/HullEditorDialog.tsx`
- Geometry panel mode toggle: `frontend/src/components/WorldViewEditor/components/GeometryMapPanel.tsx`
- Backend hull operations: `backend/src/controllers/worldView/hullOperations.ts`
- Hull generation services: `backend/src/services/hull/*`

## Practical Notes

- Use `ts_hull` for island groups where raw polygons are visually noisy at low zoom
- Keep `real` mode for exact geography and boundary editing tasks
- Use region `focus_bbox` when fitting map bounds; it is antimeridian-aware and preferred over raw bbox computation
