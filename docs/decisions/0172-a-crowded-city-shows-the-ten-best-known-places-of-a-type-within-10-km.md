# ADR-0172: A crowded city shows the ten best-known places of a type within 10 km

**Date:** 2026-11-01
**Status:** Accepted — decision 1 narrowed by [ADR-0173](0173-a-place-holding-works-is-never-crowded-out.md)

---

## Context

A kind lists a region's places by name (`experienceRegionQuery.ts`, `ORDER BY e.name, e.id`), with
no order by fame. On the development catalogue of 2026-11-01, 85 places of worship lie within
10 km of central Rome. Under the admission architecture #2177 proposes, that rises to 147 in Rome,
123 in Moscow, 76 in Cairo, 71 in Paris and 70 in Kyoto. Santa Maria Maggiore would sit among a
hundred churches a visitor will never reach.

The maintainer decided on 2026-11-01 (#2177): a place is shown to readers unless ten better-known
places of the same kind and type lie within 10 km of it. Admission is not capped. The rule only
decides what a reader is shown. ADR-0023 decision 3 and ADR-0057 decision 6, which forbid a quota,
are about admission and stand.

Three shapes were measured on #2177's proposed catalogue of 19,819 places (the local
`experiments.md` §§ 16–20 under #2177):

- **A top ten per region** drains a large region into its capital. The Central Federal District
  is one leaf of the Administrative world view, and would show 19 of its 181 places of worship
  outside Moscow.
- **A ten scaled with the region's area** either still drains the region (by the square root of
  the area, 145 of 181) or stops trimming the capital (linearly).
- **A circle around each place** trims only the cores: Moscow 142 → 59, Rome 145 → 37, Paris
  79 → 39. It hides 965 places in all, no canon top, and 68 of the 646 places the city surveys
  expect: Kyoto 23 (Nanzen-ji, Daitoku-ji, Chion-in), Rome 21 (Saint Paul outside the Walls, San
  Luigi dei Francesi, Santa Sabina), Istanbul 11, Cairo 6. The maintainer accepted that cost.

The three signals of fame live in workbench tables: `readership_months`, `wikivoyage_usage` and
`wikidata_sitelinks`. No serving read may touch them (`backend/src/db/tableTiers.ts`).

## Decision

**1. Crowded out means ten better-known candidates of the same kind and type within 10 km.**
- A candidate is an admitted membership of a kind that declares the rule, on a place that is not
  lost and has a point, pending or published. A refused membership is no candidate.
- Its fame is the mean of three percentiles among every candidate of the same kind and type
  worldwide: readers a year, the Wikivoyage editions that use its item, and its Wikipedia
  editions. The fame orders measured beside it (readers alone, guide first, editions first) hide
  the same places within ±10.
- A place is crowded out when ten candidates within the radius have a strictly higher fame. Ties
  are shown together.

**2. The kind declares the rule as data.** `experience_kinds.crowding_limit` and
`crowding_radius_km` are set together or not at all. Six kinds take 10 and 10 km: Places of
worship, Squares & streets, Monuments & memorials, Public art, Towers, and Bridges & engineering
marvels. Art Museums, Archaeology and World Heritage Sites are measured before they take it.

**3. The answer is stored on the serving side, and absent means shown.**
- `membership_fame` holds a membership's three signals and its fame. The run's after-step writes
  it from the workbench (`services/sync/crowding.ts`). A signal whose source is not in place is
  kept as last measured, so a missing readership year does not rank everything as unknown.
- `membership_crowding` holds only the memberships crowded out.
- A recount that never ran, or a membership measured since the last refresh, hides nothing. A
  membership with no fame yet is neither crowded out nor counted as better known.

**4. The schema recounts; no writer does.**
- After every run, `refresh_crowding()` scores every candidate and recounts the whole catalogue.
- Between runs, triggers recount within the radius of a place as the transaction that changes it
  commits: a membership's admission, type, kind or place (`crowding_follows_membership()`), a
  place's existence or point, or its deletion (`crowding_follows_place()`).
- One recount runs at a time, under a transaction lock. Two whose areas overlap would otherwise
  each delete rows the other has not committed and insert the same membership twice. The
  triggers are deferred to the commit, so the lock is held for a transaction's last moment and
  not across a run's sweep, which goes on locking memberships a curator's write may wait on.
- A curator's refusal or verdict of lost lifts the next place into the ten at once, as the
  regional geometry triggers do for a member change (ADR-0068).
- Fame itself moves only with a run. A recount between runs uses the fame last scored.

**5. A list, the map and every count hold only shown places; search, the card and a visit hold
the tail too.**
- `membershipShownSql` / `placeShownSql` (`db/membership.ts`) and `experienceShownToReaderSql`
  (`db/readerPredicates.ts`) are offered and not crowded out.
- Shown places are what reach a region's list and count, the region locations, the world points,
  the kind and region counts, the coverage report, and the queue's arrivals.
- `experienceOfferedToReaderSql` keeps the tail. Search finds a crowded-out place and its card
  opens, so a reader learns that the catalogue knows it. A visit can be marked from that card and
  counts toward no progress or statistic, since every count reads the shown set (the maintainer,
  2026-11-01).
- A place crowded out of one kind and shown in another is shown in that other kind. The kind a
  row is shown under prefers a shown membership (`shownMembershipSql`), and a list's kinds leave
  the crowded one out (`placeKindsSql(…, true)`).

**6. A crowded-out arrival asks the curator nothing** (`arrivalOpenSql`, `arrivalWaitingSql`).
No curator work is spent on a place no reader would be shown. When a refusal or a loss nearby
lifts it into the ten, the recount removes its row and the arrival is asked.

**7. The tail has a list of its own** (the maintainer, 2026-11-01): a second-order list per
region, kind and type, ranked by the same fame, never mixed into the main one. It is built on
this storage as the second slice of #2201.

## Consequences

**Positive:**
- **What a reader meets first in a crowded city is what a guide puts first.** Rome's places of
  worship begin with St Peter's, the Pantheon, Santa Maria Maggiore and San Pietro in Vincoli.
- **The country around a core stays whole**, and splitting a world view's regions further
  changes nothing in what is shown, since the rule reads geography rather than regions.
- **One predicate carries the rule to every surface** that already composed the offered one, and
  counts stay additive: a parent's count is the sum of its children's.
- **Development catalogue, 2026-11-01:** 124 of 3,365 measured memberships are crowded out: Rome
  51 churches, Istanbul 25 mosques, Paris 11 churches and 7 squares, Kyoto 7 temples, London 6
  streets, New York 5 streets. A full refresh takes 0.24 s, a recount around one place 0.05 s,
  and the whole after-step 15 s, most of it the readership read.

**Negative / Trade-offs:**
- **A pending arrival competes before it is passed.** Better-known arrivals not yet read can
  push a published place out, so a core shows fewer than ten until the curator answers them.
- **A small region beside a dense core can show none of a type it holds.** World view 5 has no
  such list today; a simulated 25 km grid has 12 lists in 10 of 6,783 cells, beside Paris, Venice
  and Riga. If the real split of regions produces them, a floor of one place per region and type
  is measured then.
- **The schema states the candidate set** in its functions as well as in `db/membership.ts`.
  `backend/src/db/crowding.db.test.ts` holds the two to the same set.
- **A run's sweep pays a recount** at its commit for every admission it changes on a kind with the
  rule: about 50 ms in Rome's centre per membership. Recounts queue behind one another.
- **A crowded-out top is a miss of the coverage report**, since coverage counts what is shown. The
  calibration report names it apart (`crowded`), so a survey's check does not read it as a gap of
  the kind's line.

## References

- Related ADRs: ADR-0023 decision 3 and ADR-0057 decision 6 (admission is never capped, unchanged),
  ADR-0025 (the gate the arrival predicates follow), ADR-0068 (a trigger owns the invalidation),
  ADR-0124 (table tiers), ADR-0171 (a place's surroundings as the regional tier's unit)
- Related docs: `docs/tech/experiences.md` § What a crowded city shows
- Issues: #2201; #2177 (the admission review that measured it)
