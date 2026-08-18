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

`ExperienceMarkers`, `ExperienceList`, `SelectedObjectFoldControl` and `DiscoverExperienceView` consume `useRegionLocations(regionId, includeLost, includeChildren)` — a shared React Query hook that fetches all locations for all experiences in the region via a single `GET /api/experiences/by-region/:regionId/locations` call (5-min staleTime). This replaces the previous N+1 pattern where each component individually fetched `GET /api/experiences/:id/locations` per experience. All three arguments are part of the query key. `includeChildren` defaults to `false` — Map mode's readers, `ExperienceMarkers`, `ExperienceList` and `SelectedObjectFoldControl`, take that default; `DiscoverExperienceView` passes `true`, because it lists a region *and* its descendants. Those are different sets rather than different views of one.

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

**Every place, not one of them** ([#558](https://github.com/uncovering-world/track-your-regions/issues/558), ADR-0028 decision 1). A serial nomination *is* its parts, and the map used to draw one of them: Gondwana Rainforests was a single dot 171 km from any component, and the Rock Art of the Mediterranean Basin one dot for 734 rock shelters. `buildExperienceMarkers()` now emits a marker per place a reader may go to, and both surfaces call it — Map Mode and Discover cannot disagree about what an object is. Measured on Europe with the UNESCO category expanded, which is the set both surfaces were reading: its **467 objects drew 467 markers and now draw 3463**. The whole region holds 661 offered objects over 3725 visible places in the database (3531 of them under UNESCO); the app draws fewer than the raw count because an object with any in-region place draws only those. The Rock Art of the Mediterranean Basin contributes 734 of the 3463, the Frontiers of the Roman Empire 420 and Aalto Works 13. Panning at marker zoom holds a **59.9 FPS median** (p95 50 ms, worst frame 83 ms) with 1698 of them drawn.

In Map Mode a feature's `id` is `${experienceId}-${locationId}`, because the object's id now repeats across every one of its places and `id` is what MapLibre keys a feature by. Discover sets no feature id and no longer promotes one: clustering does not need it, its handlers resolve an object through `properties.id`, and that property is the experience — so promoting it would have keyed every place of an object the same, which is the collision Map Mode's composite id avoids. The hover dedupe is keyed by place for the same reason: keyed by object, the ring and popup stayed on the first part the pointer touched while it crossed the other thirty-nine. A row's hover rings **every** place of its object — in Discover, where the source is clustered, that means a ring on each of its drawn pins plus one on each cluster bubble holding the rest, since a bubble sits at its members' centroid rather than at any of them.

**The fold: one object, back to one pin.** Drawing every place is right by default and wrong for a few rows — the Rock Art of the Mediterranean Basin and the Roman limes own a third of the 3463 pins Europe's UNESCO category draws — so a reader can fold *one object* and leave its neighbours drawn. The ask lives on the object: a chip at the top of the map for the selected object, a click on a folded pin to unfold it, and — in Map Mode — the count chip on a list row, filled when folded. Discover's rows carry a plain count instead, so a fold is asked for there by selecting the object and using the map's chip. It is held per region and per surface by `useCollapsedExperiences(regionId)`, derived rather than reset by an effect; Map Mode and Discover hold their own, because two readings of a region are two sessions of looking.

A folded object is drawn at the coordinate the catalogue answers with — the place nearest its own published point (ADR-0028 decision 2) — so folding never invents a centre.

**Which places an object draws is shared; what a fold means to a given surface is not.** `representablePlaces()` and `isFoldable()` in `buildMarkers.ts` are the shared half, and a caller asks whichever it needs — the count, the test, or both — rather than re-deriving the in-region preference for itself. The fold is applied by each caller, because the surfaces genuinely differ: in Map Mode `shownPlacesFor()` answers `null` for "draw the object's own point" and the highlight layer and the list-click fly-to both read it, so a fold survives selecting the row — without that, selecting would put an object's parts back, since a selected object leaves the marker source and is drawn by the highlight layer. In Discover the selected object is drawn from its own per-experience fetch instead, so its fold control, its hover ring and its highlight all read *that* set, and its marker source reads the region batch. A caller that borrows another's coordinate set gets the wrong answer for exactly the objects this feature is about.

**What the count badge means** is "places this pin stands for", which is `locationCount > 1` on the feature. A place drawn as itself stands for itself alone and carries none; a folded pin and a pin standing in for places the region batch has not loaded carry the count. That badge is the only thing that tells a *reader* a folded object from a single-placed one — the two are otherwise the same dot. A click handler must not read it that way: a stand-in pin has the same null `locationId` and the same count above one without being folded, so `MarkerData.folded` says which pins the builder drew folded and both surfaces test that flag. Inferring it from the badge is what made a click on such a pin drop the fold, select nothing and visibly do nothing.

Map Mode uses three GeoJSON sources:

- `exp-markers`: the in-region places, unclustered — one marker each, or a single folded marker for an object the reader folded, or a single stand-in marker for an object whose places the batch does not hold. Below `HEATMAP_MAX_ZOOM` (5) it draws as a density heatmap — which now measures where the *places* are rather than where their objects were pinned; from that zoom it draws as individual markers
- `exp-highlight`: the places the selected experience *shows* — `shownPlacesFor()`, so a folded object is one point here as well, and otherwise its in-region places or all of them when none is in region, matching the marker fallback below, so a hand-assigned experience does not vanish the moment it is selected — or the experience's own point when no locations have loaded for it at all, which is the common case in a region fetched without descendants. Selecting removes the marker from `exp-markers`, so without that last case the act of selecting made the experience disappear
- `exp-hover`: hover ring/glow

For an experience with no in-region place at all, every place it has is drawn instead. That state is what a curator's manual assignment produces: `assignExperienceToRegion` writes `experience_regions` alone, and the reason to assign by hand is that spatial containment missed the point. Skipping those left the row without a marker, so hovering it painted nothing and left the previously hovered row's ring standing in for it — `updateHoverFromList` now clears the ring when it finds no marker rather than returning bare. `representablePlaces()` is that rule, and every surface asks it through that one function rather than re-deriving it. Selected experience markers are removed from `exp-markers` and rendered via `exp-highlight` instead — which follows the same fold, or selecting a folded object would put its parts back.

Map Mode builds a marker for every place — `buildExperienceMarkers()` in `components/experienceMarkers/buildMarkers.ts`, a pure function of the experiences, their locations, the expanded category set and the folds this surface holds for this region (`collapsedExperienceIds`). It used to stop at 100 and show an on-map indicator saying so. The cap was removed because it silently disabled the list→map hover past it: the highlight resolves an experience through the marker set, and returns without a sound when it is absent, so in a 200-experience region half the rows hovered to nothing. The heatmap is what makes the full set affordable to render below its threshold.

### Density instead of clusters

Overview zoom shows a heatmap rather than clustered counts. It replaces clustering rather than sitting beside it: a clustered source cannot drive a heatmap, because MapLibre substitutes aggregates for the points and the heat would be computed from cluster centroids. With `cluster` off, the one source serves both the heatmap below `HEATMAP_MAX_ZOOM` and the individual markers from it.

Three paint properties carry the design, and each is set against a specific failure:

- `heatmap-radius` is **flat** (16px). It is in screen pixels, so zooming in spreads the points across more of the screen while the blur stays the same size — which is what makes a blob resolve into the structure inside it. Growing it with zoom cancels exactly that.
- `heatmap-intensity` **rises with zoom, from well below 1**. Because the radius is fixed, each zoom level covers roughly a quarter as many points and density falls about fourfold per level — flat intensity made the layer fade out on the way in. The overview value is held low for the opposite reason: at 1 a single lone point peaked near the top of the ramp on its own, so a one-site town read the same as Rome and the continent came out a single blob. Saturated density cannot be separated by any palette, because every such pixel asks the ramp for the same value.
- `heatmap-color` is an **inferno ramp**, cold to hot. A single hue at varying alpha can say "something is here" but not "much more here than there".

The handover is a cross-fade, not a threshold. `minzoom` cannot express one — MapLibre applies no fade to circle or symbol layers at a zoom bound, so markers bound to `HEATMAP_MAX_ZOOM` appeared at exactly z5 while the heat had already ramped to nothing just below it, leaving a band around z4.9 with faint heat and no markers. Both now span `MARKER_FADE_START` → `HEATMAP_MAX_ZOOM` and ramp opacity across it in opposite directions.

Removing clustering removed the only asynchronous path in the hover: `getClusterLeaves` was what made an answer arrive after the pointer had moved on, and the ownership-token machinery existed solely to discard those stale answers. A list hover now paints the ring on the marker's own point directly — `updateHoverFromList` takes no map handle at all, which also removed a guard that had started skipping the "clear the ring" branch whenever the map was not ready yet.

Discover Mode still uses clustering (cluster circles, count labels, fold badge, hover ring, selected-location highlights) with a dedicated map instance and imperative MapLibre event wiring — the heatmap is Map Mode only. Its clusters count **places** since #558: measured on the same set as above — UNESCO in Europe — 467 objects draw the same 3463 points, the largest clusters reading 843 over central Europe and 526 over the Balkans. What a cluster label counts is rendered features rather than places represented, which are the same number until a reader folds something: a folded object contributes one feature to the cluster while its own badge still says how many places it stands for. A cluster of one-point-per-object counted sites; a cluster of places counts what a reader zooming in is about to be shown.

## Interaction behavior

- Hover map marker -> popup + hover ring + list highlight
- Hover list card -> hover ring on the marker's own point, whether or not it is currently drawn (below the heatmap threshold the heat is what shows there instead). The row is memoised and its props are held stable so this costs one row's render rather than the region's: the handlers are declared once in `ExperienceList` rather than per row, the shared hovered-location id is narrowed by `ownedHoveredLocationId()` to the row that owns it, and each row registers its own scroll ref instead of being wrapped in a `<Box>` the parent rebuilds. Measured at 200 experiences: 2460 ms per hover before, 15 ms after
- Click marker -> toggle selected experience, and **keep the view** — except a *folded* pin, whose click unfolds the object and selects nothing: the pin is one named place now, so framing all of the object's places would take the one the reader clicked off the screen
- Multi-location selected **from the list** -> fit bounds to all its shown points, or to all of them when none is in region — the same qualifier the marker and highlight rules carry. A list click means "take me to it" and a map click means "this one, here", which is why only one of them re-frames

## The list renders the rows in view

The list reads as groups and renders as one sequence. `flattenGroups()` in `ExperienceList/utils.ts` turns the category groups and the experiences of the expanded ones into a flat `FlatRow[]`, and `useVirtualizer` from `@tanstack/react-virtual` mounts only the rows the scroll window covers. A collapsed group contributes its header alone, which is what `unmountOnExit` did before, arrived at differently.

**A card is mounted straight into its row, and the row measures itself before paint.** Both halves are needed, and each was learned by getting it wrong.

`measureElement` observes through a `ResizeObserver`, which reports after layout: in the frame a card opens the row grows by some 560 px while its neighbours still sit at offsets computed for a collapsed one, so the row below is drawn *inside* the card, printing its title across the picture. Measured on the live list, 702 px. The pre-paint measurement that closes it has to be driven from `ExperienceListItem`, because the readiness that opens a card is that component's own state — its ancestors do not re-render in that commit and cannot measure it in time.

And the card is rendered directly rather than through a `Collapse`. There is no animation to run, and the wrapper was not free: MUI sets the wrapper's height through its transition machinery, a task later than the commit that inserted the card, so the row grew where nothing re-rendered to measure it. With the content mounted straight in, the insertion, the new height and the layout effect that reports it all land in one commit.

The same reporting covers what happens *inside* an open card — the picture arriving in a card the cap opened without it (266 px), and the points outside the region unfolding — because that state belongs to the card, which re-renders without the row and so cannot be measured from above. Each reports its own height change in a layout effect, and both land on the one measurement. The works list does not report, and does not need to: it is a 300 px scroller whose "show all" link only appears once its contents already overflow it, so the row's height is the same before and after.

`experience-list-layout.smoke.spec.ts` keeps the opening honest by sampling **every animation frame** rather than polling: the fault it guards against lasted a single frame, and a 50 ms poll steps straight over it. It caught this one when a pre-paint measurement placed in the wrong component looked correct and did nothing.

Rows here are of unequal height — a header is one line, an expanded experience carries its locations — so the sizes are measured rather than assumed, via `measureElement` and a `getItemKey` that keys the measurement cache by the row's identity instead of its index. `admin/WorldViewImportTree.tsx:393,613` is the prior art for that; `RegionList.tsx:238` also virtualises but with a fixed `estimateSize: () => 48`, and needs none of it.

The region is still read whole (`WHOLE_REGION_LIMIT`, see above) and every marker is still built: windowing is about what the DOM holds, not about what was fetched. The scrollbar covers the region, so this is not paging under another name.

Measured on Europe, whose UNESCO category holds 467 rows, from selecting the region to the list settling — dev build, so `StrictMode` doubles the renders:

| | rows mounted | DOM nodes | mean FPS | worst frame | blocked total | longest single task |
|---|---|---|---|---|---|---|
| before | 467 | 9474 | 36.1 | 567 ms | 3839 ms | 2571 ms |
| after | 18 | 2639 | 47.8 | 350 ms | 1638 ms | 626 ms |

The longest single task is the number that was felt: one 2.5 s block is a frozen tab, where the same total spread across shorter tasks is a slow tab. What remains is a ~890 ms floor with zero rows mounted — map layers, the locations derivation and the impressions pass — which windowing cannot reach; `buildExperienceMarkers()` is not in it (1.8 ms for the 3679 places Europe held when that was measured; the set it builds now is stated above).

Three consequences of rows no longer having elements:

- **Scrolling to a row asks for an index, not an element.** `rowIndexByExperienceId()` gives the two scroll effects (hovered from the map, selected) a position for `virtualizer.scrollToIndex()`. The row a marker points at is usually outside the window, so `itemRefs` holds nothing for it and the element path alone would scroll nowhere without a sound; that path now serves the rejected rows, which render outside the virtualiser and so have an element and no index. Verified live: clicking a Danish pin selected *Jelling Mounds, Runic Stones and Church* and moved the list from row 487 to a window centred on row ~202. That row-index map is read through a ref and is the one thing deliberately absent from both effects' dependencies (`virtualizer` stays, being stable across renders) — the index map is rebuilt whenever the rows change, and expanding a group is not a change of selection. The scroll no longer glides: `scrollToIndex` jumps, where the helpers it replaced passed `behavior: 'smooth'`, because TanStack documents smooth scrolling as unsupported alongside dynamic measurement — a jump to the right row beats a glide to a stale offset.
- **Category headers are rows too.** The header of a group below the window is not in the document — anything looking for one has to scroll to it first.
- **A New-badge impression reports what the viewport intersects.** `experienceIdsInVisibleRange()` reads `virtualizer.range`, not the mounted rows: `getVirtualItems()` includes the eight `overscan` rows on either side, which are mounted precisely because they are *not* in view. The server keeps the *first* impression, so reporting an expanded group's 467 experiences spent 467 personal "new" windows on rows the reader had not reached — and reporting the overscan would be the same mistake eight rows at a time. Verified live: scrolling to *Lemnian Athena* sent `{"experienceIds":[6940]}` — that row and no other. The reports are also flushed on a timer (`SEEN_FLUSH_MS`), because the seen-set now changes as the reader scrolls and `authenticatedLimiter` allows 60 requests a minute per IP across every authenticated call; ids accumulate between flushes, so this bounds how often rows are reported, never which of them are.

Separately — and true of any virtualiser here, fixed-height rows included — the virtualiser does not know where the list starts. Row offsets begin at zero while the scroll container's do not: a curator has the "add a category" box above the list, putting it 47 px down, so the computed range is off by that much where `overscan` does not cover it. `scrollMargin` is the remedy, but the documented way to measure it — the list's `offsetTop` — reads 102 px here, because the scroll container is `position: static` and so is not the offset parent. A wrong margin shifts the range for every reader where none shifts it only for curators, so the margin is deliberately absent and the gap is tracked as #556.

### A card opens at a size it keeps

Measuring rows makes every intermediate height a layout pass for the rows below, so a card that grew into place moved the whole list with it. Measured while expanding one card: six heights in 389 ms, the rows underneath moving six times across 489 px.

**A card is therefore not opened until its size is known.** `useExperienceCardReady()` waits for the four things that decide it — the details query, the contents query, the picture, and the region's locations batch — and only then is the card mounted into the row. The batch is a whole-region request rather than a per-card one, and it belongs inside the gate rather than beside the condition that mounts the card, so that the cap covers it too: a batch that never settles must not leave a row that never opens. Waiting shows where the chevron already is, as a small spinner inside the row that already exists, so a card being fetched moves nothing at all. Settled, not succeeded: a picture that 404s answers as fast as one that loads, and most of them do 404 (#557).

The scroll that follows is asked for by the row itself, when its card has opened — readiness is decided per row, and a second gate kept by the list started its patience at a different moment, so it could call a card open while the row still had it closed and scroll to a row that was still waiting. A row that is not mounted at all, which is what a marker click on a distant row gives, is brought into the window first so that it can open.

**The scroll belongs to the selection, not to the mount**, and that rule is what makes the arrangement safe rather than worse. A row reports on mount, because a card can mount already open — a marker click on a row whose data is cached gives no transition to observe — and a windowed row mounts afresh every time the reader scrolls back to it. So a returning open card would scroll the list to itself while the reader is the one scrolling, on every re-entry into the overscan band. `scrolledForSelection` allows one movement per selection, and the mark is cleared during render rather than in an effect: a row's effects run before its parent's, so a reset placed in an effect would clear the mark the selection had just used and let the next remount scroll again.

The row warms **the picture only** when the pointer rests on it for `HOVER_INTENT_MS`, because that is the slow part — measured at 1.3 s, against roughly 150 ms for the two queries — and because it costs the API nothing, going to the thumbnail proxy rather than to us. The queries are deliberately not warmed: they sit under `publicReadLimiter` alongside the reads that draw the list itself (`by-region`, its locations batch, the region counts), so two requests per rested row is how a list starves itself. A hovered row therefore still shows the spinner for as long as its queries take; what hovering removes is the second of picture.

Measured, not asserted:

| path | heights | opened | spinner | changes after opening |
|---|---|---|---|---|
| clicked cold | 58 → 548 | 315 ms | 28–290 ms | 0 |
| clicked cold, slow picture | 58 → 848 | 1025 ms | 35–983 ms | 0 |

Expanding a row costs one long task of **67 ms**, and collapsing it 72 ms, measured on a foreground tab in the dev build (so `StrictMode` doubles the renders). Before windowing the same act cost **784 ms across four tasks** (#552). The list still re-renders as a whole when a row opens — the suspicion the issue raised — but a whole list is now the ~20 rows the window holds rather than a category's 467, which is what made a per-row fix unnecessary.

The wait is capped at `READY_CAP_MS`, because a hung request must not leave a row that never opens; past the cap the card opens with what it has.

**Where the list ends up matters as much as whether it shuffles**, and two things were wrong there. The size estimate for an unmeasured row said 72 px where the real one is 59 (46 for a header) — in a 467-row list that is some 6000 px of height that does not exist, so `scrollToIndex` aimed past its row, and the total shrank as rows arrived and were measured, which moves content under a reader who is not scrolling and shows an **empty panel** when the position lands beyond the shrunken end. And the scroll fired at the click, taking the reader to a row that was still collapsed and still waiting, so the card opened afterwards and moved everything again.

Now the estimates come from measurement, and the scroll waits for the card and moves as little as it can: nothing at all when the opened card is already fully visible, `align: 'auto'` — the smallest movement that brings it into view — when it is shorter than the viewport, and `align: 'start'` only when the card is taller than the viewport and has to be read from its top.

Verified against both, since neither shows up in a row-height measurement: five cold rows opened from five scroll positions gave **no blank frames and one scroll movement each**, and five *different* rows clicked 240 ms apart — faster than any card can load — gave no blank frames, 163 px of total scroll travel, and exactly one card open at the end, the last one clicked.

Two further things are about promising the space before the content exists:

- The picture is given a **fixed `height: 250`**, not a maximum, and it renders only once its bytes are here. Reserving before loading was worse than not reserving at all: only 330 of 1604 experiences have a picture that resolves, so on four cards in five the box appeared and was taken away again (#557).
- **Nothing animates the card in**, and two attempts are the reason. The height cannot: it is measured, so every intermediate value repositions every row below (five heights in 290 ms, stepping at about 17 fps). Nor can the content: a `clip-path` reveal of 260 ms looked graceful slowed down eight times and read as the panel blinking at speed — inspected frame by frame at 60 fps, the rows below drop away, a large pale area stands empty for four frames, and the picture then slides into it. The eye reads "a large area changed" long before it reads "content arriving". So a card is simply there, complete, in the frame it appears; verified by sampling every frame after a click — the card exists in 60 of them and is fully painted in all 60.

A card that opens because everything settled has nothing left to append: the queries whose answers used to arrive late — a description that can be one line or ten, an artworks list that can hold twenty items — are among the things it waits for. There is no honest height to reserve for content of unknown length, so the card is not shown at the wrong length instead. The exception is the cap: a card opened because `READY_CAP_MS` ran out is opened incomplete, and whatever was still in flight appends when it lands, which is the old behaviour kept deliberately for the case where a request hangs.

## Hover preview card placement

Both Map mode and Discover mode render hover cards as React `<Box>` overlays positioned absolutely over the map container — not as MapLibre native popups. This allows consistent styling, image loading, and animation across both surfaces.

Map mode (`RegionMapVT`): positioned by marker screen location (left/right and top/bottom) to avoid covering the hovered marker.

Discover mode (`DiscoverExperienceView`): positioned in the bottom-left corner of the map — which is why the fold chip sits at the top centre (`FoldPlacesControl`), since the card would otherwise paint over it. On marker hover, the component looks up the experience in the `experiences` array by feature ID to get image URL and source name. Uses `extractImageUrl()` + `toThumbnailUrl()` for image thumbnails. Both use `objectFit: 'contain'` with `maxHeight` to handle portrait-oriented images without severe cropping.

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
