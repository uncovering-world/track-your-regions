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

## One listener per registration, not per handler

### The problem

`map.on(type, layerId, fn)` creates an **independent delegated listener** for each call. Registering the same handler over three overlapping layers gives three listeners, each of which queries its own layer and calls `fn` — so a click that lands on two of them runs the body **twice**.

Overlap is easy to build without noticing. Map Mode's count badge is a circle at `circle-translate: [8,-8]` with its number at `text-offset: [0.88,-0.88]`: the two sit on the same eight pixels, so a click on the badge hits both badge layers.

### The consequence

A handler that is not idempotent undoes itself. `onMarkerClick` toggles the per-object fold (#558), so a badge click folded and unfolded in the same gesture and the pin did not move — while a click on the marker dot, which hits one layer only, worked. Nothing throws, nothing logs, and the affordance simply does not respond.

### The fix

Register once on the map and let the handler decide, since it already asks which layers were hit:

```ts
// One listener; returns early when the query yields nothing
map.on('click', onMarkerClick);
map.off('click', onMarkerClick);   // cleanup takes the same shape
```

### The rule

**One handler, one registration.** Registering the same handler across layers that can overlap is what runs it twice — a single-layer registration is one listener whatever the handler does, which is why `map.on('click', 'clusters', …)` navigating on its own layer is fine. Where layers do overlap, only idempotent handlers may stay per layer: `mousemove` may, because painting the same ring twice is painting it once. Anything that toggles, counts, navigates or mutates must be registered once, on the map.

`mouseleave` is not one of them, and idempotency is not what makes it safe. Over overlapping layers it fires a *spurious* leave: moving from a pin onto its own count badge leaves the marker layer while the pointer has not left the pin, and clearing there — once is already too many — takes the popup and the hover ring off something the reader is still pointing at. A per-layer `mouseleave` over layers that overlap needs a condition of its own: that the thing under the point is not the thing the hover is already on. That means one leave handler across every overlapping layer, reading one key space — not one per layer, each blind to the others. `useMarkerInteractions.ts` carries that check for its four: a leave arriving *after* a sibling layer's `mousemove` has set the hover would otherwise clear what the reader has just arrived at, and within one DOM move the handlers run in registration order.

Two trackers over one visual are the accepted alternative, and `useDiscoverMap.ts` is the example: a marker hover and a highlight-dot hover mean different things and call different callbacks, so they cannot share a key. The price is that a leave which ends one of them must *hand the ring over* to the other rather than merely keep it, since each side dedupes on its own tracker and a ring left alone stays where the pointer no longer is. Hand over the visual only. Writing the other tracker's key is the trap: its own `mousemove` is registered later and runs later in the same DOM move, and a key already set makes it dedupe — so the visual moves and the callback that tells the rest of the app never fires.

A visual whose owner sets it from a one-shot `mouseenter` cannot be reset by anybody else, because nothing will put it back. `mouseenter` fires once and does not fire again while the pointer stays on the layer, so a sibling layer's leave that resets the cursor over a cluster leaves the default arrow on a bubble that is still clickable, until the pointer leaves the cluster too. This is not the same-target check in another form — a cluster is never the thing the hover is *on*; it owns the cursor and nothing else — so ask separately, and ask in the cluster's own leave as well, about the pins and dots its bubble covers. `useDiscoverMap.ts` does, in three places. Map Mode gets away without it only because its source is unclustered and it has no `mouseenter`-set cursor to strand.

Test it against both paths. MapLibre's delegated `mouseleave` fires from a `mousemove` that no longer hits the layer *and* from a `mouseout` when the pointer leaves the canvas — and only the first guarantees the point is off the feature. A `mouseout` carries the point the pointer left *from*, which is still on the pin whenever it left onto an overlay drawn above the map, and after it `mousein` is false, so no further leave arrives until a feature is entered again. A same-target check that trusts that point leaves the hover lit for good; check `e.originalEvent.type` before trusting it.

A global registration gives up one thing the delegated form did for free: MapLibre checks `getLayer(layerId)` before querying, so a click while those layers are absent did nothing. Naming a missing layer in `queryRenderedFeatures` fires an `ErrorEvent` and logs — and layers do go absent, since a component that returns `null` while its data loads unmounts its `<Source>`/`<Layer>` tree while the handler effect stays attached. Open the handler with the same check:

```ts
if (!map.getLayer(LAYER_MARKERS)) return;
```

## MVT tiles expose a column subset

### The problem

Martin tile functions (`tile_world_view_root_regions`, `tile_region_subregions`, etc.) SELECT specific columns for rendering performance. They do NOT include every column from the `regions` table. In particular:

**Included:** `id`, `region_id`, `name`, `parent_region_id`, `color`, `uses_hull`, `has_subregions`, `using_hull`

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

Discover creates its own `maplibregl.Map()` with an inline style object (separate from the shared `MAP_STYLE` constant), in `discover/useDiscoverMap.ts`. When changing glyph URLs or fonts, update BOTH the shared style and the inline style.

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

## WebGL is a hard requirement, and it throws

### The problem

MapLibre draws **every** map through WebGL. That includes the surfaces whose
tiles are plain raster PNG — `MAP_STYLE` is an OSM raster source, and Discover
builds its own raster style inline — so "our tiles are raster" buys nothing.
When no context can be created, `Map._setupPainter` **throws**:

```js
const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
if (!gl) { throw new Error('Failed to initialize WebGL') }   // maplibre-gl 4.7
```

### The consequence

The throw lands inside whatever effect constructed the map — a `useEffect` for
the imperative surfaces, react-map-gl's own effect for the declarative ones.
There is no error boundary in the app, so it does not degrade the map: it
unmounts the tree containing it. Discover took the entire page down this way,
list and all.

The main map failed differently and worse. Its tile-state hook never saw a
`sourcedata` event, so `tilesReady` stayed false, the stall timer elapsed, and
the UI settled into "Some map areas are still loading — panning and zooming
still work". Nothing was loading and nothing would pan. A permanent failure that
renders as a temporary one is the expensive kind: the user waits.

### The fix pattern

Ask before constructing, never after — there is no "after" to catch.
`isWebGLAvailable()` (`utils/webgl.ts`) probes the same contexts in the same
order MapLibre does, so it cannot answer yes where the library would fail, and
caches, since the answer cannot change without a page reload.

Two shapes, and the choice between them is not stylistic:

- **`GuardedMap`** — `react-map-gl`'s `<Map>` with the check already inside.
  Alias it to whatever local name the file uses
  (`import { GuardedMap as MapGL } from '…/GuardedMap'`) and nothing else in
  the file changes. Children (`Source`, `Layer`, `NavigationControl`) still come
  from `react-map-gl/maplibre` — they only render inside a map, so they go with
  it. This is the default; it arrives by import rather than by remembering.
- **An early return** in the component. Use where overlays, hover cards,
  legends or toolbars are positioned *over* the map — they describe or drive it,
  so they have to disappear with it rather than float above an explanation.
  `RegionMapVT`, `CvMatchMap` and `GapContextMap` take this shape, and Discover
  and `LocationPicker` do the equivalent for their imperative maps.

The same reasoning covers overlays that are *about* the map without driving it.
Discover's "Click a source tag … to see experiences on the map" and the image
dialog's "Upload an image to see preview" are both absolutely positioned over
their pane and are the default state, so ungated they land on top of the
explanation and advertise a map that is not there. Both are gated on
`isWebGLAvailable()`.

### Why the guard lives in the component and not at the call sites

The first pass at this wrapped each map by hand, and enumerated the surfaces by
grepping for `maplibre-gl`. That found 7 files and missed 12, because a
component importing only from `react-map-gl/maplibre` never contains the string
`maplibre-gl`. The real count is 19 files. Use
`grep -rE "<(Map|MapGL)( |$|>)"` if you ever need to audit it again — but the
point of `GuardedMap` is that you should not have to.

### Testing it

jsdom has no WebGL, so the unavailable branch is the default in unit tests —
which is exactly why this went unnoticed: the surfaces that would have thrown
were mocked out of every suite (`App.test.tsx` mocks `MainDisplay` for this
reason). A guard test asserts *both* that the explanation renders and that
rendering does not throw, since those were the same bug.

For the opposite direction, Playwright's headless Chromium ships WebGL via
SwiftShader with **no launch flags** (verified: ANGLE / Vulkan / SwiftShader
driver), so an e2e spec can assert a real `canvas.maplibregl-canvas` exists at
non-zero size — and that the fallback text is absent, or it would pass against
the very state we now render on purpose.

### What this is not

A fallback renderer. Issue #477 tracks that, and it is a larger question than it
looks: the basemaps are already raster, so what would have to change is the
painting engine, not the data — and `RegionMapVT`'s data-driven paint, LOD
levels, heatmap shader and `feature-state` hover have no raster equivalent.
