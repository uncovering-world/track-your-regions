# ADR-0199: A visit is one row on the place ticked, and a whole is read through its parts

**Date:** 2026-11-12
**Status:** Accepted

---

## Context

A traveller's visits were held in two tables, `user_visited_experiences` for places and
`user_visited_locations` for points, and a tick on a serial site's part was written twice: once
on the part, and again on every whole it is a part of, by the writer (`visitWholes`). Readers
picked one or the other, and they drifted (#2120):

- Map mode read the points: Haghpat and Sanahin, with two of its three monasteries visited,
  read "2 of 3", partly visited. Discover read the site's own row, written by the cascade, and
  read it visited.
- The Wallace Collection held a point visit and no place visit: ticked in Map mode, not in
  Discover.
- A merge copied a folded place's visits to the survivor and kept the folded rows for the undo,
  and Discover's list counted them: 9 visits for a traveller who holds 7 live places.
- Unmarking a site in Discover deleted its row and left its parts' visits, and the next tick on a
  part wrote the site's row back.
- Seeing a work in a museum wrote the venue's visit and a visit to every one of its points, down,
  and none to the whole it is a part of.

The maintainer decided on 2026-11-12 that until #2121 adds "k of N", a whole with some but not
all of its parts visited reads partly visited in both modes and never plainly visited.

## Decision

1. **One table.** A visit is one row of `user_visited_experiences` on the place the traveller
   ticked: a part for a serial site's component, the edition for one of its casts, the place
   itself otherwise. `user_visited_locations` is folded into it and dropped (migration 235).
2. **A whole is read, never written.** A tick on a part writes the part's row only. A place's
   state is read from the points a reader is shown of it, its own and its direct parts' (as
   every reader shows them, ADR-0197): a point counts as visited when its own place is.
   `visited` when every point is, `partial` when some are or the place itself is ticked,
   `not_visited` otherwise (`computeVisitedStatus`, `@tyr/shared/visits`). An edition's casts are
   its own points, so one tick marks them all (ADR-0145 decision 5). What a nested whole reads is
   #2121's.
3. **One read for both modes.** Map mode's row and card and Discover's list and panel take the
   state from one answer, `visitedIds` and `partialIds`, computed by one statement
   (`visitStatesSql`, `db/visits.ts`).
4. **A folded place's visit is never read.** It stays for the merge's undo (ADR-0046 decision 5).
5. **A click never clears a visit the traveller cannot see.** A place of no parts is ticked and
   unticked from its row's checkbox, in both modes. A whole's row shows its state and ticks
   nothing: its parts are ticked one by one on its card or expanded row. There, beside the count
   of its places in the region, *Mark all in region* and *Unmark all in region* reach only the
   places in that region, each shown only where it would change one. A whole is visited when
   every point it shows is, its own points included, and a tick on one of its own points is a
   visit on the whole: the City of Graz's point named for the whole site, beside its historic
   centre, is ticked in its list like any place, and that row is the whole's. "I was there, I
   don't remember which part" is a button on the card of a whole that shows no point of its own,
   one visit on the whole that names no part. Taking it back takes back that one row, never a
   part's visit. Only the whole's own card reaches its places
   in other regions: Discover's panel's *Mark all* and *Unmark all*.
6. **Seeing a work marks its venue and nothing else**: Antwerp Cathedral, not the other belfries
   of the Belfries of Belgium and France, which read partly visited through it.

This narrows ADR-0046 decision 7 and ADR-0100 decision 5: a visit still counts upward, and it is
read there rather than written. It narrows ADR-0022 decision 4: there is no point visit to keep.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep writing the cascade, and fix each writer and reader | Two copies of one fact, kept in step by every writer: the drift above is what that produced. |
| A whole reads visited after any part | The maintainer's decision for now is partial until #2121 says "k of N". |
| Move a folded place's visits to the survivor rather than copy them | The undo would need a second record of whose visit moved; reading only live places is one predicate. |
| A partly visited place's checkbox marks every place of it | One click in Moldova's list would claim the Struve Arc's 34 points in ten countries, the claim a partly visited whole exists to avoid; marking only the region's places does nothing once they are all ticked. |
| A whole's checkbox ticks the whole, and unticks it with every part | One click in Belgium's list would clear the French belfries' visits, which that list does not show. |
| Rename `visited_at` to `marked_at` here | It is a metadata rename with no rewrite; #2120's trip-date slice changes the visit's shape and its API once, with the date. |

## Consequences

**Positive:**
- Map mode and Discover agree: Haghpat and Sanahin reads partly visited in both, the Wallace
  Collection visited in both.
- A traveller's count no longer includes visits on folded places.

**Negative / Trade-offs:**
- A tick on a point a site holds as its own (a component that stands for the whole site, 18 sites
  on the development catalogue) is a tick on the site, and stays on it when a later run parts
  that point into a part of its own.
- A site with no point of its own, ticked as a whole, reads partly visited until its parts are
  ticked.
- A merge made before migration 235 is undone without its point visits: the migration lands a
  point's visit on the place the point stands on now, followed down the merges, so a visit to a
  folded or moved point stays on the survivor when the merge is undone, and its record of the point
  visits it copied is no longer read. On the development catalogue (2026-11-12) none of the 4 point
  visits is on a folded or moved point, and no standing merge recorded a point visit.
- The old cascade wrote a visit on a whole whenever one of its parts was ticked, and nothing marks
  those rows apart from a direct tick. Migration 235 removes, before it folds the point visits, a
  row on a whole that stands beside the traveller's visit on one of its direct parts that the whole
  reads (a standing part with a point a reader is shown), carries no note or rating, and has no point visit of theirs on the whole's own points: the whole reads that
  part's visit anyway. A direct tick made before the change beside a part's visit goes with them:
  the whole still reads partly visited, its card's button is not pressed, and a point of the
  whole's own reads unvisited. A row with a note, a rating or a tick on the whole's own point is
  kept, and its card's button reads pressed. On the development catalogue (2026-11-12) that removes
  1 row, on the Monasteries of Haghpat and Sanahin, which holds no point of its own; none of the 18
  sites with a point of their own holds a visit.
- A visit on a part whose points were withdrawn or are unread is cleared by no click, since the
  traveller cannot see it. It counts for nothing they are shown.

## Amendments

- 2026-11-12, before acceptance: decision 5 read that a place's checkbox ticks an unvisited whole
  as itself and unticks a whole with every part's visit. The maintainer decided that a click must
  never clear visits the traveller cannot see, so a whole's row became a status, its own tick moved
  to its card, and taking that tick back leaves the parts.

- 2026-11-12, before acceptance: the two region buttons stood beside a whole's row as a bare "+"
  and "−", which said nothing until hovered and read as removing the place; they moved to the card,
  in words, beside the count of its places in the region.

- 2026-11-12, before acceptance: a whole showing a point of its own offered "Visited, not sure
  which part" beside that point's checkbox, and the two wrote the same row, so ticking the point
  pressed the button. The button is now offered only on a whole that shows no point of its own.

## References

- Related ADRs: ADR-0022, ADR-0046, ADR-0100, ADR-0145, ADR-0197
- Related docs: `docs/tech/experiences.md` § User visits, `docs/tech/experience-map-ui.md`
- Issue: #2120 (Epic #2115); #2121 adds "k of N"
