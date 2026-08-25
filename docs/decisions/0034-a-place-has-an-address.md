# ADR-0034: A place has an address, and ids decide it

**Date:** 2026-08-25
**Status:** Accepted

---

## Context

Every region and every experience is a page in the product's mental model —
somewhere a visitor arrives, reads, and would send to someone else. In the URL
model it was an anonymous state: `useNavigation` read and wrote `?wv=` and
nothing else. A visitor who found the Historic Centre of Saint Petersburg
could not link to that card; the link they copied opened the world view at its
root, and a refresh did the same to them. The performance lane (#630) inherited
the same gap — with only `?wv=` addressable it could audit the map shell and the
Discover shell but not the experience card, the surface that loads a picture, a
location list and a description (#557, #646, #647).

The names in this catalogue change: a sync correction or a curator edit renames
a region or an experience, so a URL keyed on a name would rot. And the ids in a
URL reach reads that are already bounded by visibility (`requireVisibleWorldView`,
the lifecycle predicates), so a URL naming something the visitor may not see
must not become a way to enumerate what exists — it must answer the same
404-shaped silence the API gives.

## Decision

Navigational identity lives in **path segments**, transient view state a visitor
set deliberately lives in **query parameters**, and **ids are canonical while
slugs decorate**:

```
/wv/5/r/6737-europe/e/1234-historic-centre-of-saint-petersburg
/discover/wv/5/r/7120-france?cat=1
```

- The world view, the selected region and the open card are path segments,
  because each names a resource that must survive being pasted into another
  browser. The default (GADM) world view writes no segment; `/` is the map root.
- A segment is digits followed by `-` or the segment's end, and what follows the
  `-` is ignored — so a rename keeps every link ever shared. Stricter than a bare
  `parseInt`, which would read `6737europe` as 6737. When the object's name is
  known and the slug differs, the address is rewritten in place (`replace`) —
  never a 404.
- Discover's open category is a query parameter (`?cat=`): it is view state, not
  a resource. The map viewport is a query parameter too, when it is added
  (a follow-up; see `docs/tech/addresses.md`).
- Deliberate acts — selecting a region, opening a card, switching world view —
  are `push`ed, so Back undoes them; corrections and degradations `replace`;
  nothing writes on hover.
- An id the visitor may not see degrades to the nearest thing they may — the
  world view root, the region without the card — silently, the same 404-shaped
  answer the API gives. A URL carries nothing personal.
- Parsing and building live in one module (`frontend/src/utils/appUrl.ts`) with
  a round-trip test, so a parameter cannot be added in one direction only. The
  legacy `?wv=` form keeps working and is redirected to the canonical path.

GADM administrative divisions are **not** addressed: the built-in administrative
hierarchy is admin-only and shows in neither Discover nor a shared link, so the
default world view keeps the bare `/` and a division is not a path segment.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep everything in query parameters (`?wv=&r=&e=`) | A query string does not read as a resource, shared-caches wrong, and gives the region and the card no clearer identity than a filter. The path is what a copied link is expected to mean. |
| Name-keyed URLs (`/r/europe`) | Names change under sync and curation, so every shared link would rot. The id is the stable identity; the slug is decoration a wrong value cannot break. |
| Slug alone, no id | Same rot, plus a rename would 404 an old link rather than redirecting it. |
| Address the GADM divisions too | The administrative hierarchy is admin-only and appears in no visitor surface; a `/d/<id>` segment would carry a place no shared link can reach. Out of scope. |
| Store the open card in React state, share via a "copy link" button | Leaves refresh and Back broken, and keeps the card off the performance lane. The address is the state. |

## Consequences

**Positive:**
- A region, a card and a Discover list are each a link a visitor can send, and
  a refresh or a Back lands where they were.
- The performance lane can audit a region and a card by URL rather than only the
  two shells (#669, and #646/#647 after it); the smoke specs drop their
  click-the-region preamble.
- A rename never breaks a link; the id is what the address rests on.
- The document `<title>` names the place, so a share preview and a history entry
  read it, and focus lands in the card a link named.

**Negative / Trade-offs:**
- One parse/build module and its round-trip test are now load-bearing: a
  parameter added in one direction only is a latent bug the test exists to catch.
- The address is the source of truth for *which* ids are selected, so the hooks
  that hold the hydrated objects must follow it and reconcile against it —
  `useNavigation`, `useAddressedRegion`, `useExperienceContext`,
  `useDiscoverExperiences` each gained a follow path with its own guards.
- A deep link restores state through the same visibility-bounded reads a click
  makes, so an unreachable id costs one request that answers 404 before the
  address degrades — the same one-request-then-correct the world-view fallback
  already paid.

## References

- Related ADRs: [ADR-0031](0031-a-display-rung-drops-what-a-reader-cannot-see.md)
  (a display rung drops what a reader cannot see — the visibility this address
  degradation mirrors)
- Related docs: `docs/tech/addresses.md`, `docs/tech/performance.md`,
  `docs/tech/experience-map-ui.md`
- PR / issue: #644
