# ADR-0158: The OpenStreetMap layer also keeps whole the items the mapshapes of imported pages list

**Date:** 2026-10-27
**Status:** Accepted
**Issue:** [#2105](https://github.com/uncovering-world/track-your-regions/issues/2105)
**Narrows:** [ADR-0157](0157-the-openstreetmap-layer-keeps-whole-the-objects-of-the-items-an-import-names.md) decision 1 (the items whose objects the layer keeps whole)

---

## Context

The mapshape match draws a child region as the union of the outlines each `{{mapshape|wikidata=…}}`
on its parent's Wikivoyage page lists. The Lower Saxony page is an example: its first mapshape
lists the Ammerland and Aurich districts and five more. The match reads each listed item's outline
from the store of region shapes.

ADR-0157 fills that store from the OpenStreetMap layer, and decision 1 keeps whole only the objects
that carry an item under which `region_import_state` holds a region. Its trade-offs record the
cost: "An item a Wikivoyage `{{mapshape}}` names but no import holds is not drawn." The districts a
mapshape lists are rarely regions of an import, so the mapshape match finds no shape for them and
draws nothing.

Measured on the dev database on 2026-10-27, against the kept copy of English Wikivoyage (#2089):

- The imported regions name 2,914 Wikivoyage pages, 2,905 of them in the copy. Their mapshapes list
  5,859 distinct items. 4,233 of those are not among the 2,886 items the imports hold regions under.
- The drawn items therefore grow from 2,886 to 7,119. The pages are read in seconds.

## Decision

**The layer also keeps whole every object that carries an item a mapshape on an imported region's
Wikivoyage page lists.** `drawnItems` returns two lists: the items the world-view imports name
(ADR-0157 decision 1), and the other items the `{{mapshape}}`s on those regions' pages list. It reads
the pages from the kept copy of English Wikivoyage, so a build makes no call to the live site. It
parses them with the mapshape match's own parser (`parseMapshapes`), so the build and the match
agree on what a page lists. When no copy is kept, only the regions' own items are drawn. Each build
refills the store with the listed items' shapes by ADR-0157 decisions 2 and 3, and its summary
counts the two lists apart.

ADR-0157 decisions 2 and 3 stand as written.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep ADR-0157's limit | The mapshape match then draws no child region whose districts no import names, which is most of them. |
| Read the listed outlines from Wikimedia Maps when the match asks | Wikimedia Maps does not allow a third-party service to use it (#2084). |
| Read each listed outline live from the OpenStreetMap API | One call per item on every match, against an API that asks for no bulk reads. ADR-0157 rejected it for the regions' own items for the same reason. |
| Read the pages from the live wiki during the build | One call per imported page on every weekly build. The kept copy holds the same text. |

## Consequences

**Positive:**
- The mapshape match draws a child region from its districts' outlines, under ODbL with the
  OpenStreetMap credit, as it draws a region from its own.
- The listed items follow the planet and the kept copy: each build reads both again.

**Negative / Trade-offs:**
- The layer keeps about 4.2 thousand more items whole than under ADR-0157 alone. ADR-0157 estimated
  about 1.5 thousand outlines for the regions' own items. The next build measures the growth on
  #2105, together with how many listed items get a shape.
- A listed item the layer carries only as a node or a line still gets no shape.
- A mapshape that a page gains after the copy was kept is drawn only once a newer copy is kept and
  a build follows.

## References

- Related ADRs: ADR-0157 (decision 1 narrowed), ADR-0134, ADR-0059 (provenance and the
  OpenStreetMap credit)
- Related docs: `docs/tech/dumps.md` § The OpenStreetMap layer, `docs/tech/world-view-import.md`
- Issue: #2105
