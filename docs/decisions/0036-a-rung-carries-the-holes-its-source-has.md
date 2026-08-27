# ADR-0036: A rung carries the holes its source has

**Date:** 2026-08-27
**Status:** Accepted

---

## Context

The map draws holes that are in no data. Over north-eastern Thailand a visitor sees 66 of them
where the catalogue holds 8; the largest is 561 km² in Mercator, big enough to read as a white
blob at zoom 8 (#685). They are not a defect of the boundaries — they are made by the pass that
builds the rungs the tiles serve.

`simplify_for_zoom()` simplified with **`ST_SimplifyVW`**, which is not topology-preserving. It
moves every ring on its own, so the simplified outline crosses itself and two parts that were
disjoint come to overlap. The `ST_MakeValid` that every geometry write in this schema ends with
(rule 2) then resolves the overlap the only way it can: by carving it out as an interior ring. So
a continent gains holes as it is simplified, and gains more the coarser the rung.

Measured on the dev database, over the eight root regions of the Administrative world view, which
hold **610** interior rings between them at full resolution:

| rung | interior rings carried | vertices |
|------|------------------------|----------|
| `geom_3857` (the truth) | 610 | 11,727,130 |
| `geom_simplified_medium`, 1 km — **what the map serves** | **1,933** | 601,940 |
| `geom_simplified_low`, 5 km | **7,057** | 363,755 |

The 1 km rung is what a visitor actually reads: `tile_world_view_root_regions` serves it at
zoom 5-8, and for a row over the 10 MB display budget — every continent — at *every* zoom
(ADR-0031 decision 5).

Two things beside the holes were wrong in the same call, and both follow from the same cause.
`ST_SimplifyVW` **annihilates** a ring narrower than its tolerance, and the vertex floor below it
then dropped what came back with fewer than four points: 436 of Asia's 26,151 pieces went at the
1 km rung, against rule 12. And the two fallback stages the function carried — retry at a
tolerance scaled to the largest part's width, then give up and return the input unsimplified —
existed only because that could happen.

The rungs a coverage pass owns were already clean. `simplify_coverage_regions()` overwrites the
low and medium rungs of a sibling set with `ST_CoverageSimplify` (rule 15), and measured over the
58 children of Asia it invents **0** rings. What carried the defect is everything outside such a
set: a world view's root regions, a lone child, a hull region, the two `_real` columns, and every
rendered rung of `administrative_divisions`.

## Decision

**A rung is built by a pass that preserves topology, so it carries the interior rings its source
has and no others.** `simplify_for_zoom()` simplifies with `ST_CoverageSimplify`, applied to the
row as one element.

Three things make that the right pass rather than a compromise:

1. **It is rule 13's algorithm.** GEOS implements `ST_CoverageSimplify` with `TPVWSimplifier` —
   *topology-preserving* Visvalingam-Whyatt. Rule 13 chose Visvalingam-Whyatt for coastlines
   because it eliminates by area rather than by distance, and that choice stands; only its unsafe
   form is gone. `ST_SimplifyPreserveTopology` would have retired the rule for Douglas-Peucker.

2. **A row is already a coverage.** The parts of a valid MultiPolygon are disjoint polygons, which
   is precisely what a coverage is, so the whole row goes through the pass as one element and its
   parts stop colliding with each other. This is the same call `simplify_coverage_regions()` makes
   over a whole sibling set; what that function makes shared *between* rows, this makes consistent
   *within* one. Neither can do the other's job, and the per-row pass stays what a row outside a
   sibling set falls back to.

3. **Nothing is annihilated.** Measured on PostGIS 3.5.6 / GEOS 3.14.1, coverage simplification
   drops neither a part nor a hole — a 100 m speck 50 km from a square and a 200 m lake inside it
   both survive a 5 km pass, and all 26,151 of Asia's pieces survive both rungs — so rule 12 is
   honoured where the VW version broke it, and the two fallback stages that existed for the case
   where nothing survived go with it — with them goes rule 16, whose only implementation the
   second of those stages was. That is a measurement rather than a documented guarantee,
   and `docker-compose.yml` pins `postgis/postgis:17-3.5-alpine`, which floats GEOS: what notices
   the day it stops holding is the catalogue check, whose other half is that a rung at 5 km or
   finer may not lose a piece. `simplify_for_zoom()` also keeps its last resort — a rung that came
   back empty keeps the unsimplified shape rather than nothing.

Measured over the same eight root regions, at both tolerances:

| rung | interior rings | vertices | parts |
|------|----------------|----------|-------|
| source | 610 | 11,727,130 | 75,195 |
| 1 km, before | 1,933 | 601,940 | 73,716 |
| 1 km, after | **610** | 595,310 (−1.1 %) | 75,195 |
| 5 km, before | 7,057 | 363,755 | 68,253 |
| 5 km, after | **610** | 356,230 (−2.1 %) | 75,195 |

The tile budget the rungs exist for is not spent to buy this: both rungs come back with *fewer*
vertices than they held, and every part is kept.

`simplify_for_overview()` is left on `ST_SimplifyPreserveTopology`, where ADR-0031 put it.
Measured over all 3,830 regions holding a low rung, neither cheap rung carries more interior rings
than the rung it derives from — 0 rows — so there is nothing to fix there and no reason to move a
working pass.

## Alternatives Considered

| Option | Why rejected |
|--------|--------------|
| `ST_SimplifyPreserveTopology` on the whole row | Correct, and it retires rule 13 for Douglas-Peucker. It costs **5 m 50 s** for Asia's 1 km rung — 6× the 56 s this decision costs, and 9× the 38 s `ST_SimplifyVW` cost before either — because it indexes every segment of the row against every other. And it does not survive the write path intact: the call itself keeps the ring count — Australia's row comes back with the one ring its source has — but leaves the geometry *invalid*, `Nested shells` on the east coast, where a bay's mouth has closed over an island. `validate_multipolygon()` is applied to every geometry this schema writes (rule 2), and its `ST_MakeValid` resolves that containment as an interior ring: 2 for Australia and 557 for South America, against 1 and 556. Measured on `validate_multipolygon(ST_SimplifyPreserveTopology(geom_3857, 1000))`, which is what the rung would have been. |
| `ST_SimplifyPreserveTopology` per part, collected without a global `ST_MakeValid` | Fast, and the ring counts look exact — because the overlaps are still there. The result is invalid (`Self-intersection` on Australia's east coast), which rule 2 forbids and which `ST_CoverageSimplify` downstream needs not to be. Validating it afterwards produces **565** holes. |
| Keep `ST_SimplifyVW` and strip the rings the source does not have | Needs a rule for telling an invented ring from a real lake, on a shape whose outline has just moved. A pass that does not create the problem needs no such rule. |
| Do nothing below the coverage pass and widen `simplify_coverage_regions()` to every row | It is keyed on a parent id, and a world view's root regions — the rows with the worst counts — have no parent to key it on (ADR-0031 decision 3). It would also not reach `administrative_divisions` or the `_real` pair at all. |

## Consequences

**Positive:**

- The map draws the holes the data has. Over north-eastern Thailand that is 8 rather than 66.
- The rungs get cheaper, not dearer: −1.1 % of the vertices at 1 km and −2.1 % at 5 km.
- Every part survives every rung again (rule 12), including the 436 pieces of Asia the 1 km rung
  was dropping.
- Two fallback stages and their reason are gone from `simplify_for_zoom()`.
- Building the rungs of a many-part row gets much faster where the old cost was the global
  `ST_MakeValid` over a collection of overlapping parts: Australia's 1 km rung, 8.3 s to 0.38 s.

**Negative / Trade-offs:**

- The largest single row costs more to simplify: Asia's 1 km rung, 38 s to 56 s. That is paid when
  a continent's geometry is computed and when GADM is imported, not when a tile is served.
- Every rendered rung of both tables has to be rebuilt on a database that already holds data —
  `db/migrations/037-topology-preserving-rungs.sql`, which is a recompute of two large tables.
- The rule is held over rows for `regions` only. `administrative_divisions` comes off the same
  function, but reading its full-resolution column would cost the catalogue-check report an order
  of magnitude more than it answers in today (its eight root divisions weigh 386 MB between them),
  so what holds the rule there is the guard over the schema text rather than a check of the rows.

## References

- Related ADRs: ADR-0031 (the two cheap rungs, the part floor, the display budget), ADR-0032 (a
  rule stays absolute and the debt is recorded)
- Related docs: `docs/tech/geometry-columns.md` (rules 12-15, the rung table),
  `docs/tech/data-assertions.md`
- Guards: `backend/src/db/renderedRungTopology.test.ts` (the code),
  `backend/src/controllers/admin/dataAssertions/regionGeometryAssertions.ts` (the rows)
- PR / issue: #685
