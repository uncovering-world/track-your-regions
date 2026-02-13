# Experience Map UI and Marker Behavior

This document describes how experience markers work in both map surfaces:

- Map Mode: `frontend/src/components/RegionMapVT.tsx` + `frontend/src/components/ExperienceMarkers.tsx`
- Discover Mode: `frontend/src/components/discover/DiscoverExperienceView.tsx`
- Shared interaction state: `frontend/src/hooks/useExperienceContext.tsx`

## Shared state model

`ExperienceProvider` is the source of truth for region exploration state:

- Fetches region experiences with `includeChildren=false` and `limit=200`
- Stores hover state (`hoveredExperienceId`, `hoveredLocationId`, `hoverSource`)
- Stores selection state (`selectedExperienceId`) and map triggers (`flyToExperienceId`, `shouldFitRegion`)
- Stores hover preview payload (image/title/location/source)

This lets list and map stay synchronized without prop drilling.

## Batch location data

Both `ExperienceMarkers` and `ExperienceList` consume `useRegionLocations(regionId)` — a shared React Query hook that fetches all locations for all experiences in the region via a single `GET /api/experiences/by-region/:regionId/locations` call (5-min staleTime). This replaces the previous N+1 pattern where each component individually fetched `GET /api/experiences/:id/locations` per experience.

Visit checkbox state in `ExperienceList` is derived from the global `useVisitedLocations().isLocationVisited(locationId)` rather than per-experience `useExperienceVisitedStatus()` calls, further reducing API calls from ~150 to 0 for visited status.

## Marker model

Map Mode uses three GeoJSON sources:

- `exp-markers`: clustered main markers
- `exp-highlight`: all in-region locations for the selected experience
- `exp-hover`: hover ring/glow (for marker or cluster highlight)

For multi-location experiences, the main marker is the first in-region location. A badge shows `locationCount` when more than one location exists. Selected experience markers are removed from `exp-markers` and rendered via `exp-highlight` instead.

Map Mode caps marker rendering to 100 experiences (`experiences.slice(0, 100)`) and shows an on-map indicator when total exceeds the cap.

Discover Mode mirrors the same visual language (cluster circles, count labels, multi-location badge, hover ring, selected-location highlights), but uses a dedicated map instance and imperative MapLibre event wiring.

## Interaction behavior

- Hover map marker -> popup + hover ring + list highlight
- Hover list card -> cluster-aware hover ring on map (even when marker is clustered)
- Click marker -> toggle selected experience
- Click cluster -> zoom to cluster expansion zoom
- Multi-location selected -> fit bounds to all selected in-region points

## Hover preview card placement

Both Map mode and Discover mode render hover cards as React `<Box>` overlays positioned absolutely over the map container — not as MapLibre native popups. This allows consistent styling, image loading, and animation across both surfaces.

Map mode (`RegionMapVT`): positioned by marker screen location (left/right and top/bottom) to avoid covering the hovered marker.

Discover mode (`DiscoverExperienceView`): positioned in the top-right corner of the map. On marker hover, the component looks up the experience in the `experiences` array by feature ID to get image URL and source name. Uses `extractImageUrl()` + `toThumbnailUrl()` for image thumbnails. Both use `objectFit: 'contain'` with `maxHeight` to handle portrait-oriented images without severe cropping.

## Region visual feedback

### Selected vs sibling contrast

When a region is clicked (selected but not yet explored), it visually "pops" from its siblings. The key principle is **selected always wins** — it is always more prominent than any hovered sibling:

| State | Fill opacity | Outline width | Outline opacity |
|-------|-------------|---------------|-----------------|
| **Selected** | 0.22 (indigo) | 2px | 0.7 |
| **Hovered sibling** | 0.16 | 1.5px | 0.6 |
| **Visited** | 0.20 (emerald) | 0.75px | 0.35 |
| **Default sibling** | 0.08 | 0.75px | 0.35 |

The `case` expression in paint functions checks selected FIRST, so even if a selected region also has `hovered` feature-state, it keeps its selected styling.

**Important**: Paint expressions use `['id']` (MapLibre feature ID expression), NOT `['get', 'id']` (property lookup). PostGIS `ST_AsMVT(..., 'id')` strips the `id` column from MVT properties when it's used as the feature ID — so `['get', 'id']` returns nothing. The `['id']` expression reads the MVT feature ID directly.

Hull fill/outline follow proportional values (hull selected fill 0.18, hover 0.12).

### Ancestor context layers

When a region is selected, its siblings (or children for non-leaf) are shown in the main tile source, but higher-level context would normally disappear. **Ancestor context layers** load parent-level tiles at every breadcrumb level as dimmed backgrounds behind the main tiles, providing full spatial context up to the root.

`useTileUrls.ts` computes a `contextLayers: ContextLayer[]` array from `regionBreadcrumbs`:

- **Non-leaf regions**: all breadcrumbs produce context layers (children are in main tiles)
- **Leaf regions**: breadcrumbs minus the last entry (the leaf itself, whose siblings are already in main tiles)
- Root-level ancestor (parentRegionId=null): loads `tile_world_view_root_regions`
- Nested ancestor: loads `tile_region_subregions` with the ancestor's parent ID
- Root-level leaf with no ancestors: no context layers needed

For example, drilling into leaf "Wallonia" (Europe → Benelux → Belgium → Wallonia) produces 3 context layers: root-level regions (Europe highlighted), Europe's children (Benelux highlighted), Benelux's children (Belgium highlighted). Main tiles show Belgium's children (Wallonia and siblings).

Each layer highlights its corresponding ancestor with `highlightId`, producing visual "you are here" breadcrumbs across the map. Layer source IDs are `context-0-vt`, `context-1-vt`, etc., ordered root-to-leaf.

**Context layer paint values:**

| State | Fill opacity | Outline width | Outline opacity |
|-------|-------------|---------------|-----------------|
| **Highlighted ancestor** | 0.10 (indigo wash) | 1.5px | 0.5 |
| **Hovered sibling** | 0.08 | 1.5px | 0.5 |
| **Default sibling** | 0.03 | 0.5px | 0.2 |

Context sources are rendered **before** the main `regions-vt` source (below in z-order). Each has fill and outline layers (`context-N-fill`, `context-N-outline`). Fill layers are interactive (clickable and hoverable).

**Click and hover handling**: `event.features` may contain matches from both main tiles and context layers at the same click point (context layers cover entire ancestor areas). Both click and hover handlers prefer main tile features (`region-fill`, `region-hull`) over context features, falling back to context only when no main tile feature exists at the event point. Without this preference, hovering or clicking a child region would resolve to the ancestor's `region_id` from the overlapping context layer.

When a context feature is clicked, `parentRegionId` is taken from the feature's `parent_region_id` property (not `viewingRegionId`, which points to the current selected region — wrong parent for ancestors).

**Focus data enrichment**: Tile functions don't include `focus_bbox` or `anchor_point` in MVT properties, so clicking a context layer feature creates a `selectedRegion` without focus data. The click handler skips immediate fly-to for context clicks (no imprecise tile-geometry flight). Instead, `useNavigation.tsx` enriches `selectedRegion` when the `regionAncestors` API response arrives — the last breadcrumb entry is the selected region itself, returned with full data including `focusBbox` and `anchorPoint`. This triggers the fly-to effect in `useMapInteractions.ts` with accurate bounds.

**Hover name fallback**: `metadataById` only contains current-level children. For ancestor/sibling regions, `hoveredRegionName` falls back to querying tile feature properties (`name` field) from context sources.

Context layers are hidden during exploration mode (added to the visibility toggle list in `useMapFeatureState.ts`).

### Stale hover clearing

A native `mouseleave` listener is attached to the map container in `useMapInteractions.ts` to reliably clear hover state when the cursor exits the map box. react-map-gl's `onMouseLeave` only fires when leaving interactive layers, which leaves hover stuck when the cursor exits through empty space.

### Region outline during exploration

When exploring a region (viewing experience markers), fill layers, island layers, and context layers are hidden, but the `region-outline` and `hull-outline` layers remain visible in a neutral slate color (`#475569`) for geographic context:

- **Leaf region** (no subregions): only the selected region's outline is visible (2.5px, 0.85 opacity); sibling outlines are hidden (width 0)
- **Non-leaf region** (has subregions): all children outlines are shown (1.5px, 0.6 opacity), collectively tracing the parent boundary

Style configuration lives in `layerStyles.ts` — `regionOutlinePaint()` and `hullOutlinePaint()` both delegate to a shared `outlinePaint()` function that accepts an optional `ExploringParams` object. Visibility toggling lives in `useMapFeatureState.ts`.
