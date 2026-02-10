# Custom Subdivision Map Tools

This document covers the map tab internals for the Create Subregions dialog:

- Component: `frontend/src/components/WorldViewEditor/components/dialogs/CustomSubdivisionDialog/MapViewTab.tsx`
- Tools: `assign`, `split`, `cut`

## Geometry loading pipeline

`loadGeometries()` builds map features from current region members in two stages:

1. Fetch `fetchRegionMemberGeometries(regionId)` to get all member geometries, including `custom_geom` parts.
2. Fallback fetch for missing members via `fetchDivisionGeometry(divisionId, worldViewId)`.

Fallback fetches run in batches (`batchSize = 12`) to avoid long sequential waits when many divisions are present.

The map refits using `smartFitBounds(...)` when geometries are ready.

## Split tool behavior

Clicking a splittable member (`hasChildren=true`) does this:

1. Fetch all direct children with pagination (`limit=1000`, `offset` loop).
2. Remove parent from region (`removeDivisionsFromRegion`).
3. Add children as members (`addDivisionsToRegion`).
4. Update local group/unassigned state and map features.

The pagination loop prevents truncation on large parents and replaces earlier fixed-size behavior.

## Cut tool behavior

Cut mode opens `CutDivisionDialog` for the clicked member geometry:

- Uses custom member geometry first (when available), otherwise base division geometry.
- On confirm, removes original member and inserts each cut part with `customGeometry`.
- Adds temporary negative `memberRowId` values in local UI state until canonical rows are refetched.

## Reload triggers and performance notes

- Map data is refreshed when the division set changes (`divisionKey` diff against feature keys).
- Region-member geometry endpoint is preferred because it returns pre-associated geometries per member row.
- Initial load can still be heavy for very large regions; fallback calls and geometry simplification dominate cost, not split logic itself.

