# ADR-0202: A visit holds its trips, each with an approximate date

**Date:** 2026-11-13
**Status:** Accepted

---

## Context

A visit records that a traveller was at a place and nothing about when (#773). Several issues
wait on a date: what changed since the visit (#604, #612, #615), the historical country a visit
belongs to (#616), and the catalogue as it stood on the trip's date (#2008). A traveller rarely
knows the day: NomadMania keeps a day, a month or only a year, and quick choices beat a calendar
for past dates. A traveller also goes back: the Uffizi in 2015 and again in March 2022 are two
times there, and one date per place would lose one of them.

The maintainer decided on 2026-11-12 that every trip to a place is kept with its own date, that a
visit stays one fact per traveller and place, which the map, the counts and the regions read, and
that a visit with no dated trip is allowed. The visit's `visited_at` was the moment the tick was
made, never when the traveller was there; ADR-0199's alternatives left its rename to this slice.

## Decision

1. **A visit holds its trips.** A trip is a row of `user_visit_trips` under one visit of
   `user_visited_experiences`, which stays one row per traveller and place. Unticking the place
   removes its trips with the visit; removing the last trip keeps the visit, with no date.
2. **A trip's date is approximate.** `year`, `month` and `day`, each nullable: which are set is the
   precision, a month only within a year and a day only within a month the month has, from 1900 to
   next year. All three empty is a trip whose date the traveller does not remember. The rule is
   `@tyr/shared/approximateDates`, which a place's lifetime (#1719) reads too, so a trip and a
   place's dates are compared by one function (#2008).
3. **No trip is written for a visit made before.** The tick's moment is not a trip's date.
   `visited_at` becomes `marked_at` (migration 236), and the answers that carried it say
   `marked_at` and `markedAt`.
4. **The dates are the traveller's own.** Read and written only under `/api/users/me`, of the
   caller's own visits; another traveller's trip answers 404. No reader-facing read carries them.
5. **Every trip write reads the place or the visit it writes for inside its own statement, under a
   share lock**, as every visit write does (#2120), and a merge carries a folded visit's trips to the
   survivor's visit; its undo takes back exactly those.
6. **An untick is undoable when it removes trips.** Its answer carries each removed visit with its
   trips, and one request puts them back (`POST /api/users/me/visits/restore`).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| One date per visit | A traveller who went back loses a trip, and a second tick would overwrite the first date. |
| A trip for every existing visit, dated by `visited_at` | That moment is when the tick was made; it would put a wrong date on almost every visit. |
| A precision column beside a full date | Two columns that can disagree; which parts are set says the same. |
| Keep `visited_at` | Once trips carry dates, a visit column named for the visit's date would be read as one. |

## Consequences

**Positive:**
- A visit can say when, as precisely as the traveller remembers, and keep every return.
- #604, #612, #615, #616, #2008 and the export (#591) read one date shape.

**Negative / Trade-offs:**
- The rename changes three response fields, which `api:breaking` reports.
- An untick still removes the trips with the visit; only its Undo, in the moment, brings them back.

## References

- Related ADRs: ADR-0199, ADR-0046, ADR-0022
- Related docs: `docs/tech/experiences.md` § User visits, `docs/security/SECURITY.md`
- Issues: #773, #2120, #1719, #2008, #591
