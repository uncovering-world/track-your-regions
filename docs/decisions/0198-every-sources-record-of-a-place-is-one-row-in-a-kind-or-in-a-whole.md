# ADR-0198: Every source's record of a place is one row, in a kind or in a whole

**Date:** 2026-11-12
**Status:** Accepted — decision 3 narrowed by [ADR-0200](0200-every-line-of-the-world-heritage-list-is-a-record-and-holds-its-points-item.md): a site's own list line is World Heritage components' record of the site in itself, which holds the line's item; decision 6 answered by [ADR-0203](0203-a-place-made-of-parts-is-never-merged-and-claims-no-item.md): two parts of one whole are never merged, and parts of two wholes may be, each keeping its record in its own whole
**Issue:** [#2118](https://github.com/uncovering-world/track-your-regions/issues/2118), Epic #2115
**Narrows:** [ADR-0156](0156-a-virtual-kind-holds-how-a-source-knows-a-part.md) decisions 1 and 2,
[ADR-0100](0100-a-serial-sites-components-are-places-part-of-the-site.md) decisions 1 and 3

---

## Context

A source's record of a place is a row of `source_records` (named `experience_kind_memberships`
until migration 230) when the source places the place in a kind. A serial World Heritage site's
part has no kind of its own (ADR-0100 decision 2), so ADR-0156 gave it a membership of a virtual
kind, World Heritage components (kind 10), which every reader that offers a place had to leave
out. That record was keyed by the part's earliest relation (`component:<experience_parts.id>`),
and the component's reference stayed on the relation and on the point.

On the development catalogue on 2026-11-11 there were 5,712 parts, each with one relation and one
kind-10 record. The reference is not unique among the components a list gives at one time:

- Maloti-Drakensberg Park lists `985ter-001` twice, once for Sehlabathebe National Park in Lesotho
  and once for uKhahlamba Drakensberg Park in South Africa. iSimangaliso and Maputo share
  `914bis-001`, and Phong Nha-Ke Bang and Hin Nam No share `951ter-001`.
- Western Tien-Shan gave `1490-003` to the Karabastau area, then renumbered its list and gave it
  to the Boraldaitau area (ADR-0189). Two places carried the reference at different times.
- 121 references named two parts. Most are duplicates for #2119 to clean up; the cases above are
  real.

Seville Cathedral, part of the Cathedral, Alcázar and Archivo de Indias in Seville, was merged
with the place Places of worship holds. Its reference `383bis-001` survived on the relation and on
the folded point of the place merged away, and the World Heritage run found it there.

The Epic's target (#2115) is one table of source records. A record places a place in a kind or a
part in a whole, "part of" is derived from those records, and there is no virtual kind.

## Decision

1. **One table, a record in a kind or in a whole.** `source_records.kind_id` or
   `source_records.whole_id`, exactly one of them (`source_records_kind_or_whole`). A record in a
   kind is a membership, as ADR-0045 and ADR-0084 describe. A record in a whole says how a source
   knows a part of that whole. A source whose records place parts in wholes fills no kind
   (`experience_sources.kind_id` is NULL), and every other source fills one.
2. **Each source declares the scheme of its ids** (`experience_sources.id_scheme`): `whc-site`
   (a property's number, `383`), `whc-component` (a component's reference, `383bis-001`),
   `wikidata` (an item), `wikidata-statement` (a statement's id) and `curator` (a curator's own
   key, `curator-<user>-<n>`). The vocabulary and its shapes are declared once in
   `@tyr/shared/identifiers` (`SOURCE_ID_SCHEMES`, `SOURCE_ID_SHAPES`). A record in a whole carries
   an id of its source's scheme, or a curator's key (`source_record_fits_scheme()`).
3. **A part's record is one source's view of one place in one whole**: one row per
   `(source_id, whole_id, experience_id)` (`source_records_one_per_whole`), whose `external_id` is
   the component's reference. The reference is the record's id but not its key, because the list
   gives one reference to two places at once and to two places over time. The `(source_id,
   external_id)` key stays for a record in a kind, where the run's upsert finds its row by it.
   A place that is a component of two sites holds a record in each.
4. **The virtual kind goes.** Kind 10 and `experience_kinds.is_virtual` are deleted. A reader that
   offers a place, names its kind or lists its sources asks for a record in a kind
   (`kindRecordSql`, `kind_id IS NOT NULL`), and a reader of a part's record asks for a record of
   World Heritage components in a whole (`componentRecordSql`). Kind 10 was the only virtual kind,
   so every reader sees the same rows.
5. **"Part of" is derived from the records.** A relation stands while a record of the pair
   claims it, and a curator's record, of the `curator` source, decides alone where there is one:
   in puts the place in, refused takes it out, and no run undoes either. The relation's
   reference goes; the record carries it. Until that derivation is built, the relation's trigger
   writes the record (`component_record_follows_relation()`), so both say the same.
6. **A merge moves records.** A folded place's own records move with it, part records included,
   and a record whose whole is the folded place moves to the survivor. A merge of two places that
   each hold a record of World Heritage components is refused, as before, until #2119 decides
   which record a merged part keeps.

This narrows ADR-0156 decision 1: no kind is virtual, and a record in a whole offers nothing because
it is in no kind. It narrows decision 2: the record is in its whole, one per relation, under the
component's reference, not keyed by the relation. Decisions 3 and 4 stand. It narrows ADR-0100
decision 1 (the relation records what the part records claim) and decision 3 (the reference is the
record's).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the virtual kind | Every reader that offers a place has to leave kind 10 out, and one that forgets shows parts as a kind of their own. A record keyed by one relation cannot hold the view of a part of two sites. |
| A table of part records beside the memberships | Two tables for one thing: a source's view of a place. The view rules (`placeViewsSql`), the registry and the merge would read both, as they read the virtual kind's rows today. |
| The reference as the part record's key, unique among live records | Maloti-Drakensberg's `985ter-001` names two standing parks, and four other sites share a reference the same way. Western Tien-Shan's `1490-003` named two areas in turn. |
| Hold every record to its scheme by the trigger now | The database specs and the smoke fixture seed memberships under ids of their own making (`e2e-9001`, `whs-9768-fixture`). Holding a record in a kind to its scheme waits until those fixtures name real shapes. |

## Consequences

**Positive:**
- A part's record reads and moves like any record. The `is_virtual` arms of the reader predicates
  and the schema's triggers go.
- Seville Cathedral's `383bis-001` is on its record, on the place it was merged with.
- A part of two sites holds a record per site, so each site's run writes its own view and item.

**Negative / Trade-offs:**
- Until "part of" is derived from the records, the relation and the record both carry the
  reference, written by one trigger.
- A record in a kind is not yet held to its source's scheme. On the development catalogue on
  2026-11-11 every one fitted it: source 1's ids are numbers, sources 2 to 9's are items.

## References

- Related ADRs: ADR-0045, ADR-0084, ADR-0100, ADR-0156, ADR-0189
- Related docs: `docs/tech/experiences.md` § A part's record in its whole
- Issue: #2118, Epic #2115
