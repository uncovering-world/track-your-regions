# Custom Subdivision Map Tools

This document covers the map tab internals for the Create Subregions dialog:

- Component: `frontend/src/components/WorldViewEditor/components/dialogs/CustomSubdivisionDialog/MapViewTab.tsx`
- Hooks: `useGeometryLoading.ts`, `useDivisionOperations.ts`, `useImageColorPicker.ts`
- Tools: `assign`, `split`, `cut`, `moveToParent`

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

## Move-to-parent tool

The `moveToParent` tool lets admins click a division to reassign it from the current region to its parent region. On click:

1. Move the division's member row from the current region into the parent region (backend mutation).
2. Remove it from the current region's subdivision groups and map features in the dialog state.
3. The division no longer appears in the current region's lists.

A batch variant "All to parent" moves all unassigned divisions at once to the parent region.

## Side-by-side image mode

Alternative to the map overlay for reference images. When a region has a `region_map` URL (typically from Wikimedia Commons), admins can toggle between:

- **Overlay mode** — image displayed over the map with opacity control
- **Side-by-side mode** — image shown next to the map for visual comparison

The side image panel supports the eyedropper color picker for sampling colors.

## Eyedropper color picker

Extracted into `useImageColorPicker.ts`. Lets admins sample pixel colors from the reference image to color-code subdivision groups:

1. Click the eyedropper button next to a group's color chip.
2. Click on the reference image to sample a color.
3. The sampled color's saturation is boosted (`min(1, s × 1.4 + 0.1)`) for better map visibility.
4. Escape key or toggling the eyedropper control cancels the operation.

Uses a hidden canvas to read pixel data from the loaded image.

## Descendant geometries context layer

When the dialog opens for a region that has child regions but no direct division members, descendant geometries are loaded as a read-only context layer. Each descendant group is color-coded to match its parent region. Only direct members of the selected region remain interactive (clickable for tool operations).

Extracted into `useGeometryLoading.ts` — the hook fetches descendant geometries via `fetchDescendantMemberGeometries()` and exposes them as `descendantGeometries` for the map layer.

## Reload triggers and performance notes

- Map data is refreshed when the division set changes (`divisionKey` diff against feature keys).
- Region-member geometry endpoint is preferred because it returns pre-associated geometries per member row.
- Initial load can still be heavy for very large regions; fallback calls and geometry simplification dominate cost, not split logic itself.

