# ADR-0088: A World Heritage site of one point is its one Wikidata item, and merges to one point

**Date:** 2026-10-08
**Status:** Accepted

---

## Context

ADR-0046 decision 2 merges two rows that share a Wikidata item, and ADR-0086 records how. A
Wikidata source knows its places by the item, so its rows meet on it. A World Heritage row knows
its place by the UNESCO id and carries no item. Chartres Cathedral is a World Heritage row and a
place of worship (Q180274), and so are Cologne Cathedral and 186 more on the development
catalogue: two cards and two pins for one place.

The World Heritage id resolves to items through P757, which the World Heritage run already reads
at every rank for the site's picture (ADR-0043). Measured on 2026-10-08 against live Wikidata,
1 184 of 1 272 sites resolve to exactly one item at the property's own number, or at a later
numbering of it. 88 resolve to several, such as Venice beside "Venice and its Lagoon". A serial
site's components carry the site's id too, followed by a part (#1269). 734 of the single-item
sites have one point. 188 of those share their item with another kind's row, and 52 serial sites
do.

ADR-0086 decision 3 folds a point into the survivor's only where both carry the same
`external_ref`. A World Heritage point is referenced by its UNESCO component number and a place
of worship's by its item. Merging Chartres would therefore keep two points 30 m apart, and draw
the two pins the merge exists to end.

## Decision

1. **A World Heritage site's items are the items carrying its property number.** The run records
   them on its membership (`wikidata_items`), from the property tier, or from a later numbering
   where no item carries the property's own. A component's item names a part and is not counted
   (#1269 records it on the point). An item that carries the number only in deprecated statements
   is not counted either: Wikidata keeps those as wrong. A picture may still come from any rank
   (ADR-0043), but identity may not. Recorded only from a query Wikidata answered; otherwise the
   membership keeps what it held.
2. **One item and one point make the place that item's.** For the catalogue's merge on an equal
   item, a World Heritage membership counts as the one item its site resolves to, and only on a
   place of one point (`membershipItemSql`). Several items name several things, and a serial
   site's places are parts whose identity is decided per location (ADR-0046). Neither is merged
   on the item.
3. **A place of one point merged into a place of one point is one point** (narrows ADR-0086
   decision 3). Where both places hold exactly one standing point, the folded point folds into the
   survivor's whatever their references. Two sources naming one place by different references are
   still describing one spot. Where their coordinates disagree by more than ten metres, the
   sources card asks which one stands (#1246). Points that share a reference still fold as before,
   and on places of several points nothing else changes.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Store the site's item in `metadata` | The merge and the check read items off memberships, which are what a source knows a place by (ADR-0084). The place's metadata belongs to no source. |
| Merge on several items, picking one by name | That is a guess about which of several things the site is. Venice and "Venice and its Lagoon" are not one place for a traveller collecting places. |
| Fold points within a distance | A distance is a proposal for a curator (ADR-0046 decision 3). Here the identity is already settled by the item, and only the number of pins is in question. |
| Keep both points and let the reader draw two pins | This is the defect #755 reports. |

## Consequences

**Positive:**
- 188 places stop being two cards and two pins on the admin's pass, once the World Heritage
  source's next run has recorded their items. A run merges only the places it created, so a
  pair a curator took apart is not merged again by every run; the catalogue check counts the
  pairs still apart. Examples: Chartres, Cologne, Kapova Cave beside Shulgan-Tash, Ecbatana beside
  Hegmataneh.
- Where the names or pictures differ, the sources card asks. Neither source overwrites the other.

**Negative / Trade-offs:**
- A merged place whose two sources put it apart keeps the survivor's point until a curator
  chooses. The coordinate is asked about only once the gap passes ten metres.
- 52 serial sites that share an item with another row stay apart until the serial-site slice
  (#1250).
- A site of one point merged with a place of several points keeps two pins, because the fold
  needs one point on each side. Twelve places of the Wikidata sources hold several points on
  2026-10-08, eight of them archaeology. One card with two pins is still better than two cards.

## References

- Related ADRs: ADR-0046 (what a merge is), ADR-0086 (how it is recorded; decision 3 narrowed
  here), ADR-0085 (one item is one reading), ADR-0043 (P757 at every rank)
- Issues: #1248, #1269, #1250, #1246
