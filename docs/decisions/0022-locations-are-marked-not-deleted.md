# ADR-0022: A location is marked, not deleted, and no run may empty a category

**Date:** 2026-08-05
**Status:** Accepted

---

## Context

ADR-0020 gave an experience a lifecycle: a run records `missing_since`, a
curator turns it into a verdict, and nothing the machine observes removes a row.
Its locations never got the same treatment. `writeExperienceLocations` deleted
every stored point the source stopped offering, and
`user_visited_locations.location_id` is `ON DELETE CASCADE` — so a run that
stopped seeing a point silently deleted a person's record of having stood there.
`experience_location_regions.location_id` cascades the same way, taking manual
region assignments with it.

Force sync did it wholesale and by hand: `cleanupCategoryData` deleted
`user_visited_locations` and `user_visited_experiences` for the category
outright, then every location and every experience; the museum path first
deleted every treasure link and every orphaned treasure, which cascades
`user_viewed_treasures`. The admin panel said so — "Force sync will delete all
existing experiences, visited records, and region assignments for this source."

Two things made this urgent rather than theoretical. Slice C (PR #495) found the
sync had been destroying region assignments on every run and rebuilding them
afterwards — the same cascade, in its bulk form. And the museum import is about
to be corrected (issue #507): four Louvre departments merge into one
Louvre, roughly seven entities that are not places leave, and the British Museum
leaves the art-museum category. Every one of those is a departure, and each
would have destroyed user data on its way out.

ADR-0020's own consequences named this and left it: "A force sync still wipes
and reloads the category, destroying curator decisions along with everything
else. Not addressed here."

## Decision

**1. A location the source stops offering is marked, not deleted.**
`experience_locations.missing_since` records when a run first offered the
experience without that point; `ordinal` becomes NULL, because a row the source
no longer lists has no position in that list. This is a machine observation, the
same one `experiences.missing_since` already is — not a verdict about the place.

**2. Identity survives the gap, so what hangs off the row survives with it.** A
source offering the point again finds the same row by its `(point,
external_ref)` identity, clears `missing_since`, restores its ordinal and sends
it for placement. The visit record and any manual region assignment were never
touched; only the `auto` assignments were dropped, and placement rebuilds those.

**3. What a reader sees does not change.** A withdrawn point used to be deleted,
so it left every list the moment a run stopped seeing it. The predicate
`missing_since IS NULL` keeps it out of exactly those places — the marker batch,
the experience's own location list, `location_count`, the per-user visited
status, "mark all locations visited", the visit a viewed treasure records for
its venue, and region placement. The controller layer takes it from one shared
fragment, `offeredLocationSql()`; placement writes it out, because it lives in
the service layer and importing a controller module there would be the first
such import in the codebase. This is deliberately *not* the rule for an
experience, where a
`missing_since` flag changes nothing anyone sees: there the alternative was
never deletion, and there is no duplicate to show. Here, a point that moved
appears as a mark plus an insert, and showing both would put a pin where the
source no longer says anything is.

**4. A visit row is never touched, and stays reachable — but it is not
displayed on a place nobody offers.** Taking back a visit runs unfiltered, so a
record on a withdrawn point can still be cleared; the per-experience progress
view counts offered points only, like every other read that shows a place.

An earlier draft returned a withdrawn point there when the reader had visited
it. A *replaced* point is what rules that out: identity is the point together
with the source's reference, so an edit to either — a corrected coordinate, a
renumbered component — is a withdrawal plus an insert, and the reader would meet
the same place twice, once ticked and once not, with that view's denominator
disagreeing with `location_count` in every list. The consequence to state
plainly is that a tick does not follow a point the source replaces, whether it
moved it or re-referenced it; the tick stays on the row the reader actually
visited, which is preserved and no longer displayed. Giving that row a
place on screen needs the verdict this slice deliberately leaves to the curator:
withdrawn, moved, or gone.

The experience-level record follows the same rule as the reads: the count that
decides whether unticking a point was the last one asks about offered points
only, so a visit surviving on a withdrawn point cannot hold a check on a list
while the progress view reports none visited and offers nothing to untick. That
is what deletion used to achieve by taking the row and its visit together. It
does mean the record is not restored on its own when a point comes back with
its visit intact — the next tick rebuilds it, and nothing on a machine path
writes a person's visit.

**5. No run may empty a category, and the mode that did is removed.** Force sync
is gone: `cleanupCategoryData`, `cleanupMuseumData`, the `cleanup` config hook
and the `force` flag through the API and the admin panel. With nothing left to
delete, a force run and an ordinary run over the same fetch differed in nothing
but the wipe.

**6. Missing detection's force exemption goes with it** — narrowing ADR-0020
decision 3 from four guards to three. That guard existed because the wipe left
nothing to be absent from; with no wipe, a run that skipped the coverage floor
could conclude that everything it failed to fetch had been delisted.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep deleting, and copy the visit record somewhere before the delete | A second store of the same fact, kept in step by hand. The row is the identity a visit points at; preserving the row is what preserves the visit |
| Mark the row, and let readers keep seeing it | A moved point is a mark plus an insert, so the map would carry a pin at the old place with nothing to say about it. The museum import fix would litter the map with them |
| Give a location the full two-axis lifecycle now (`source_membership`, `existence`) | Nothing would write or read either yet. The verdicts arrive with the curator's grouped card for an object's contents; schema ships with its consumers |
| Restamp `missing_since` on every run that finds the point still absent | It answers "when did this first go missing", and rewriting every marked row every run is churn that says nothing new |
| Keep `force` as a flag meaning "run over everything" | It already meant that; every run does. A mode that differs from the default in nothing is a button whose label is its only content |
| Keep `force` but have it mark instead of delete | Indistinguishable from an ordinary run — the run marks what the source withdrew either way |
| Report a marked row as `unchanged` when it returns | Its `auto` region assignments were dropped while it was missing, so it needs placement. Reported unchanged, it would come back placed nowhere |

## Consequences

**Positive:**

- A visit, a location visit and a viewed treasure survive every run, including
  what used to be a force run. Nothing in the sync path deletes user data.
- The museum import correction becomes non-destructive: departures are marks and
  curator verdicts, not deletions.
- `ON DELETE CASCADE` stops being load-bearing on a path a run takes routinely.
- A point that flaps — dropped by one run, offered by the next — keeps its id
  and everything attached to it across the gap.
- Force's two exemptions disappear, so every run is now measured against the
  coverage floor.

**Negative / Trade-offs:**

- `experience_locations` only grows. A source that churns its point set leaves
  marked rows behind, and nothing prunes them; the reads carry a predicate to
  skip them and a partial index to make that cheap.
- A location's `missing_since` is filtered where an experience's is not, so the
  two most similar-looking columns in the schema mean the same thing and are
  read differently. Decision 3 is the reason, and it is stated in the code.
- Nothing removes a row whose `external_id` the source renamed. Force used to,
  by removing everything. Those rows now linger — flagged by missing detection
  where the source is complete, and answered by a curator's verdict where it is
  ranked.
- A curator has no way yet to say what a marked location *is* — withdrawn,
  moved, or gone. The verdict arrives with the contents-level curation card.
- `ordinal` is nullable in the database, and no read of it widens in TypeScript
  — which is a standing obligation rather than a free win. Every read carries
  the offered predicate today, so a NULL never reaches a client type that
  declares `number`; a future read that forgets it would send one, and the
  frontend renders `ordinal + 1` as a label.

## References

- Narrows: [ADR-0020](0020-experience-lifecycle-and-run-changeset.md) decision 3
  (missing detection's force guard), and answers its trade-off "a force sync
  still wipes and reloads the category". Decisions 1 and 2 of ADR-0020, and
  ADR-0021, are untouched.
- Related docs: `docs/tech/experiences.md` § Location model, § Sync orchestrator
- Follows: PR #495, which stopped the bulk form of the same cascade
- Enables: the museum import correction, whose departures would otherwise
  destroy visit records
