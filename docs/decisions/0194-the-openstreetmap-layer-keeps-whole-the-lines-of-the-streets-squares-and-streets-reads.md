# ADR-0194: The OpenStreetMap layer keeps whole the lines of the streets Squares & streets reads

**Date:** 2026-11-10
**Status:** Accepted
**Issue:** [#2311](https://github.com/uncovering-world/track-your-regions/issues/2311)
**Narrows:** [ADR-0134](0134-openstreetmap-is-read-from-a-layer-cut-from-the-planet-and-a-miss-the-layer-cannot-vouch-for-is-asked-live.md) decision 2 (the objects the layer keeps) and [ADR-0136](0136-the-openstreetmap-layer-keeps-a-full-geometry-only-for-what-a-kind-draws.md) decision 1 (the objects kept whole)

---

## Context

ADR-0192, still a draft on #2414, lets a street into Squares & streets by the venues within 200 m of
its point. On 2026-11-10 this test was compared on 203 street arrivals. A traveller's reading had
labelled 115 of them as walked for their life and 87 as ordinary streets of a dense core or an
artery. The point count let 27 of the 64 ordinary streets with a line through, and kept 91 of 101
walked ones. A street's point stands on one stretch of it. A long avenue whose point sits off its
lively stretch reads low, and a quiet street beside a lively square reads high.

The same arrivals were then read along their own OpenStreetMap lines, cut from the planet of
10 November. The ways were found by their `wikidata` tag, or by the item's name within 400 m of its
point. Two signals were measured: the street's highway type, and the venues within 25 m of its line,
per 100 m.

- *A car-free part and at least 1.5 venues per 100 m, or not an artery and at least 2.9 venues per
  100 m*: this kept 93 of the 101 walked streets and let 16 of the 64 ordinary ones through.
- *Items located on the street and heritage designations*, read from the Wikidata subset, did not
  tell the two apart. Ordinary core streets carry as many of both (Rue Réaumur, Nassau Street).
- *For squares, the point count reads better than a line.* It passed 21 of 23 walked squares, and
  the line test 18.

The layer holds no street line today. A highway way is selected only for a `wikidata` or `place`
tag, and it is kept as one point (ADR-0136 decision 1).

The cut was measured on 2026-11-10 against the kind's pool in the subset. That was 8,577 items with
a point, matched by 33,208 names in every kept language.

- A cut around the items' points held 8.4 million highway and place ways.
- 36,183 of them are an item's line: 14,930 by their `wikidata` tag, and 21,253 by a name within
  1 km of the item's point.
- That is 208,873 vertices, about 21 MB of the layer.
- An `osmium tags-filter` with the names as expressions read 80 of the planet's 124 GB in 40 minutes,
  CPU-bound in the ways section, and was stopped. An `osmium extract` of a polygon around the points
  read the whole planet in 11 minutes.

## Decision

**1. The layer keeps whole every highway or place way that is the line of one of Squares & streets'
candidates.** The candidates are the items of the kind's classes at its pool's floor, read from the
local Wikidata subset at each build (`streetItems`, `layerStreets.ts`). They are read with the
gather's own pool question (`kindClasses`, `subsetIdsOfClasses`), each with its point and every name
the subset holds for it. A name is a label in any language kept, or the title of one of the item's
Wikipedia articles: the local name is often found only there. The ways that can be a line are the
roads, paths and steps (`STREET_HIGHWAYS`) and a place's ways, such as a square drawn as
`place=square`. A stop's platform named after its street is none: the first run of the style found
the *Bergmannstraße* bus stop's two platforms among that street's lines. A way is an item's line in
two cases:

- its `wikidata` tag is the item, and it lies within 1 km of the item's point;
- one of its names (`name`, `name:*`) is one of the item's names, and it lies within 1 km of the
  item's point.

Such a row names the item (`osm_objects.street_item`) and keeps the way's whole line. A closed way
keeps its area only where it is a place or is tagged `area=yes`. In OpenStreetMap a closed highway
is otherwise a line: a roundabout, a looped path. A street item that arrives in the subset gets its line from the next build. The
layer's other readers read it as before, except the World Heritage components' name hints, which
leave the street lines out.

**2. The build cuts the ways near the items' points from the planet in one extract, and the flex
style matches the names.** Beside its two cuts, the build reads the planet a third time with
`osmium extract -s complete_ways` of a polygon. Its ways come whole, so a street matched by name that
runs past the polygon keeps its line beyond it. The polygon is drawn from 0.01° cells within 1 km of the points, each
row's cells joined (`streetArea`). The highway and place ways of that small cut (`osmium tags-filter
w/highway w/place`) are merged into the load. The flex style matches a way against the items from a
table it reads once (`streetsFile`), so a name costs one lookup. A list of names is never written as
`tags-filter` expressions.

**3. Each build records how many candidates it looked for and how many it found a line for**
(`osm_layer_builds.streets`, `streets_lined`). NULL on a build is a layer cut before this ADR, which
kept no street's line. A reader that finds no line for a street reads it as it did before. Lacking a
line is never a reason to refuse a place.

ADR-0134 and ADR-0136 stand otherwise as written.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep whole every named highway in the planet | Most of the planet's roads, for the 3,050 items that have a line. |
| Keep only the ways a `wikidata` tag names | 63 of the 115 walked arrivals then have a line. Another 38 are found only by their name near the point. |
| Match the names with `osmium tags-filter` expressions | It tries every expression on every way: 80 GB in 40 minutes and not finished. |
| Ask Overpass for each street when a run reads it | One query per 3 s against a public server that answered 429 and 502: 69 of 203 streets in two hours. |
| Read the candidates from the catalogue rather than the subset | A street is judged when it arrives. A list of the catalogue's places would give an arrival its line one build after it is admitted, too late for the test that admits it. |

The style was run for real before it landed: osm2pgsql 2.1.1 read a 149 MB cut of the highways and
venues around the 203 labelled arrivals in 19 s. It wrote 246,386 rows, 163,783 of them venues, and
1,802 street lines of 162 of the 203 items. Bergmannstraße came out as 21 ways and 1,308 m.

## Consequences

**Positive:**
- A street can be read along its length: its type, its length, and the venues along it, which the
  layer already keeps as points (ADR-0191).
- The lines follow the planet and the subset. Each build reads both again.

**Negative / Trade-offs:**
- The build reads the planet a third time, side by side with its other two cuts. On 2026-11-10 a
  single-pass extract took 11 minutes on its own. `complete_ways` reads the planet twice.
- The layer grows by about 36 thousand lines and 21 MB.
- A street whose OpenStreetMap name matches none of its Wikidata names, and that has no `wikidata`
  tag, has no line. On 2026-11-10 this held for 38 of 203 arrivals. Squares mapped as a node or as a
  relation have none either. Such a street is read at its point.
- A reader that asks the layer for objects near a point now also finds the street lines. The
  World Heritage components' name hints leave them out (`pointHints.ts`): a point on a line that
  runs for a kilometre is not where a component named like the street stands.
- A common name can match another street of that name within 1 km. The match takes the item's own
  tag first.

## References

- [#2311](https://github.com/uncovering-world/track-your-regions/issues/2311): the measurements on the
  203 labelled arrivals and the cut's size.
- [ADR-0191](0191-the-openstreetmap-layer-keeps-food-and-drink-venues-as-points-read-by-nearness.md):
  the venues the lines are read against.
- [ADR-0157](0157-the-openstreetmap-layer-keeps-whole-the-objects-of-the-items-an-import-names.md):
  the other objects the layer keeps whole for an item.
