# ADR-0042: A search answers about the catalogue, and opens where the reader is

**Date:** 2026-09-01
**Status:** Accepted

---

## Context

A visitor who knows a name — "Alhambra", "Rijksmuseum" — had no way to type it. The navigation
pane's search found regions only, and Discover's filter worked inside the region already open
(#592). The backend half existed: `GET /api/experiences/search` is public, rate-limited,
validated, and reads a trigram index over `experiences.name`, with a single consumer — the
curator's "search and assign" dialog.

Wiring it into a visitor surface asks a question the region search never had to answer, because a
region belongs to exactly one world view and an experience belongs to the catalogue. Measured on
the development database on 2026-09-01, over the 1577 objects a visitor may see:

| | |
|---|---|
| placed in world view 5, *Administrative* (public) | 1549 |
| placed in world view 2, *Wikivoyage Regions* (public, 4301 regions) | 0 |
| placed in no published world view at all | 28 |

Those 28 are not obscure — the Great Barrier Reef, Hạ Long Bay, the Wadden Sea, Île de Gorée, the
Forth Bridge, Louvre Abu Dhabi, the Spire of Dublin. They are the matcher's gap (#469 snapping,
#470 marine objects), not the catalogue's.

An object also hangs on the whole chain of regions that contains it: the Rijksmuseum is assigned
to Noord-Holland, to the Netherlands and to Europe, all three in world view 5.

So a search result is not automatically an address. Three questions had to be settled before the
first row could be drawn: what happens when the reader's world view does not place an answer,
what happens when nothing places it, and which of several regions a click opens.

## Decision

**1. The search answers about the whole catalogue.** Every object whose name matches is an
answer, whatever any world view has done with it. Scoping the read to the active world view was
the alternative, and in *Wikivoyage Regions* it would answer "no results" to every query the
catalogue can satisfy.

**2. A row is a link only where the world view already open places the object.** The world view is
the lens the reader chose; a search result is not a reason to change it. No result navigates
across world views, and the default world view — which owns no regions — opens nothing.

**3. What cannot be opened is still shown, and says why.** "not in this world view" where some
other published world view places it, "not on a map yet" where none does. A row like that is not a
link and is not a dead click: it is the honest answer that the catalogue holds the thing and this
lens cannot reach it.

**4. A click opens the smallest region that holds the object.** The search read returns each
answer's regions ordered by `geom_area_km2` ascending, nulls last, and the row takes the first one
in the reader's world view — Noord-Holland rather than Europe, so the map frames the object rather
than the continent. Area rather than a walk up `parent_region_id`: the question is which is the
smaller *place*, and a region whose geometry has not been computed sorts last rather than first.

**5. Only regions that name the object to a reader are offered.** Two predicates, because two
things can take an object out of a region's list without touching its membership row. The read
applies `readerRegionMembershipSql` — the predicate `getExperienceById`'s `regions[]` already uses
(#521) — *and* excludes a pair a curator has rejected, which upserts into `experience_rejections`
and deletes nothing. A region whose own list would not hold the object is never the destination of
a click; without the second predicate a rejected pair would still be offered as the smallest
region, and the reader would land on it with the card dropped from the address on arrival.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Scope results to the active world view | In *Wikivoyage Regions*, which places nothing, the search would answer "no results" for every object in the catalogue — a lie about what the catalogue holds |
| Show every answer and switch world view on click | Makes every answer reachable, at the price of moving the reader out of the lens they chose, silently, on a click meant to open one card |
| Hide answers no world view places | The 28 include the Great Barrier Reef. A visitor typing that name would be told the catalogue does not have it |
| Open the first region by name | Alphabetical order on the Rijksmuseum's chain gives Europe: the card opens on a continent, and the map frames one |
| Take a `worldViewId` parameter and resolve the destination server-side | Adds a visibility surface to a route that carries no session, for a decision the client can make from data the read already sends |

## Consequences

**Positive:**

- A name typed in the pane reaches the card, in the region that holds it, at an address that can be
  shared — the deep-link plumbing of ADR-0034 written by one click.
- The matcher's gap becomes visible where it matters: a reader looking for the Great Barrier Reef
  is told it is in the catalogue and not yet on a map, rather than being told nothing.
- No new visibility surface: the read takes no world-view parameter and stays public, resolving
  context over published, active world views only.
- The same read now sends `category_name`, which the curator's dialog had been rendering against a
  field it never received.

**Negative / Trade-offs:**

- An admin whose active world view is unpublished gets no openable rows, since context is resolved
  over published world views only. Their unpublished world view is not a place to send a reader,
  and the route has no session to tell them apart by.
- A world view that places nothing answers every query with unopenable rows. That is what such a
  world view *is* today, and the rows say so rather than pretending.
- The destination is one region of several. A transboundary object — the Wadden Sea across three
  countries — opens at one of them, and the row's countries are what say there are more.
- Ordering by area is a claim about geometry, not about the tree: a region whose stored geometry is
  larger than its parent's would be offered first. Nothing in the catalogue is in that state, and
  the region geometry pipeline is what would have to be wrong for one to be.

## References

- Related ADRs: [ADR-0034](0034-a-place-has-an-address.md) (a place has an address — the grammar a
  result is written into), [ADR-0028](0028-a-reader-is-positioned-by-places-they-can-go-to.md)
  (a reader is positioned by places they can go to)
- Related docs: [`docs/tech/experiences.md`](../tech/experiences.md),
  [`docs/tech/addresses.md`](../tech/addresses.md)
- Issue: #592. Adjacent: #469, #470 (why 28 objects are on no map)
