# ADR-0136: The OpenStreetMap layer keeps a full geometry only for what a kind draws

**Date:** 2026-10-22
**Status:** Accepted
**Issue:** [#1437](https://github.com/uncovering-world/track-your-regions/issues/1437)
**Narrows:** [ADR-0134](0134-openstreetmap-is-read-from-a-layer-cut-from-the-planet-and-a-miss-the-layer-cannot-vouch-for-is-asked-live.md) decision 2 (every object with its full geometry) and decision 1 (at most three connections to the planet's host)

---

## Context

The first build of the layer (dump build 26, 2026-10-22, planet of 2026-10-19 brought to diff 5153)
kept 30,843,539 objects. `osm_objects` took 24 GB, about 16 GB of it geometry: 1,020 million points.
The load took 44 minutes of the build's 2 h 43 min. Updates are due weekly, so the build's cost
recurs.

One reader uses the geometry: the Archaeology run draws a site's extent from it. It draws only what
its keep rule names (`OSM_KEEP_WKT`): a ruin, a dig, or the protected area around one. Those objects
hold 60.6 million of the 1,020 million points, about 6 %. Most of the rest comes from objects
selected only for their `wikidata` or `wikipedia` tag: rivers, lakes, forests and administrative
areas, with 658 million points between them. No reader uses their shape. The visit witnesses read
only tags, and so does the dig enumeration.

The layer keeps every object for its tags (ADR-0134 decisions 2 and 3): a regional tier may later
find a museum or an attraction with no Wikidata item in it. The question was whether those objects
also need their shape.

The first build also measured the download: three connections fetched the 95 GB planet at about 14
MB/s, which took 78 minutes. ADR-0134 decision 1 holds the planet's host to three connections, the
cap `docs/tech/dumps.md` sets for Wikimedia's hosts. The OpenStreetMap wiki asks for HTTPS, for
command-line tools rather than a browser, and for a check of the size first. It caps no connections.
It says the planet is served from S3 buckets with unlimited bandwidth.

## Decision

**1. The layer keeps an object's full geometry only where a kind's keep rule draws it.** The drawn
rule (`LAYER_DRAWN`) is the union of the keep rules the kinds hand the reader. Today that is
Archaeology's alone: `historic` among the ruin values, `ruins` or `archaeological_site` with any
value but `no`, `man_made` among the ruin values, and a protected `boundary`.

Every other object keeps every tag and one point:
- a node keeps its own point;
- an area, or a relation with areas among its members, keeps the pole of inaccessibility of its
  largest polygon. That point lies inside the object;
- a line, or a relation of lines and points, keeps its centroid. That point may lie off the object.

The point locates an object. Nothing may be placed by it: not a region assignment, a containment,
or a distance taken as the object's own.

**2. A shape the layer does not keep is asked of OpenStreetMap live.** Each build records the drawn
rule it was cut with (`osm_layer_builds.drawn`). A read whose keep rule asks for outlines that the
layer in place was cut without is not answered from the layer at all (`layerDraws`). It goes live
whole, so a point is never read as an outline. A kind that needs a new class of outline in bulk
widens the drawn rule. Its reads go live until the next update cuts the layer again from the kept
planet with the wider rule.

**3. The planet's host is held to eight connections.** This applies to `planet.openstreetmap.org`
alone (`CONNECTIONS_OF`). Every other host keeps three, and the other asks of ADR-0134 decision 1
stand: HTTPS, the bot `userAgent()`, and no retry.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep every object's full geometry (ADR-0134 as written) | 24 GB and a 44-minute load each week, for shapes that no reader uses. |
| Also drop the selectors other than `wikidata` and `wikipedia`, with no `wikidata` tag (`man_made`, `tourism`, `place`) | About 20 million objects and 2.5 GB of tags less. A regional tier could then never find a museum or an attraction that has no Wikidata item. |
| No geometry at all for undrawn objects | Saves a little more, but the layer could no longer say even roughly where an object is. The point costs about 50 bytes. |
| A centroid for every undrawn object | The centroid of a ring-shaped or a bent area can lie outside it. The pole of inaccessibility is inside, at the same cost. |
| Reduce the geometry after the load (`UPDATE … SET geom = ST_PointOnSurface(geom)`) | The table is written once in full and then rewritten. That costs more than writing a point in the flex style, and leaves dead rows to vacuum. |

## Consequences

**Positive:**
- The table is estimated at about 7 GB instead of 24, and the load and the GiST index shrink with
  it. The next build measures both on #1437.
- No reader changes what it shows: every outline the catalogue draws is still in the layer.
- A first build, and a rebuild from a weekly copy, download the planet with eight connections
  instead of three.

**Negative / Trade-offs:**
- The layer answers no geometry type for an undrawn object (`geometryType` is null), while a live
  door answers the type of every object. Nothing reads it.
- A future reader that needs a new kind of outline either asks live or waits for a new cut after
  the drawn rule is widened.
- A line's point may lie off the line, so a reader has to keep to the rule in decision 1.

## References

- Related ADRs: ADR-0134 (decisions 1 and 2 narrowed), ADR-0059 (provenance per fact)
- Related docs: `docs/tech/dumps.md` § The OpenStreetMap layer, `docs/tech/experiences.md` §
  Archaeology, `docs/sources/global/openstreetmap-planet.md`
- Issue: #1437
- Sources read on 2026-10-22: [Planet.osm](https://wiki.openstreetmap.org/wiki/Planet.osm),
  [osm2pgsql manual](https://osm2pgsql.org/doc/manual.html) (geometry objects in Lua:
  `pole_of_inaccessibility`, `centroid`, `geometries`)
