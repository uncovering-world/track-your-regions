# ADR-0212: The OpenStreetMap layer keeps whole the objects of a bridge's item, and its line places it

**Date:** 2026-11-15
**Status:** Accepted
**Issue:** [#2122](https://github.com/uncovering-world/track-your-regions/issues/2122), Epic #2115
**Narrows:** [ADR-0136](0136-the-openstreetmap-layer-keeps-a-full-geometry-only-for-what-a-kind-draws.md)
decision 1 (a full geometry only where a kind's keep rule draws it)

---

## Context

ADR-0207 placed a place by its line (`experiences.path`) and added the column empty. A bridge, a
tunnel, a causeway or a dam often belongs to both banks: the Øresund Bridge runs from Denmark into
Sweden, Itaipu's wall from Paraguay into Brazil, the Channel Tunnel from England to France. Each is
placed today by its one point, on one side or, offshore, on neither.

OpenStreetMap draws these structures as ways and relations that carry the place's Wikidata item. On
build 74 of the layer (2026-11-11), the 233 places Bridges & engineering marvels offers have 701
ways and relations carrying their items, and the layer keeps a point for every one: ADR-0136 keeps a
full geometry only for what a kind's rule draws (Archaeology's), ADR-0157 and ADR-0158 for the
items a world-view import names, ADR-0194 for the lines of Squares & streets' candidates.

The objects carrying a bridge's item are not all the bridge. Measured on those objects' geometry
(fetched once from Overpass, 2026-11-15):

- A bridge relation (`type=bridge`) lists what passes under the bridge with what crosses it: Charles
  Bridge's names 40 km of the Vltava, and would put the bridge in Central Bohemia.
- A site relation groups a dam's power station and visitor centre; a street relation a bridge's
  houses.
- A dam's reservoir carries the dam's item: Katse Reservoir lies 24 m from Katse Dam's point, and
  its 198 km shore would put the dam in every district around the lake.
- A pipeline laid on a bridge carries its item (54 ways).

## Decision

1. **The layer also keeps whole every object that carries an item of a place Bridges & engineering
   marvels offers**, as ADR-0157 keeps an import's items: `drawnItems` lists them apart (`lined`),
   the flex style keeps their objects' geometry, and the store of region shapes never reads them.
   An arrival waiting for a curator is not among them; its line comes with the first build after
   it is passed.
2. **After each swap, one statement writes each such place's line** (`writeLines`,
   `db/pathWriter.ts`, the column's one writer): the objects carrying its item within 5 km of its
   point that draw the structure itself — a way that is a highway, a railway, a dam
   (`waterway=dam`) or a bridge (`man_made=bridge`), an area relation that is one of those, and a
   route or tunnel relation. An area gives its outer ring, the rest their lines; the pieces are
   joined (`ST_UnaryUnion`, `ST_LineMerge`) into one `MultiLineString`. `path_source_ref` names the
   objects (`osm:R20039866`), the ODbL provenance ADR-0059 asks for, and `path_updated_at` the
   instant the layer is current to.
3. **The line belongs to the source that drew it**, as an outline does (ADR-0146): Bridges &
   engineering marvels (`path_source_id`). The writer never replaces another source's line or one a
   curator claimed (`curated_fields` holds `path`), and a place whose objects are gone, or that the
   kind no longer offers, keeps no line of the source's.
4. **Every place a line decides is placed again on every build**, in every world view with
   geometry (`assignRegionsForExperiences`): each place that holds a line, and each place a line
   placed before (`placedByLines`), and ADR-0207's `line` basis places them. Not only the places
   whose line changed: the lines commit before placement, and a build stopped in between would
   leave a new line that never placed its place. A failure to write the lines or to place them is
   a note on the build, the summary says which, and the layer stays.

The line is not drawn on the map: #1969 owns drawing it, its hover and its credit.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Every relation carrying the item | A bridge relation names the river under it (Charles Bridge in Central Bohemia), a site relation a dam's power station. |
| Every way and relation carrying the item, whatever its tags | A dam's reservoir and a bridge's pipeline carry the item too; Katse Dam would be in every district on its shore. |
| Read the line live from Overpass when a run reaches the place | The layer already holds every object carrying the item; a live read per bridge is a second door with its own outages, and Overpass was at capacity on the day of the measurement. |
| Keep the items of every place kind | Only lines place a place by more than its point, and only this kind's places are lines; an outline is Archaeology's (ADR-0136). |
| Place only the places whose line changed | The lines commit before placement; a build stopped between the two (an error, a worker restart) would leave those places unplaced, since the next build sees no change. Placing every place a line decides costs about a second a build on the development catalogue. |
| Include arrivals waiting for a curator | 1,091 records wait in this kind; their objects would grow the layer for places no reader is shown, and a pending place's regions are curators' only. |

## Consequences

**Positive:**
- On the development catalogue, read against those objects' geometry, 194 of the 233 offered places
  take a line; 21 of them cross two leaves or more, 22 places gain 30 leaves in all, and 8 that were
  in no region are placed: the Channel Tunnel in England and Hauts-de-France, the Øresund Bridge in
  Hovedstaden and Skåne, Itaipu in Paraná (Brazil) beside Alto Paraná, the Pelješac Bridge in
  Dubrovnik-Neretva. No place loses a row.
- The layer grows by about 0.5 MB of geometry (687 objects, 30 thousand points) over its 12 GB.
- The lines follow the planet: each build reads them again.
- Placing every place a line decides costs about a second a build: read-only on the development
  catalogue, over the kind's 233 offered places in world view 5 (the one with geometry), the geometry
  rows take 0.54 s warm (1.1 s cold), the points' leaves 53 ms, the line arm about 30 ms and the
  region rows 13 ms.

**Negative / Trade-offs:**
- The line is only as long as the objects that carry the item: the King Fahd Causeway's item is on
  two ways 3.7 km long at the Bahraini end, so it stays in Bahrain only, and Kariba Dam's wall lies
  wholly on Zambia's side of the test hierarchy's border.
- The test hierarchy's coarse borders decide a share: the Sarajevo Tunnel of Hope is put in
  Republika Srpska, the Three Countries Bridge in Basel-Stadt (#2135 owns the border sliver).
- A curator who passes a bridge waits for the next build for its line.

## References

- Related ADRs: ADR-0136 (decision 1 narrowed), ADR-0157, ADR-0146, ADR-0207, ADR-0059, ADR-0069
- Related docs: `docs/tech/dumps.md` § The OpenStreetMap layer, `docs/tech/experiences.md`
  § Region assignment
- Issue: #2122 (Epic #2115); drawing the line: #1969
