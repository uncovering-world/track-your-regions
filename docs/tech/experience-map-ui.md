# Experience Map UI and Marker Behavior

This document describes how experience markers work in both map surfaces:

- Map Mode: `frontend/src/components/RegionMapVT.tsx` + `frontend/src/components/ExperienceMarkers.tsx`
- Discover Mode: `frontend/src/components/discover/DiscoverExperienceView.tsx`
- Shared interaction state: `frontend/src/hooks/useExperienceContext.tsx`

## Shared state model

`ExperienceProvider` is the source of truth for region exploration state:

- Fetches region experiences with `includeChildren=false` and `limit=WHOLE_REGION_LIMIT` — a region is read whole, never paged. "Whole" is bounded: `WHOLE_REGION_LIMIT` is 5000, equal to the route's ceiling, so a region holding more than that is returned incompletely and neither surface has a paging path to fetch the rest. The largest today holds 658, and `total` is a real count, so crossing that line is detectable rather than silent — but it is a ceiling, not an absence of one. Neither this list nor Discover has a "load more", and the rows come back `ORDER BY e.name`, so a limit under the region's size truncated alphabetically rather than paging: at 200, Europe's 658 ended after "G". The markers are built from this same array, so the cut removed pins as well as rows
- Stores hover state (`hoveredExperienceId`, `hoveredLocationId`, `hoverSource`)
- Stores selection state (`selectedExperienceId`) and map triggers (`flyToExperienceId`, `shouldFitRegion`)
- Stores hover preview payload (image/title/location/source)

This lets list and map stay synchronized without prop drilling.

## Batch location data

Both `ExperienceMarkers` and `ExperienceList` consume `useRegionLocations(regionId, includeLost)` — a shared React Query hook that fetches all locations for all experiences in the region via a single `GET /api/experiences/by-region/:regionId/locations` call (5-min staleTime). This replaces the previous N+1 pattern where each component individually fetched `GET /api/experiences/:id/locations` per experience.

Visit checkbox state in `ExperienceList` is derived from the global `useVisitedLocations().isLocationVisited(locationId)` rather than per-experience `useExperienceVisitedStatus()` calls, further reducing API calls from ~150 to 0 for visited status.

It is derived from the **in-region** locations, which is why the visited controls are disabled until `useRegionLocations` reports `locationsResolved`. With the batch unresolved `inRegionCount` is 0, which short-circuits `inRegionVisitedStatus` to `not_visited` — so every row would render unchecked, indistinguishable from genuinely unvisited, and every toggle would pass "mark", letting a fully-visited experience be re-marked but never unmarked. The gate protects a mutation path, not just a label.

### Lifecycle and what the map draws

Experiences a curator recorded as `lost` are absent from the markers, because the batch above
filters them exactly as the list does — offering somewhere demolished as somewhere to go is
the one thing this data can get actively wrong. `former` is untouched: the place still stands,
so it keeps its pins and its card carries the chip instead.

`includeLost` travels from the list's reveal through the hook to the batch, and is part of the
query key. Both have to agree: a row the list shows but the batch omits renders with no pins
and a confident `0/N in region`, since the denominator comes from the experience and the
numerator from this response. See `docs/tech/experiences.md` § Lifecycle filtering for the
rule itself.

## Marker model

Map Mode uses three GeoJSON sources:

- `exp-markers`: every in-region marker, unclustered. Below `HEATMAP_MAX_ZOOM` (5) it draws as a density heatmap; from that zoom it draws as individual markers
- `exp-highlight`: all in-region locations for the selected experience — or all of them when none is in region, matching the marker fallback below, so a hand-assigned experience does not vanish the moment it is selected — or the experience's own point when no locations have loaded for it at all, which is the common case in a region fetched without descendants. Selecting removes the marker from `exp-markers`, so without that last case the act of selecting made the experience disappear
- `exp-hover`: hover ring/glow

For multi-location experiences, the main marker is the first in-region location — or the first location of any kind when none is in region, flagged `inRegion: false`. That state is what a curator's manual assignment produces: `assignExperienceToRegion` writes `experience_regions` alone, and the reason to assign by hand is that spatial containment missed the point. Skipping those left the row without a marker, so hovering it painted nothing and left the previously hovered row's ring standing in for it — `updateHoverFromList` now clears the ring when it finds no marker rather than returning bare. A badge shows `locationCount` when more than one location exists. Selected experience markers are removed from `exp-markers` and rendered via `exp-highlight` instead.

Map Mode builds a marker for every experience — `buildExperienceMarkers()` in `components/experienceMarkers/buildMarkers.ts`, a pure function of the experiences, their locations and the expanded category set. It used to stop at 100 and show an on-map indicator saying so. The cap was removed because it silently disabled the list→map hover past it: the highlight resolves an experience through the marker set, and returns without a sound when it is absent, so in a 200-experience region half the rows hovered to nothing. The heatmap is what makes the full set affordable to render below its threshold.

### Density instead of clusters

Overview zoom shows a heatmap rather than clustered counts. It replaces clustering rather than sitting beside it: a clustered source cannot drive a heatmap, because MapLibre substitutes aggregates for the points and the heat would be computed from cluster centroids. With `cluster` off, the one source serves both the heatmap below `HEATMAP_MAX_ZOOM` and the individual markers from it.

Three paint properties carry the design, and each is set against a specific failure:

- `heatmap-radius` is **flat** (16px). It is in screen pixels, so zooming in spreads the points across more of the screen while the blur stays the same size — which is what makes a blob resolve into the structure inside it. Growing it with zoom cancels exactly that.
- `heatmap-intensity` **rises with zoom, from well below 1**. Because the radius is fixed, each zoom level covers roughly a quarter as many points and density falls about fourfold per level — flat intensity made the layer fade out on the way in. The overview value is held low for the opposite reason: at 1 a single lone point peaked near the top of the ramp on its own, so a one-site town read the same as Rome and the continent came out a single blob. Saturated density cannot be separated by any palette, because every such pixel asks the ramp for the same value.
- `heatmap-color` is an **inferno ramp**, cold to hot. A single hue at varying alpha can say "something is here" but not "much more here than there".

The handover is a cross-fade, not a threshold. `minzoom` cannot express one — MapLibre applies no fade to circle or symbol layers at a zoom bound, so markers bound to `HEATMAP_MAX_ZOOM` appeared at exactly z5 while the heat had already ramped to nothing just below it, leaving a band around z4.9 with faint heat and no markers. Both now span `MARKER_FADE_START` → `HEATMAP_MAX_ZOOM` and ramp opacity across it in opposite directions.

Removing clustering removed the only asynchronous path in the hover: `getClusterLeaves` was what made an answer arrive after the pointer had moved on, and the ownership-token machinery existed solely to discard those stale answers. A list hover now paints the ring on the marker's own point directly — `updateHoverFromList` takes no map handle at all, which also removed a guard that had started skipping the "clear the ring" branch whenever the map was not ready yet.

Discover Mode still uses clustering (cluster circles, count labels, multi-location badge, hover ring, selected-location highlights) with a dedicated map instance and imperative MapLibre event wiring — the heatmap is Map Mode only.

## Interaction behavior

- Hover map marker -> popup + hover ring + list highlight
- Hover list card -> hover ring on the marker's own point, whether or not it is currently drawn (below the heatmap threshold the heat is what shows there instead). The row is memoised and its props are held stable so this costs one row's render rather than the region's: the handlers are declared once in `ExperienceList` rather than per row, the shared hovered-location id is narrowed by `ownedHoveredLocationId()` to the row that owns it, and each row registers its own scroll ref instead of being wrapped in a `<Box>` the parent rebuilds. Measured at 200 experiences: 2460 ms per hover before, 15 ms after
- Click marker -> toggle selected experience
- Multi-location selected -> fit bounds to all selected in-region points, or to all of them when none is in region — the same qualifier the marker and highlight rules carry, so a list click and a map click frame the same experience the same way

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
