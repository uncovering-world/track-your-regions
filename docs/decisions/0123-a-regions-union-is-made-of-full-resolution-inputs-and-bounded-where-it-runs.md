# ADR-0123: A region's union is made of full-resolution inputs, and bounded where it runs

**Date:** 2026-10-18
**Status:** Accepted
**Narrows:** [ADR-0122](0122-a-world-views-geometry-computation-runs-in-the-dump-worker-beside-its-builds.md) decision 2 (a running computation's cancel cancels the statement in flight, rather than waiting for the region in hand)

---

## Context

A region's geometry is the union of its members and children (`computeRegionGeometryCore`, the editor's stream). Since #443, nothing on the way to `regions.geom` coarsens the result. One departure was left. When a region's inputs held more than 300,000 points, the collect step simplified each input at 0.005° (about 500 m) before the union (`shouldSimplify`), to keep the union inside a five-minute statement bound. Two writers declared that bound separately.

Even so, the guard did not keep the largest regions inside the bound. On 2026-10-17, a computation of world view 5 ("Administrative") skipped Asia, Europe, North America and Canada on the statement timeout, and left them with no geometry. Simplifying four million points cost more than the union it protected: Canada's collect step alone took over ten minutes in August.

Two other levers were measured on dev on 2026-10-18.
- **Union each input's stored 1 km rung.** It took 12 to 20 seconds, but it broke rule 5 of `geometry-columns.md` (derive from source, never from derived). It was coarser than the guard it replaced. It also left 2,399 sliver holes in Europe, because neighbours' rungs are simplified apart. It was withdrawn (#459).
- **Union the full-resolution inputs with no simplification.** The times:

| Region | Union time | Points |
|---|---|---|
| Canada | 3 min 18 s | 3,892,522 |
| Asia | 6 min 15 s | 4,779,620 |
| Europe | 9 min 42 s | 4,403,273 |

Since ADR-0122, a world view's computation runs in the dump worker, where a long statement stops nothing else.

## Decision

**1. Every union is made of full-resolution inputs.** The collect step takes each member and child with `ST_MakeValid` only, whatever the count of points. `shouldSimplify` is removed, and with it the exemption the union writers' guard (`unionGeomToleranceGuard.ts`) gave the collect statement. The collect step is held to the same no-coarsening rule as the snap, the union, the cleaning and the write. Rule 7 of `geometry-columns.md` has no exception left.

**2. The statement bound is declared once, per runtime.** `GEOMETRY_STATEMENT_TIMEOUT_MS` in `controllers/worldView/geometryTimeouts.ts` gives:
- `worker`: 30 minutes, three times the slowest union measured, for the world view's computation in the dump worker;
- `request`: 5 minutes, for the editor's single-region stream, which the backend answers.

**3. A statement that outruns its bound is loud.**
- **In the worker,** the region's geometry is cleared, so no outline older than its members stands for it, and the run counts an error, not a skip (`clearedOnTimeout`). Each region above it in the same run is cleared and counted the same way rather than unioned, since its union would lack the child's territory. The next run takes them all again.
- **A stop of the worker, or an admin's cancel,** cancels the statement in flight in the database (`pg_cancel_backend`), and a stop between two statements is caught before the next one. A cancel then never waits out a union of up to half an hour, and a killed worker leaves no union running beside the next worker's. Nothing of that region is written. This narrows ADR-0122 decision 2, under which a running computation stopped after the region in hand.
- **The editor's pre-step,** which unions a region's children without geometry before the region itself (`recomputeRegionGeometry`), runs under the same request bound as the stream.
- A cancel by anyone else raises the same `query_canceled` as a timeout (`isQueryCanceled`, `db/queryCanceled.ts`), and is handled as one.
- **In the stream,** the region's geometry is not written. Children the pre-step computed before it stay, each committed on its own. The error says the region is too large to compute there and names the world view's computation.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the 0.005° input guard, and raise its threshold or its tolerance | It is the coarsening rule 1 exists to forbid, it left 500 m errors in more than one in four multi-division regions, and it did not even keep the continents inside the bound. |
| Union the inputs' stored 1 km rung (#459's first lever) | It derives from a derived column, it is coarser than the guard, and it leaves slivers between neighbours whose rungs were simplified apart. |
| One 30-minute bound for both writers | A request held for half an hour ties up a backend connection, and a restart of the backend stops it part-way. The editor's stream stays a request, and a continent is computed in the worker. |
| On a timeout, keep the region's previous geometry | That is the silent fallback the run's end line was meant to rule out. An outline that may predate its members would stand with nothing saying so. |

## Consequences

**Positive:**
- Every stored region is at the resolution of its sources. Continents and countries of many islands no longer carry a 500 m error up every rendered rung.
- Asia, Europe, North America and Canada can be computed at all. They fit the worker's bound with room to spare.
- A region too large for its bound is named as an error, never drawn coarser or older.

**Negative / Trade-offs:**
- A world view's computation takes longer where it holds large unions, minutes per continent.
- The editor can no longer compute a continent. It says so and points to the world view's computation.
- A stored union holds more points. The rendered rungs are simplified from it as before, and the tiles draw those.

## References

- Related ADRs: ADR-0122 (the computation runs in the dump worker), ADR-0035 (a region change clears the derived parent)
- Related docs: `docs/tech/geometry-columns.md` rules 1 and 7, `docs/tech/world-views.md` § Geometry Computation
- Issue: #459; #443, which removed the output-side tolerance
