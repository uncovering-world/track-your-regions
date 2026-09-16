# ADR-0061: The catalogue's points are a tile layer of their own, published under the reader's rules

**Date:** 2026-09-16
**Status:** Accepted

---

## Context

A person judging what the catalogue holds — how much of Archaeology is in Europe
and how little in South America, whether Art Museums exist outside Europe and
North America at all — had to open the region tree and read counts one region at
a time. The map could not answer it: markers and the density heatmap are built
from a region's own read, so with no region selected the map was empty, and the
places that belong to no region at all (#470) were on no map anywhere.

Answering it is a read of **points**, not of objects. The catalogue's 3 755
published objects stand at 8 830 reader-visible places, and a serial World
Heritage site is one row and hundreds of them — the Rock Art of the
Mediterranean Basin alone is 734 rock shelters. `GET /api/experiences` caps a
page at 1 000 rows and answers objects, so no number of calls to it draws that
map; and the whole world's points as one GeoJSON response is 2.5 MB, or 273 kB
under the brotli the backend already applies — all of it before the first screen
draws anything.

Every map layer this product already draws comes from Martin
([ADR-0006](0006-martin-for-vector-tiles.md)) — regions, divisions, islands —
and every one of them is **geometry**: a shape and the handful of columns needed
to click it. Martin is published on its own port with no authentication and
auto-discovers every compatible function in the database
(`docs/security/SECURITY.md` § Known Gaps), so a source over `experiences` is
not the same kind of thing as a source over `regions`: it carries what a place
*is*, and the four questions that decide whether a reader may be shown it live
in TypeScript fragments (`db/membership.ts`,
`controllers/experience/experienceLifecycle.ts`) that no SQL function can
import.

## Decision

1. **The catalogue's places are a Martin tile source**, `tile_experience_points`,
   read by the map's world layer. It takes an optional `kind_id` and no other
   scope: a place belongs to the catalogue rather than to a world view, which is
   what puts the places no region holds on a map at all.
2. **The reader-facing predicates are spelled a second time, inside that
   function**, rather than relied on from a layer above it. Martin answers this
   function to anyone who can reach its port, so a guard around it would not be
   one. The second spelling is held equal to the first by a test that composes
   the fragments and asserts the function body contains them
   (`backend/src/db/tileScopeGuards.test.ts`); a predicate dropped there is a
   publication, not a rendering bug.
3. **Colour is not published**. The tile carries the kind and the type; what
   colour those are drawn in stays decided once, in `frontend/src/utils/kindColors.ts`
   (#814), generated into a MapLibre expression and pinned against
   `experienceColor` for every pair.
4. **A click on a world pin resolves through
   [ADR-0042](0042-a-search-answers-about-the-catalogue-and-opens-where-the-reader-is.md)**,
   not through the map: the object's own read says which regions will hold it,
   and the address is written at the smallest one in the world view already
   open. The layer is therefore drawn only in a world view that owns regions.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Page through `GET /api/experiences?bbox=&kindId=` | Answers objects, not places, and caps a page at 1 000 rows; the world holds 8 830 places. A viewport read also re-fetches on every pan, where a tile is cached by the browser per z/x/y. |
| One GeoJSON response for the whole world | Measured on the same 8 830 places, carrying the same properties: 2.5 MB, and 273 kB under the backend's own brotli — against 28 kB gzipped for the z0 tile that covers the same world, and 19 kB for the one the map actually opens on. Ten times the bytes for a screen that draws a heatmap, and every one of them before anything appears. |
| Keep the guards outside the function — a view, or an authorizing proxy in front of Martin | The proxy is the right end state and is already the tracked fix for the port as a whole (`SECURITY.md`); it does not exist yet, and a source that publishes rows cannot wait for it. A view would be a third place the same predicates are written. |
| Carry `image_url` so the hover card keeps its picture | +90 kB on the densest tile measured, for a thumbnail on a hover card. The card names the object, its place and its kind instead, and shows no picture — and therefore no credit, which is the rule rather than an omission. |
| Compute the pin colour in SQL | A second answer to "what colour is a monument", which is the failure #814 was: the same object read two colours depending on where you looked at it. |

## Consequences

**Positive:**

- The shape of a kind's world is one screen: the balance the catalogue's own
  numbers describe is visible rather than inferred, for each kind and for all of
  them together.
- Places that sit in no region are drawn, because the layer is not scoped to a
  world view. A point needs no region to be a point.
- The read scales with what is on screen rather than with the catalogue: 19 kB
  gzipped for the tile the map opens on, 28 kB for the whole world at zoom 0,
  0.9 kB over Rome at zoom 8.
- The same mechanism is available to any later layer over catalogue rows — the
  extents of #897 among them.

**Negative / Trade-offs:**

- The reader's four questions are now written in two languages. The test that
  holds them equal is the whole of what prevents drift, and it can only compare
  text.
- Martin has no rate limiter, so the published catalogue can be enumerated from
  tiles as fast as Postgres will answer. That is a scraping and a capacity cost
  rather than a disclosure — the data is what this product publishes — and it is
  recorded in `SECURITY.md` beside the port's other gaps.
- A curator's edit does not reach a tile already in a browser's cache;
  `invalidateTileCache` is the only lever, and it is coarse.
- The hover card on this layer is poorer than a region's: no picture, no
  treasure count.
- **The kind a point is drawn under is the row's own membership, and the gate
  asks about *any* of them.** That composition is `rowKindJoinSql`'s, shared with
  every reader-facing read — `experienceRegionQuery.ts` joins identically — and
  it is exact only while a place has one membership, which is every place today
  (measured: none of the 3 755 has two). The day #755 merges a monument into the
  World Heritage site it duplicates, a place can hold a refused or unread
  membership beside a published one, and this tile will label it with the
  refused one exactly as the region's list does. The tile must not diverge from
  the list ahead of that: which membership a reader is shown a place under is
  one decision for all of them, and #755 is where it is taken.

## References

- Related ADRs: [0006](0006-martin-for-vector-tiles.md) (Martin),
  [0028](0028-a-reader-is-positioned-by-places-they-can-go-to.md) (which place an object is drawn as),
  [0042](0042-a-search-answers-about-the-catalogue-and-opens-where-the-reader-is.md)
  (where a click may open an object),
  [0034](0034-a-place-has-an-address.md) (the kind in the address)
- Related docs: `docs/tech/experience-map-ui.md`, `docs/tech/addresses.md`,
  `docs/security/SECURITY.md` § Known Gaps, `martin/README.md`
- Issue: #910
