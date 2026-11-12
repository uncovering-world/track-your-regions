# ADR-0200: Every line of the World Heritage list is a record, and holds its point's item

**Date:** 2026-11-12
**Status:** Accepted
**Issue:** [#2118](https://github.com/uncovering-world/track-your-regions/issues/2118), Epic #2115
**Narrows:** [ADR-0198](0198-every-sources-record-of-a-place-is-one-row-in-a-kind-or-in-a-whole.md) decision 3

---

## Context

The World Heritage list gives each property a list of components, one line each, with a reference,
a name and a coordinate. ADR-0198 made the line of a serial site's part a record of World Heritage
components (source 10) in its site. That record holds how the list knows the part: its reference,
its view of the part and its Wikidata item.

Some lines are not a part's. A property of one component is one place, and so is a component that
stands for its whole site (#1899). The site shows that line as its own point. Kakadu National Park
is listed as `147quater-001` and the Historic Centre of Prague as `616bis-001`. Those lines had no
record. The item of such a point was a column of the point (`experience_locations.wikidata_item`,
#1269), with a curator's claim among the point's claims, and the registry read it under a basis of
its own (`point`).

On the development catalogue on 2026-11-12:

- 807 sites showed a line of their own, on 821 points. 795 sites had one such point.
- 12 sites had two or more. On ten of them the points carry one reference: the Pilgrimage Church
  of Wies's moved point carries `271bis` twice, and W-Arly-Pendjari carries `749quater-001` four
  times. Two sites show two lines: Ohrid (`99quater-001` and `99quater-002`) and Białowieża Forest
  (`33ter-001` and `33ter-002`).
- 7 of those points carried an item, among them Kakadu's (Q189657) and Prague's (Q748211). No
  curator had claimed one.
- One site point had no reference: the Routes of Santiago de Compostela in France.

So a line's item lived in two places: on a part's record, or on a site's point.

## Decision

1. **A site's own line is a record of the site in itself.** It is World Heritage components'
   record with `whole_id` and `experience_id` both the site, under the line's reference. A site
   holds one (`source_records_one_per_whole`), for the line it shows: its own point in a
   component's shape, placed by its World Heritage membership or by none, standing first, then
   published, then by ordinal (`siteLineSql`). The site's run writes it before the listings
   (`followTheSiteLine`). The record places the site in no whole and makes no part
   (`refresh_part_relation` leaves a pair of one place alone). It is no part's record
   (`partRecordSql`), and it offers nothing.
2. **A point's item is the item on its line's record.** The record is the part's in its whole, or
   the site's in itself under the point's own reference (`pointRecordSql`). A curator's choice is
   `wikidata_items` among that record's claims. `experience_locations.wikidata_item` goes. A
   point that no record stands for has no item, and a curator's confirmation of one is refused
   rather than reported.
3. **The record holds the line's position in the list** (`source_records.listing_ordinal`). The
   run writes it with the record's view, as the ordinal it paired the line's point by.
4. **The record follows its line.** When the list gives the site a second component and the line
   becomes a part, the part takes the record, with its item, its claims and its view
   (`part_site_components()`). When a curator separates the site's World Heritage membership, the
   new place takes it (`moveSiteLineRecord`). A merge folds it like any record in the folded
   place (`moveWholeRecords`). When the site shows another line of its own, the record takes
   that line's reference, keeping the item only for the same component renumbered
   (`whc_ref_bare`). A curator's item is never moved to another line nor taken off by a run:
   the record stays on the line the curator answered for (`siteLineMovesSql`).
5. **The registry reads the record for its item, not for its reference.** A line's item is
   `component-item`, a part's or the site's own, under the rule ADR-0143 decision 2 gives a
   standing point's item. The site's own reference names the site by the number its World
   Heritage membership already carries, so the registry's `component` arm reads parts' records
   only, and the `point` basis goes.

This narrows ADR-0198 decision 3. A record in a whole is one source's view of one place in one
whole, or of a site's own line in the site itself.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the item on the point | The item of a line is how the list's source knows the line, as a part's is. Two homes for one fact means two writers, two claim vocabularies (`wikidata_item` and `wikidata_items`) and an arm of the registry for each. |
| A record per own line, keyed by reference | A record in a whole is one per (source, whole, place) because the list gives one reference to two places (ADR-0198 decision 3). Keying a site's records by reference would bring back the key that decision refused, for the two sites that show two lines of their own. |
| A record with neither kind nor whole | `source_records_kind_or_whole` holds every record to one of the two, and readers tell a membership from a part record by them. A third shape would need every reader to tell it apart again. |
| Leave the registry's `component` arm reading the site's own record too | The site's line reference would claim the site beside its number. That adds a row per site to the registry, and nothing finds a site by it. |

## Consequences

**Positive:**

- One writer and one claim for a line's item, whichever place shows the line. The run, the
  review queue's confirmation and the take-back all write the record (`writePartItems`).
- A site's line keeps its item and a curator's claim when the list parts it. Before this, the
  point moved to the part, and the part read its item off its new record, which held none.

**Negative / Trade-offs:**

- A site that shows two lines of its own, as Ohrid and Białowieża Forest do, records one of them.
  The other line's point has no item and cannot be given one. Neither carried an item on the
  development catalogue, and migration 234 refuses a database where such a point does.
- A site point without a reference, such as the Routes of Santiago de Compostela in France, has no
  record and so no item.
- The registry's rows for the seven items move from basis `point` to `component-item`. Whether each
  item identifies its place stays the same.

## References

- Related ADRs: ADR-0143, ADR-0156, ADR-0198, ADR-0100
- Related docs: `docs/tech/experiences.md` § A part's record in its whole, `db/migrations/README.md`
- Issue: #2118, Epic #2115
