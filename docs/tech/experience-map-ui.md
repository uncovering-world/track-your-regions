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
