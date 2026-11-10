# ADR-0191: The OpenStreetMap layer keeps food-and-drink venues as points read by nearness

**Date:** 2026-11-10
**Status:** Accepted
**Issue:** [#2311](https://github.com/uncovering-world/track-your-regions/issues/2311)
**Narrows:** [ADR-0134](0134-openstreetmap-is-read-from-a-layer-cut-from-the-planet-and-a-miss-the-layer-cannot-vouch-for-is-asked-live.md) decision 2 (the tags that select an object)

---

## Context

Squares & streets admits a street by how widely it is described and read. A traveller walks many
streets for something else: the cafés, restaurants and bars along them. The measurement of
2026-11-10 on #2311 read every candidate of the kind within Berlin, Istanbul and Kazan (9,031, 217
and 680 items). It counted OpenStreetMap's food-and-drink venues within 200 m of each item's own
point, read through the QLever mirror.

- The streets the surveys list and the fame bars miss rank at the top of their city: Boxhagener
  Platz 3rd, Bergmannstraße 28th and Kastanienallee 31st of Berlin's 9,031, all at 3–4 editions;
  Bauman Street, Kazan's pedestrian heart, 2nd of 680 at 8 editions.
- The streets a curator refused rank at the bottom: Majakowskiring, a residential street in
  Pankow, is in Berlin's last 6 %.
- The maintainer decided on 2026-11-10 that every lively street is a candidate, nightlife and
  neighbourhood streets included, each arriving for a curator.

A run cannot ask the mirror street by street: one such question took 46 s. The layer is where a run
reads OpenStreetMap (ADR-0134). It keeps an object for what it is (decision 2), and a café, a
restaurant or a bar is none of the things it selects unless it carries a Wikidata item or a
`tourism` tag. On 2026-11-10 it held 40,770 of the planet's 3.45 million such venues: cafés 650,254,
restaurants 1,619,007, bars 244,141, pubs 199,720, fast food 664,105, ice cream 66,690 and beer
gardens 10,359, counted on the QLever mirror. The layer held 30.9 million objects in 10 GB. It has a
GiST index on `geom`, which the builds already carry over.

## Decision

**1. The layer keeps every food-and-drink venue.** `amenity` with the values `cafe`, `restaurant`,
`bar`, `pub`, `fast_food`, `ice_cream` and `biergarten` selects an object, beside
`place_of_worship`. `LAYER_SELECTION` holds them in its one `amenity` entry, since the flex style
reads one set of values per key.

**2. A venue keeps a point.** No kind draws one, so the layer keeps the point the flex style
locates every undrawn object by, and every tag.

**3. Each build records what it selected.** `osm_layer_builds.selection` (migration 224) holds the
selection the build was cut with, as `drawn` holds the rule it drew by (ADR-0136). A reader of
venues reads the layer only when its build names the venue values. Otherwise it treats the layer
as not read for them, never as a map with no café.

**4. The layer is read by nearness as well as by item and tag.** A reader counts the venues near a
point through the GiST index. The first such reader is the street door of Squares & streets, which
its own record decides, with its bar measured on the kind's pool over a layer that holds the
venues.

## Consequences

- The next build keeps about 3.4 million more points, about 11 % more rows. They are points, so
  the geometry grows by a few hundred megabytes, not by gigabytes.
- Until that build is swapped in, the layer holds only the venues it kept for other reasons, and
  its record names no venue value, so a reader of venues leaves it unread.
- A reader that searched the layer by name near a point now meets the venues too. The point
  hints of a World Heritage component (`pointHints.ts`) leave them out as namesakes: a Caffè
  Duomo is named after the cathedral, not where it stands.
- A venue's name, opening hours and other tags are kept as for every object. Who edited it is
  not kept (ADR-0134 decision 2).

## Alternatives considered

| Alternative | Why not |
|---|---|
| Ask the QLever mirror per street at run time | 46 s for one street, and the pool holds thousands. The mirror's usage page asks a heavy user to run their own copy. |
| Ask per city, as the measurement did | A run would need a city's boundary for every candidate, and Berlin's named streets alone came back as 22 MB. The layer is already the run's own copy. |
| Keep the venues in a table of their own | A second build of the planet for one tag. The layer is cut from the planet once a week already. |
| Count venues along the street's OSM line | Most streets' OSM ways carry no Wikidata tag (16 % in Berlin), and matching by name needs every named way of the planet. Read around the item's point, the measurement separated the walked streets nearly as well. |
