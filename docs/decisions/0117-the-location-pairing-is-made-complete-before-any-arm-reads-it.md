# ADR-0117: The location pairing is made complete before any arm reads it

**Date:** 2026-10-17
**Status:** Accepted

---

## Context

`writeExperienceLocations` (`backend/src/services/sync/locationWriter.ts`) decides which stored row
each incoming point *is* once per run, in the `paired_rows` table every write arm reads (ADR-0027
decision 5a). The table is built by two greedy passes:

1. `DISTINCT ON (ordinal)` gives each incoming point its best stored row: the exact reference, then a
   row that is not marked, then the nearer, then the lower id.
2. `DISTINCT ON (location_id)` keeps the lower ordinal where two points chose one row.

The second pass drops the losing point instead of sending it to its next candidate. So a one-to-one
pairing of every point can exist inside the ten-metre tolerance and go unfound. ADR-0027 decision
5a-i accepted this as a stated cost, on the ground that no source publishes the shape that triggers
it: two points of one reference between ten and twenty metres apart.

That ground no longer holds. On the dev catalogue on 2026-10-17, six places carry two points of one
Wikidata item in that band:

- the Russian Museum, 13.5 m apart;
- the Bronze Horseman, 17.4 m;
- San Ignacio Miní, 17.1 m;
- Nidaros Cathedral, 10.3 m;
- the Saint Sophia Cathedral in Polotsk, 12.7 m;
- Kōtoku-in, 13.7 m.

These come from the Wikidata kinds, whose items can carry more than one coordinate statement
(#549). The loss needs one more thing: the source lists the points in a different order from the
stored one, which Wikidata does when statements are reordered. Then the fast path's match by
position fails and the pairing decides. Run against PostgreSQL on the Bronze Horseman's geometry,
the greedy passes paired one point. The run then inserted the other as new and withdrew a stored
row that had not moved: on the ungated Public Art & Monuments source, a withdrawal card beside a
visible replacement metres away.

## Decision

The greedy pairing stays the starting point, and is then made complete before any arm reads it.
After `paired_rows` is built, the writer reads the candidates, in the same preference order, for a
place where some point has a candidate and no row. `completePairing`
(`backend/src/services/sync/locationMatching.ts`) then searches an augmenting path (Kuhn's
algorithm) for each point left over. It tries a row nobody holds first, then a held row whose holder
can move to its own next candidate. The table is rewritten only if the pairing grew.

This narrows ADR-0027 decision 5a-i: the pairing it accepted as greedy now has as many pairs as any
one-to-one pairing of the candidates can. Decision 5a's preference order still decides every pair
the greedy passes make. A pair moves only where moving it is what lets one more point pair, and then
to its own next-best row.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the cost stated (ADR-0027 decision 5a-i as it was) | Its premise was that no source has the shape, and six places now do. The cost is a false departure and a false arrival on ungated sources, which is the defect ADR-0027 exists to remove. |
| A maximum matching inside the SQL relation, as a recursive CTE | It is hard to read and hard to test, and Postgres refuses `ORDER BY` in a recursive term ("ORDER BY in a recursive query is not implemented"), so the preference order could not be stated where the matching is made. The candidate sets are a few rows per place, so computing the matching in a pure function the unit lane can read costs one extra read, and only for the places that need it. |
| Repeat the greedy passes for the leftover points only | That finds the issue's own case but not one where the first point holds the only row the second can have. Only an augmenting path finds that one. |
| Replace the two passes with the completion outright | The two passes are the product decision of ADR-0027 decision 5a, and the mocked lane pins them. Starting from their result keeps every pairing they already get right exactly as it is. |

## Consequences

**Positive:**
- A source that lists two points of one reference 10–20 m apart, in another order, no longer
  produces a withdrawal that did not happen and an arrival that is not new.
- The common run is unchanged. A place where every point paired returns no candidate rows from the
  extra read and writes nothing.
- `locationMatching.db.test.ts` observes the case against PostgreSQL, which the greedy passes alone
  fail.

**Negative / Trade-offs:**
- One more read per slow-path place, and a rewrite of `paired_rows` where the pairing grew.
- The pairing is now decided in two places, the SQL passes and their completion. Both read one
  statement of the preference order (`preference` in the writer), so the two cannot drift apart.

## References

- Related ADRs: ADR-0027 (decision 5a-i narrowed here), ADR-0090 (the exact reference first)
- Related docs: `docs/tech/experiences.md`
- Issue: #549
