# ADR-0086: A merge is a record that moves one place into another, and can move it back

**Date:** 2026-10-07
**Status:** Accepted — decision 3 narrowed by ADR-0088

---

## Context

ADR-0046 decided what a merge is: two rows that are one place become one place, nothing is
deleted, the absorbed row's address answers with the surviving place's card, visits are
reconciled by its decision 5, and the merge can be undone. ADR-0084 made a place belong to no
source and no kind, so a merge moves a place's memberships, not the place. Neither says how the
catalogue records a merge, which row stays, or who a merge nobody clicked is by.

The development catalogue on 2026-10-07 held 153 Wikidata items on more than one place row, 307
rows in all, three for the National Archaeological Museum in Madrid. Every one of those rows has
one point, and that point's `external_ref` is the item itself; 150 of the 152 pairs' points stand
less than a metre apart. 18 of the rows' memberships are arrivals nobody has passed, 68 hold a
proposal a gated source's run kept back, and the proposals' changeset rows (1 489) and answers
(77) are keyed on the place. 98 works are linked to both rows of a pair. No two rows of a pair
share a kind, and no row carries a curator's edit.

The curation log names a curator on every row (`curator_id NOT NULL`); a merge the catalogue
makes because two rows share a Wikidata item (ADR-0046 decision 2) has no curator.

## Decision

**1. A merge is a row of `experience_merges`.** It names the place that stays, the place folded
into it, who merged them (null for the catalogue's own merge) and why (`equal_wikidata_item`, or
a curator's), and records what it moved — the memberships, the points moved and the points folded
into the survivor's, the work links moved and the placements moved onto a link the survivor
already had, the changeset rows and answers, and the survivor's visits as they stood — so the undo
moves exactly those back. The folded place is marked `merged_into_id`; it keeps nothing a reader
offers, since it keeps no membership, and every reader already asks a place's memberships.

**2. The place with the lower id stays.** Both addresses answer — the folded one with the
survivor's card — so which id stays is a matter of stability, not meaning, and the older row is
the one more links already point at.

**3. One point stays one point.** A folded point whose `external_ref` equals one of the
survivor's is the same thing on the ground — both sources read the same Wikidata item — so it is
folded into that point: its placements and its visits move there, and it is marked
`merged_into_id`, hidden like the folded place. Any other point moves to the survivor as it is.

**4. What two places cannot both hold is refused, not chosen.** Two memberships in one kind
cannot hang on one place (`UNIQUE (experience_id, kind_id)`); such a pair is not merged, and the
refusal says why. Where both places link one work, the folded link's placements move onto the
survivor's link, and the survivor's link and its state stand — a link's state moves only as
`CURATION_MOVES` lists, and `pending` → `auto` is not among them. Where both
places hold an answer to the same held field, the survivor's stands.

**5. The catalogue's own merge names no curator.** `experience_curation_log.curator_id` may be
null on a `merged` row and on no other, and the row's details say the merge was the catalogue's,
on an equal Wikidata item. An undo is always a curator's.

**6. Two places are locked in id order.** A merge takes both places' object locks, the lower id
first, before any of their contents — the order `db/locks.ts` states for one object, applied to
two.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Delete the folded row and keep a redirect table | ADR-0046 decision 5 keeps the absorbed row in the history and makes the merge undoable; a deleted row takes its visits, its log and its changesets with it. |
| Keep the row with more visits or more memberships | It makes which id survives depend on data that changes, so two runs over the same catalogue could pick differently; both addresses answer either way. |
| Move both points and let readers draw both | 150 of 152 pairs would show two pins on one spot, the bug #755 reports. |
| A system user as the author of the catalogue's own merges | A row in `users` that no person is would appear in every list of curators and in every scope check; a null author named in the details says what happened. |

## Consequences

**Positive:**
- A merge is undone from its own record, not reconstructed from the log.
- Readers learn nothing new: a folded place offers nothing because it holds no membership, and a
  folded point is filtered by the predicate every point read already composes.
- The 153 shared items become one place each, one pin in several colours.

**Negative / Trade-offs:**
- `curator_id` is nullable, guarded by a check to one action; a reader of the log names the
  catalogue where it names no one.
- Anything written to the survivor after the merge stays with it on undo (ADR-0046 decision 5), so
  an undo after a run has touched the survivor can leave that run's later changeset on the
  survivor, and a placement a later run wrote on a survivor's point for a membership the undo hands
  back stays on that point (the catalogue check `point-placed-by-another-places-membership` names
  it); the folded place gets back what the record says it gave. A visit a traveller wrote to after
  the merge keeps what they wrote: the undo restores or removes only a visit nobody has changed.
- Merges are undone last first: a merge whose survivor a later merge folded, or whose survivor a
  later merge folded another place into, waits for that later merge's undo, since the later one may
  have folded a point or a link into one the earlier one moved.
- Two memberships in one kind on two rows — two sources of one kind reading one place — are not
  merged by this; they wait for a decision on two sources in one kind.

## References

- Related ADRs: ADR-0046 (what a merge is; this is how it is recorded), ADR-0084 (a place belongs
  to no source and no kind), ADR-0085 (one Wikidata item is one reading), ADR-0022 (marked, never
  deleted), ADR-0069 (writer modules)
- Issue: #1247
