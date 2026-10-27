# ADR-0159: A region no object draws takes the union of its child regions' shapes

**Date:** 2026-10-27
**Status:** Accepted
**Issue:** [#2113](https://github.com/uncovering-world/track-your-regions/issues/2113)

---

## Context

The world-view match reads a region's outline from the store of region shapes,
`workbench.wikidata_geoshapes`, under the region's Wikidata item. Since ADR-0157, each OpenStreetMap
layer build refills the store with the outline of every item a relation or way carries. Many of
the travel regions Wikivoyage draws are carried by none, because no boundary in OpenStreetMap
encloses them. The Middle East, West Africa and Southeast Asia are groupings of countries. Central
Russia and the South of the United States are groupings of provinces and states.

Before #2084, such a region was given a composite: the union of its parts' shapes, built on demand
during a match (`geoshapeComposite.ts`). It found the parts by a live SPARQL query for P527 and
P361, and by reading the region's live Wikivoyage page for its Regions section. #2084 removed it
together with the Wikimedia Maps shapes it unioned. It then could build nothing, and it sent live
calls for every region without a shape.

Measured on the dev database on 2026-10-27, after layer build 33:

- In the Wikivoyage world view, 1,988 regions hold no shape. 259 of them have child regions, and
  for 164 of those every child has a shape.
- A trial of the union over both imports, rolled back, built 96 composites in its first pass, 5 in
  its second and 1 in its third: 102 items in about six seconds.
- The trial's composites included the Middle East (16 children, 7.5 million km²), West Africa (13)
  and the Russian Far East (10, 6.7 million km²).

## Decision

**A region whose item holds no shape, and every one of whose child regions holds an OpenStreetMap
shape, is given the union of its children's shapes.**

- **When.** The union is built right after the refill, in the same transaction (`refillRegionShapes`,
  `layerShapes.ts`), so a match reads either the last build's composites or this one's.
- **Where the parts come from.** The parts are the region's child regions in its own import
  (`regions.parent_region_id`), not Wikidata's parts and not a live page. An import's hierarchy is
  already read from Wikivoyage's own structure, so the build makes no call.
- **Licence.** The composite is kept under the item with `composite_of`, the number of shapes it
  unions, and under ODbL. It is OpenStreetMap's work, credited as any shape from the layer is.
- **Partial children.** A region with a child that holds no shape, or holds a Commons map file's
  shape under another licence, gets none, because a partial union is a wrong outline.
- **Nesting.** The passes repeat on the composites of the last pass, up to `COMPOSITE_PASSES`, so a
  region of composite regions gets one too.
- **Shared items.** Where two regions share an item, the first world view's region whose children
  all hold a shape is the one composed. Any complete union of an item's children is the item's
  outline, so a view that split the region into a child with no shape does not leave the item
  without one.
- **Rebuilding.** A refill deletes every item-keyed shape the layer no longer draws, composites
  among them, before they are built again. A composite therefore follows its children's shapes, and
  gives way to the region's own shape once an object draws it.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Build the composite on demand during a match, as before #2084 | A match would write the store, and the composite would wait on a person pressing Geoshape Match. The build already holds every input. |
| Take the parts from Wikidata's P527 and P361 in the local subset | Wikidata's parts are another source's view of the region, and they need not be the parts this world view draws. The import's children are exactly what the world view splits the region into. |
| Union the children that hold a shape and skip the rest | The outline would be missing a piece, and GADM divisions in the missing piece would be matched against nothing. |

## Consequences

**Positive:**
- Regions that are groupings, such as the Middle East or West Africa, are matched by an outline
  again, with no live call.
- Composites follow each build, like the shapes they are made of.

**Negative / Trade-offs:**
- A composite inherits its parts' quirks. A country's boundary relation in OpenStreetMap includes
  its territorial waters, so Indonesia's shape covers 5.3 million km² against 1.9 million of land,
  and Southeast Asia's composite 9.2 million km².
- Every region that shares an item is matched against one union, which may be another world
  view's.

## References

- Related ADRs: ADR-0157 (the layer's shapes and their refill), ADR-0158, ADR-0059 (the
  OpenStreetMap credit)
- Related docs: `docs/tech/dumps.md` § The OpenStreetMap layer, `docs/tech/world-view-import.md`
- Issues: #2113, #2084, #2085
