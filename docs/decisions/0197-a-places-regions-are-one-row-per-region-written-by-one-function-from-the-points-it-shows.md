# ADR-0197: A place's regions are one row per region, written by one function from the points it shows

**Date:** 2026-11-11
**Status:** Accepted

---

## Context

A place's regions were held twice. Placement (ADR-0054) wrote where each point lies into
`experience_location_regions`, then copied a place's union of those rows into
`experience_regions`, for places that hold a kind of their own only. Readers took one or the
other:

- A region's list, its count and the by-id regions asked `experience_regions`, and then asked
  again, row by row, whether a point a reader may see lies in that region
  (`readerRegionMembershipSql` walked the place's own points and its parts' into the point rows).
  Placement writes unread points too (ADR-0025 decision 5), so the place rows alone said "here"
  on the strength of points no reader is shown.
- A serial site's part with no kind of its own (4,986 of the 5,596 parts on the development
  catalogue, 2026-11-11) held no place row at all. Its regions lived only in the point rows of
  its point, under its site's rows.
- The copy was written only when a point moved. A place that gained its kind later, such as Park
  Güell, held point rows and no place rows, and no region's list offered it. Places a merge folded
  kept their place rows (194).

The catalogue model Epic (#2115) asks for one region junction for every place with a location,
parts included, and a whole's regions computed by one function for a changed part's wholes, not
by row triggers recursing up the hierarchy (#2120). A whole is in its parts' regions. Wholes will
nest (the Frontiers of the Roman Empire, Hadrian's Wall, a fort on it; #2126); none does on the
development catalogue, and every reader of a place's points reads its own and its direct parts'.

## Decision

1. **`experience_regions` is the one region junction of places**, the parts included. A part with
   no kind holds its rows like any place, and no list offers it: every reader's set composes a
   record in a kind (`placeShownSql`, ADR-0100 decision 2), as before.
2. **A place's automatic rows are the regions of the points it shows**: its own points and its
   direct parts' points, the two arms every reader of its points reads (`PLACE_POINT_ARMS`), among
   the points placement places (offered, not turned down), so a region never lists a place whose
   points no reader is shown. What a nested whole shows is #2121's. Each row carries `listing`:
   - `offered`: a point a reader may see puts the place here. Readers find it here.
   - `fallback`: the place shows no point a reader may see anywhere, and its unread points put it
     here (an arrival waiting for a curator).
   - `scope`: only an unread point puts the place here while a point a reader sees puts it
     elsewhere (a move waiting for a curator; Malta's Ċentrali with a seventh temple unread).

   Readers read `offered` rows only (`readerRegionMembershipSql`); curators read every row. A
   curator's manual row is always `offered`.
3. **One function writes them.** `refresh_place_regions(places, world_view)` in the schema walks
   up from the given places to the wholes they are direct parts of, computes the expected rows
   (`place_regions_expected()`) from the point rows placement wrote, and writes only what differs,
   never a manual row. No geometry is read. Placement calls it last, in place of its copy.
4. **Statement-level triggers call it when the inputs change**: an update or a delete of a point
   that changes its place, its state (`curation_state`, `refused_at`, `missing_since`,
   `existence`, `merged_into_id`), and any write to `experience_parts`. A publish, a refusal, a
   verdict, a merge's moves and a part relation keep the rows right in the writer's own
   transaction, without a writer having to remember. A moved coordinate stays placement's.
5. **`experience_location_regions` stays as placement's per-point record** until the point tables
   go (#2124). Only the function reads it to decide a place's regions; a point's own `in_region`
   and region path still read it.

This narrows ADR-0025 decision 5 on the reader's side: the check that a region holds a point a
reader may see is stored on the row, not asked at read time. It narrows ADR-0100 decision 2: a
part has regions of its own, and is still listed nowhere without a kind of its own. ADR-0054 is
unchanged: points are placed as before.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the read-time check and only add the parts' rows | Every region read keeps walking points into point rows per place, and the point rows stay a second junction readers rely on; #2124 could not drop them without rewriting every reader again. |
| Row triggers on `experience_regions` that cascade up the part-of chain | Recursion through triggers, once per row; a run's write of one site's 758 parts would refresh the site 758 times inside one statement (#2120 rules it out). |
| Recompute in TypeScript after each writer | Every writer that publishes, refuses, marks or merges a point has to remember to call it; the identity registry (ADR-0143) showed the database is where such a rule is kept whole. |
| Listing as a boolean (shown or not) | The rows a whole holds while none of its parts may be shown (`fallback`) and the rows of an unread move (`scope`) answer different questions for #2121, which decides whether a whole whose parts all wait for a curator is listed. Both stay curators' here. |
| Area and line as inputs now | No line column exists, one whole holds an outline (a merge #2119 undoes), and #2122 states the rule for every place's geometry. #2122 adds them as inputs to the same function. |

## Consequences

**Positive:**
- A region's list, count, map batch and the by-id regions ask one column of the row.
- A part's own read names its regions; #1168 can paint a traveller's regions from the places
  visited.
- A place whose kind arrived after placement is in its regions at the next refresh (Park Güell).
- A catalogue check (`place-regions-out-of-step`) compares the rows with what the function makes.

**Negative / Trade-offs:**
- The rule that a point is visible to a reader is stated twice: in `offeredLocationSql` and
  `publishedContentSql`, and in `place_shown_points()`. `placeRegionsSchema.test.ts` holds the two
  together; #2123, which moves the part gate onto source records, moves both.
- A publish or a refusal now writes `experience_regions` rows of the place and of its wholes in the
  curator's transaction. The function first locks the places it rewrites, one advisory key each
  in key order (`db/locks.ts`), so two transactions refreshing one whole take turns. It reads the
  places it reaches again once the keys are held, since a wait can let a part relation commit.
- A whole's rows grow with its parts: about 15,800 more rows on the development catalogue.

## Amendments

- 2026-11-12, before acceptance: the refresh locks the places it rewrites (advisory keys) rather
  than their existing rows, after review found that a whole with no rows yet had nothing to lock;
  the migration's backfill runs in a transaction of its own.
- 2026-11-12, before acceptance: a place's points are its own and its direct parts', as the
  readers show them, rather than its parts' four levels down; and the refresh reads its reach
  again after taking its keys.

## References

- Related ADRs: ADR-0025, ADR-0054, ADR-0100, ADR-0143, ADR-0198
- Related docs: `docs/tech/experiences.md` § Region assignment, `docs/tech/data-assertions.md`
- Issue: #2120 (Epic #2115)
