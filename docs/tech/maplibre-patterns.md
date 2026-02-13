# MapLibre + react-map-gl Patterns and Pitfalls

Patterns, gotchas, and hard-won lessons from working with MapLibre GL, react-map-gl, and Martin vector tiles in this project. Consult this before writing new map interaction code.

## Overlapping interactive layers

### The problem

When multiple `<Source>` components render interactive layers that spatially overlap (e.g., ancestor context layers behind children tiles), MapLibre's `event.features` array may contain features from ANY interactive layer at the event point. **The first element is NOT guaranteed to be from the topmost visible layer.**

This causes subtle bugs where hovering or clicking a child region resolves to the ancestor's ID from a context layer underneath.

### The fix

In EVERY handler that reads `event.features`, explicitly prefer features from the "main" source and fall back to overlay features:

```ts
// Both click and hover handlers need this — not just one of them
const preferred = features.find(f => !f.layer?.id?.startsWith('context-')) ?? features[0];
const id = preferred.properties?.region_id;
```

### The rule

**When you fix a feature-preference bug in one event handler, apply the same fix to ALL handlers that consume `event.features`.** Click, hover, and any future handler (e.g., right-click context menu) all share the same feature-ordering problem.

This applies beyond context layers — any time two interactive fill layers overlap (e.g., island fills over region fills, or root overlay over leaf tiles), the handlers must establish a preference order.

## MVT tiles expose a column subset

### The problem

Martin tile functions (`tile_world_view_root_regions`, `tile_region_subregions`, etc.) SELECT specific columns for rendering performance. They do NOT include every column from the `regions` table. In particular:

**Included:** `id`, `region_id`, `name`, `parent_region_id`, `color`, `is_archipelago`, `has_subregions`, `using_ts_hull`

**NOT included:** `focus_bbox`, `anchor_point`, `description`, `area_km2`, and most other metadata

### The consequence

When a user clicks a tile feature (especially from a context layer showing a different hierarchy level), the `newRegion` object constructed from tile properties will be **missing** fields like `focusBbox` and `anchorPoint`. If you immediately fly-to using imprecise tile geometry (which can be very rough at low zoom levels), the camera position will be wrong.

### The fix pattern

1. **Don't fly immediately** when you know the data is incomplete (e.g., context layer clicks where `metadataById` won't have the region).
2. **Let an API response enrich the state.** In our case, `useNavigation` fetches `regionAncestors` which returns full `Region` objects including `focusBbox`. When the response arrives, the enrichment effect updates `selectedRegion` with the missing data.
3. **React to the enriched state.** The fly-to effect sees `selectedRegion.focusBbox` is now populated and performs an accurate fly-to.

```ts
// In useNavigation.tsx — enrich selectedRegion when ancestors API responds
const lastAncestor = regionAncestors[regionAncestors.length - 1];
if (lastAncestor?.id === selectedRegion?.id && !selectedRegion.focusBbox && lastAncestor.focusBbox) {
  setSelectedRegion({ ...selectedRegion, focusBbox: lastAncestor.focusBbox, anchorPoint: lastAncestor.anchorPoint });
}
```

### When to add columns to tile functions

Only add columns to Martin tile functions if they're needed for **rendering** (paint expressions, filters) or **interaction** (click handlers that can't wait for an API call). `focus_bbox` is NOT needed for rendering — it's only used for fly-to, which can wait 100-200ms for the API.

## Feature ID expressions

### The problem

PostGIS `ST_AsMVT(row, 'geom', 4096, 'id')` uses the `id` column as the MVT feature ID (`feature_id_name` parameter). When this happens, MapLibre **strips** the `id` column from the feature's `properties` object — it's accessible only via the feature ID.

### The consequence

`['get', 'id']` in paint expressions returns `null` for every feature. The selected/hover styles silently break — nothing gets highlighted, no errors in console.

### The fix

Use `['id']` (the MVT feature ID expression) instead of `['get', 'id']` (property lookup):

```ts
// CORRECT — reads the MVT feature ID
['==', ['id'], selectedId ?? -1]

// WRONG — 'id' was stripped from properties, always returns null
['==', ['get', 'id'], selectedId ?? -1]
```

This applies to ALL paint expressions that match by region/division ID. The pattern is consistent across `regionFillPaint`, `hullFillPaint`, `contextFillPaint`, `outlinePaint`, etc.

Note: `region_id` and `division_id` are separate properties (not used as `feature_id_name`) and ARE available via `['get', 'region_id']`.

## Feature state and multiple sources

### The pattern

When hover state needs to highlight a region across multiple tile sources (main tiles, root overlay, context layers), you must set `featureState` on EVERY source that renders the region:

```ts
const overlaySources = [
  'root-regions-vt',
  ...Array.from({ length: contextLayerCount }, (_, i) => `context-${i}-vt`),
];

// Set hover on main source
map.setFeatureState(
  { source: 'regions-vt', sourceLayer: sourceLayerName, id: hoveredId },
  { hovered: true }
);

// Also set on every overlay source (they may have the same region)
for (const overlaySource of overlaySources) {
  if (map.getSource(overlaySource)) {
    map.setFeatureState(
      { source: overlaySource, sourceLayer: 'regions', id: hoveredId },
      { hovered: true }
    );
  }
}
```

Always clear the previous hover state before setting new state. Use a ref to track the previously hovered ID.

## react-map-gl onMouseLeave limitation

### The problem

react-map-gl's `onMouseLeave` callback only fires when the cursor **leaves an interactive layer** — not when it exits the map container through empty space (ocean, areas between polygons). This means hover state gets "stuck" when the user moves the cursor off the map.

### The fix

Attach a native `mouseleave` event listener to the map container element:

```ts
useEffect(() => {
  if (!mapLoaded || !mapRef.current) return;
  const container = mapRef.current.getMap().getContainer();
  const onLeave = () => setHoveredRegionId(null);
  container.addEventListener('mouseleave', onLeave);
  return () => container.removeEventListener('mouseleave', onLeave);
}, [mapLoaded, setHoveredRegionId, mapRef]);
```

## Source key stability in react-map-gl

### The problem

react-map-gl uses the React `key` prop on `<Source>` components to track source identity. If two `<Source>` components in the same render share a key, or if a key suddenly maps to a different source ID, react-map-gl throws a "source id changed" error.

### When this happens

When different navigation states produce tile URLs from the same endpoint (e.g., `tile_world_view_root_regions` used for both `rootRegionsBorderUrl` at root level and `contextLayers[0].url` when a root-level region is selected), the raw URLs collide.

### The fix

Prefix Source keys with the source role to guarantee uniqueness:

```tsx
// Root overlay
<Source key={`root-regions:${rootRegionsBorderUrl}`} id="root-regions-vt" ...>

// Context layers
<Source key={`context-${i}:${layer.url}`} id={`context-${i}-vt`} ...>
```

The `useTileUrls.test.ts` has a "Source key uniqueness" test suite that verifies keys don't collide across representative navigation states.

## Glyph and font gotchas

### Unreliable glyph servers

`demotiles.maplibre.org/font/` — most font ranges 404. Use `fonts.openmaptiles.org/{fontstack}/{range}.pbf` instead.

### Available fonts

Only these work on `fonts.openmaptiles.org`:
- `Open Sans Regular`
- `Open Sans Bold`
- `Open Sans Semibold`

Noto Sans variants are NOT available and will silently break symbol layers.

### Silent rendering stall

If a symbol layer references a font that doesn't exist on the glyph server, MapLibre does not show an error. Instead, the **entire GeoJSON source rendering pipeline stalls** — tiles load but no features render (`usedCount=0` in debug). This is extremely hard to diagnose. Always verify font names against the available list above.

### Multiple map instances

`DiscoverExperienceView.tsx` creates its own `maplibregl.Map()` with an inline style object (separate from the shared `MAP_STYLE` constant). When changing glyph URLs or fonts, update BOTH the shared style and the inline style.

## Paint expression priority

### The rule

In `case` expressions that check multiple feature states, **selected must be checked FIRST**. If hover is checked before selected, a selected region that also has `hovered: true` (from a stale feature-state) will show hover styling instead of selected styling.

```ts
// CORRECT — selected always wins
'fill-opacity': [
  'case',
  ['==', ['id'], selectedId ?? -1], 0.22,       // selected (strongest)
  ['boolean', ['feature-state', 'hovered'], false], 0.16,  // hovered
  ['boolean', ['feature-state', 'visited'], false], 0.20,  // visited
  0.08,                                                     // default
]

// WRONG — hover overrides selected
'fill-opacity': [
  'case',
  ['boolean', ['feature-state', 'hovered'], false], 0.45,  // hover checked first!
  ['boolean', ['feature-state', 'visited'], false], 0.35,
  0.2,
]
```

## Graduated visual hierarchy with context layers

The ancestor context layer system naturally produces a graduated visual hierarchy:

| Layer type | Example | Fill opacity | Outline |
|---|---|---|---|
| **Main tiles — selected** | Germany (selected) | 0.22 (indigo) | 2px, 0.7 |
| **Main tiles — siblings** | Poland, Czechia | 0.08 | 0.75px, 0.35 |
| **Context — highlighted ancestor** | Central Europe (ancestor) | 0.10 (indigo wash) | 1.5px, 0.5 |
| **Context — ancestor's siblings** | Western Europe, Nordic | 0.03 | 0.5px, 0.2 |

This creates a clear "focus funnel" — the selected region is most prominent, its siblings provide local context, the highlighted ancestor shows "where am I in the hierarchy," and distant ancestors are barely visible background.
