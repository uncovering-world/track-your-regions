# ADR-0157: The OpenStreetMap layer keeps whole the objects of the items a world-view import names

**Date:** 2026-10-27
**Status:** Accepted — decision 1 narrowed by [ADR-0158](0158-the-openstreetmap-layer-also-keeps-whole-the-items-the-mapshapes-of-imported-pages-list.md)
**Issue:** [#2085](https://github.com/uncovering-world/track-your-regions/issues/2085)
**Narrows:** [ADR-0136](0136-the-openstreetmap-layer-keeps-a-full-geometry-only-for-what-a-kind-draws.md) decision 1 (a full geometry only where a kind's keep rule draws it)

---

## Context

A world-view import matches a region to GADM divisions by comparing the region's own outline with
theirs (Geoshape Match, the spatial pass, the coverage comparison). Those readers take the outline
from the store of region shapes, `workbench.wikidata_geoshapes`, under the region's Wikidata item.
That store was filled from Wikimedia Maps, which draws a shape from the OpenStreetMap relation that
carries the item. #2084 stopped those reads, so since then nothing fills the store under an item
and the match falls back to markers for every region.

The planet is already held locally (ADR-0134), and the layer selects every object with a
`wikidata` tag (`nwr/wikidata`), so the objects that carry a region's item are rows of
`osm_objects` already. ADR-0136 decision 1 keeps them as one point each, because no kind draws
them.

Measured on the dev database, 2026-10-26, layer of build 26 (planet of 2026-10-19):

- The Wikivoyage world view (id 2) names 2,853 items. In the layer, 1,342 of them are carried by an
  administrative boundary relation, 156 by another relation, 21 by ways alone and 90 by nodes
  alone. 1,101 are carried by no object.
- The other world view with an import (id 30) names 2,866 items. Together the imports name about
  2.9 thousand distinct items.
- Cut from the kept planet of 2026-10-19, every `boundary=administrative` relation and every
  `place` relation (`osmium tags-filter planet r/boundary=administrative r/place`) is a file of
  1.52 GB with 927,339 relations, 3,979,738 ways and 187,949,794 nodes. The cut took 6 min 37 s.

## Decision

**1. The layer also keeps whole every object that carries an item a world-view import names.** The
items are the Wikidata ids under which `region_import_state` holds a region (`drawnItems`). The
build writes them to a file the flex style reads (`OSM_LAYER_DRAWN_ITEMS`), and an object whose
`wikidata` tag is among them keeps its full geometry as an object a kind draws does. Every other
undrawn object keeps its point, and ADR-0136 decision 1's rule for that point stands.

**2. Each build swapped in refills the store's item shapes from the layer.** An item's shape is the
largest area among the relations and ways that carry it, a relation before a way. It is simplified
to about 100 m (0.001°) and made valid (`refillRegionShapes`). The match compares it with GADM's
outlines simplified at about 1 km (`geom_simplified_medium`), so the detail dropped is never read.
The refill is one statement: a shape no object draws any more goes, and the store's Commons map
shapes (`commons:<file>`) are left as they are. A refill that fails leaves the layer in place and
the last build's shapes, and the build says so in a note.

**3. A shape cut from the layer is OpenStreetMap's work under ODbL.** It is kept with that licence
(`ODbL-1.0`), and every dialog that draws it credits "© OpenStreetMap contributors" beside it
(`shapeCredit`), as ADR-0059 decision 3 asks of a site's outline.

An item an import names for the first time has its shape from the next build. Until then its
region is matched by its markers, as every region is today.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep every administrative boundary and `place` relation whole | 927 thousand relations and their 188 million nodes, in a cut of 1.52 GB, against about 1.5 thousand relations the imports ask for. ADR-0136 dropped such shapes because no reader used them. |
| Read each shape live from the OpenStreetMap API when a match asks | One call per region, on every match of a whole import, against an API that asks for no bulk reads. The planet is already held for exactly this. |
| Simplify the shape in the flex style | osm2pgsql's Lua geometry offers simplification only for lines, so a polygon would be kept whole in the layer and simplified after the load anyway. The layer keeps the object whole, and the store keeps the simplified copy. |
| Keep the shape in `osm_objects` and have the match read it there | The readers of the store would each need a second path, and a store row is what they already read, with the not-available marker and the licence beside it. |

## Consequences

**Positive:**
- The match reads a region's own outline again, for every item an OpenStreetMap relation or way
  carries, including regions that are no administrative unit, such as a coast or a peninsula.
- The layer grows only by the objects the imports name, about 1.5 thousand outlines rather than
  927 thousand. They include every country and most first-level subdivisions an import names, whose
  boundaries hold many of the 188 million nodes the measured cut read, so the growth in points is
  not small. The next build measures it on #2085.
- The shapes follow the planet: each weekly build replaces them.

**Negative / Trade-offs:**
- An item a Wikivoyage `{{mapshape}}` names but no import holds is not drawn.
- A region whose item no relation or way carries keeps no shape (1,101 of world view 2's items).
- An import that names new items waits for the next build for their shapes.

## References

- Related ADRs: ADR-0136 (decision 1 narrowed), ADR-0134, ADR-0059 (provenance and the
  OpenStreetMap credit)
- Related docs: `docs/tech/dumps.md` § The OpenStreetMap layer, `docs/tech/world-view-import.md`
- Issue: #2085
