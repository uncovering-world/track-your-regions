# ADR-0203: A place made of parts is never merged, and claims no Wikidata item

**Date:** 2026-11-13
**Status:** Accepted
**Issue:** [#2119](https://github.com/uncovering-world/track-your-regions/issues/2119), Epic #2115
**Narrows:** [ADR-0046](0046-a-place-is-ours-to-identify-and-a-merge-is-confirmed-by-a-curator.md) decision 2,
[ADR-0088](0088-a-world-heritage-site-of-one-point-is-its-one-item-and-one-point.md) decision 2,
[ADR-0143](0143-a-place-is-found-by-its-identifiers-before-a-run-creates-one.md) decision 2,
[ADR-0198](0198-every-sources-record-of-a-place-is-one-row-in-a-kind-or-in-a-whole.md) decision 6

---

## Context

The maintainer decided for the clean catalogue model (#2115, 2026-10-27/28) that a whole is never
merged with anything. A serial World Heritage site, a series or a cast group is a whole. On the
map it is its parts, and merges join places that stand at one point. A whole is a place made of
parts: `experience_parts` names it as the whole of at least one part. On the development catalogue
on 2026-11-13 there were 482 of them, all serial World Heritage sites.

The catalogue did not hold that rule, and measured on 2026-11-13 it broke it three times:

- **Three standing merges fold another kind's place into a whole.** Archaeology's Baalbek
  (Q178835) went into the Baalbek site on 2026-10-10. Archaeology's Mausoleum of the First Qin
  Emperor (Q910180) went into its site on 2026-10-23, and the same day Bridges' Rideau Canal
  (Q651323) went into the Rideau Canal site. Each was the catalogue's join on an equal item
  (`joinPlacesClaimingOneItem`). No merge has folded a whole, and none holds a visit or a work.
- **The registry let a whole claim an item.** ADR-0088 decision 2 makes a World Heritage site of
  one point and one item that item's place, and ADR-0143 decision 2 carries the rule into
  `place_identifiers`. A serial site still shows one point of its own when one component stands
  for the whole site (`stands_for_whole_site`, #1899). Since ADR-0200 that line's record also
  carries an item. So 22 Wikidata rows identified 17 wholes, among them Prague, Angkor, Kakadu and
  Wudang. A run reading any of those items would have added its record to the whole
  (`lockIdentifiedPlace`), and the join would have folded a second place into it.
- **The site-item rule still serves single sites.** 549 World Heritage places of one component are
  identified by their one item alone, Cologne Cathedral among them, and 226 more hold another
  kind's record found that way. Dropping the rule outright would make every later run of those
  kinds create a second place for each.
- **ADR-0198 decision 6 left a question open.** It refused every merge of two places that each
  hold a record of World Heritage components until #2119 decided which record a merged part keeps.

The near-place proposal pass already leaves wholes out (`mergeProposalFinder.ts`), so the gap is
in the registry, the merge writer and the join.

## Decision

1. **A place made of parts claims no Wikidata item by any column.** `place_identifier_claims()`
   reads `place_is_whole()` on every Wikidata arm: a source's own id, a site's items and a list
   line's item. A whole holds its items as referring, so a run's lookup never follows one to it
   and the join never pairs it. A curator's word on an identifier still stands over the columns
   (ADR-0143 decision 5). A site of one component has no part and keeps its item.
2. **The registry follows a place becoming a whole.** Statement triggers on `experience_parts`
   refresh the places a statement made wholes or left without parts, once per statement and only
   for those (`place_identifiers_follow_wholes`). They fire after the region triggers on the same
   table, so a place's region keys come before its registry keys, as after a part's record.
3. **A merge never joins a whole.** `mergePlaces` refuses a pair where either place is made of
   parts, its own parts included, before every other refusal (`partsBarMerge`). What is one place
   with another kind's place is one of the whole's parts, as the Temple of Karnak is of Ancient
   Thebes. The refusal reaches every caller: a curator's merge, a near pair answered *one place*
   and the undo of a separation.
4. **Two parts of one whole stay two places, and parts of two wholes may be one.** A merge is
   refused where both places are parts of one whole, or each holds a record of one source in one
   whole. Two lines of one list are two places on the ground. A place that is a part of two
   wholes keeps a record in each, so parts of different wholes merge and each record stays in its
   own whole. This answers ADR-0198 decision 6. A duplicate line read twice is a catalogue error
   that a repair removes (#2119), not a merge.
5. **The join states the rule where it reads it.** `sharedItemsSql` leaves out a whole and a pair
   of parts of one whole, as the merge would refuse them.
6. **The merges already made onto a whole are undone by a curator.** The catalogue check
   `merge-onto-a-whole` lists them. *Undo this merge* on the site's history moves the other
   place's record and point back from the merge's record (ADR-0086), and the join never pairs them
   again. No migration undoes them: an undo is a curator's act, logged under their name.

This narrows ADR-0046 decision 2: an equal item is a merge only between places that are not
wholes. It narrows ADR-0088 decision 2: a site of one point and one item is that item's only while
it has no part. It narrows ADR-0143 decision 2: the registry's claims read whether a place is a
whole. It answers ADR-0198 decision 6.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Drop the site-item claim entirely, as #2119 first worded it | 549 single sites would lose the item every kind's run finds them by, and each run would create a second place. The harm is the claim on a whole, not on a site. |
| Refuse in the merge writer only | A run's lookup would still add another kind's record to a whole by its item, which is the same join without a merge record. |
| Undo the three merges in the migration | An undo is a curator's act (ADR-0086 decision 5) with a log row naming them. Rewriting `undoMerge` in SQL for three rows would be a second copy of the undo. |
| Let a curator merge two parts of one whole, keeping the survivor's record | Two records of one source in one whole collide on `source_records_one_per_whole`. No two parts a reader sees stand within 10 m under one reference. The 92 duplicates measured were never shown, so a repair removes them. |
| Ask a curator whenever a kind's place names a whole's item | #2126 lands such a record on the whole. Questions asked now would be undone then, which is why #2276 was closed. |

## Consequences

**Positive:**
- No run, join or curator can make a whole one place with anything, and the three merges that did
  are named for a curator.
- A site of one component keeps working as before, Chartres and Cologne included.
- Parts of two serial sites can be one place, each site keeping its record of it.

**Negative / Trade-offs:**
- Once the three merges are undone, Archaeology's Baalbek and Mausoleum stand as their own places
  beside the sites. The other 48 offered twins (Khajuraho, Bagan, the Jesuit missions) do the same
  until #2126 lands their records on the wholes.
- A whole's item finds nothing at a run's lookup, so a kind's run creates its own place for it,
  held for a curator where the source is gated.
- A curator's word that a whole is an item still makes it the item's place for a run's lookup.
  The join still never pairs it.

## References

- Related ADRs: ADR-0046 (identity and merges), ADR-0086 (the merge record and its undo),
  ADR-0088 (a site of one point is its item), ADR-0100 (components are parts), ADR-0143 (the
  registry and the resolver), ADR-0198 (records in a whole), ADR-0200 (a site's own line)
- Related docs: `docs/tech/experiences.md`, `docs/tech/data-assertions.md`
- Issues: #2119, Epic #2115, #2126 (twins land on the whole), #2276
