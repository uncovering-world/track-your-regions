# ADR-0054: Placement reads the leaves through their pieces, and asks a non-leaf only about what no leaf holds

**Date:** 2026-09-10
**Status:** Accepted

---

## Context

Placement decides which regions of a world view hold each offered point
(`backend/src/services/sync/regionAssignmentService.ts`). It has two ways in — a run places
the objects it moved, and an admin rebuilds a whole world view — and both ran the same
direct step: every point against every region with a geometry, leaves and non-leaves
alike, followed by a walk that gives every ancestor of a matched region a row of its own.

The direct step's cost is the test against a whole geometry. A bounding box narrows it only
where the box is small, and in the Administrative world view — the only one with geometry —
Russia's parts reach both sides of the antimeridian, so the boxes of Russia and of Asia span
every longitude: a point in Paris was tested against Asia's 7.1 million vertices. The first
run of the Places of worship source (sync log 105, 2026-09-09) spent 25 minutes placing its
1078 points. The world view holds 3594 leaves (12 892 vertices on average) and 235 non-leaves
(68 551).

Most of what the test against a non-leaf finds, the ancestor walk writes anyway. Not all of
it, and the rest was measured on the development catalogue on 2026-09-10 before choosing:

- **A parent is not exactly the sum of its children.** It is built from a GADM division a
  level up, and GADM's coastlines do not nest to the metre between levels. Eight offered
  points lie in a country and in no leaf of it — Juno Beach, Delos, the Megaliths of Carnac,
  Tuol Sleng, the Hiroshima Peace Memorial from two sources, two points of the Dorset and
  East Devon Coast — each 20–240 m outside its nearest leaf.
- **A non-leaf's outline can cover a point a leaf outside it holds.** Nine points: eight in
  the Vatican (St Peter's, the Sistine Chapel, the Vatican Museums and five more) held by the
  leaf Vatican City and also by Italy, whose union removed the Vatican's 0.44 km² as a small
  hole; and the Qhapaq Ñan's Segment Rumichaca on the Colombia–Ecuador border bridge, held by
  the Ecuadorian leaf Carchi and by the non-leaf Colombia, 35 m from the Colombian leaf Nariño.

[ADR-0031](0031-a-display-rung-drops-what-a-reader-cannot-see.md) considered storing a
subdivided geometry for tiles and turned it down, because a line layer would draw the cuts as
borders. [ADR-0035](0035-ancestor-geometry-invalidation-lives-in-the-database.md) put a rule
every writer of `regions.geom` must follow into a trigger, because a rule each writer has to
remember is one some writer forgets.

## Decision

1. **Leaves first; the other regions only for what no leaf holds.** A point is tested against
   the leaf regions, every ancestor's row comes from the tree as before, and the non-leaf
   regions are tested only for the points no leaf holds. A non-leaf gets a direct row only for
   such a point. On the development catalogue that changes nine rows and nothing else: the
   eight Vatican points are no longer in Italy — correct on the ground, since St Peter's is not
   in Italy — and Segment Rumichaca is no longer in Colombia, a border point whose side the
   outlines cannot settle.
2. **A leaf is tested through its geometry cut into pieces, kept by the database.**
   `region_geom_pieces` holds each leaf's geometry cut by `ST_Subdivide` into pieces of at
   most 256 vertices, indexed piece by piece. A trigger on every write of `regions.geom`
   replaces a region's pieces with the cut of its current geometry, through one function,
   `cut_region_geom_pieces()`, which reads the row as it stands. It does not fire on a change
   of `is_leaf`: a region's pieces are always those of its current geometry, and a leaf without
   pieces is tested whole — still ahead of the non-leaves, so a point it holds gets no row in a
   non-leaf whose outline also covers it. Missing pieces cost time and never change a row. The pieces exist to test containment and are never drawn; ADR-0031's
   decision about tiles stands as it is.
3. **The copy fails open.** A cut that fails leaves the region without pieces and raises a
   warning, rather than failing the geometry write it rides on.
4. **One statement for both ways in.** The direct step is built once (`directPlacementSql`),
   and a run's placement and a world view's rebuild differ only in which points they name.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Leaves first, tested against whole geometries | Measured by #851 at 11.5 s for the 1078 points, where the pieces take a fraction of a second: a leaf is still read whole for every point in its box, and the Far Eastern Federal District alone is 774 745 vertices |
| Cut every region, non-leaves included, and keep today's semantics exactly | Keeps St Peter's in Italy, which is the placement misdescribing the ground, and puts the cut of every continent on every write of its union — Asia's 7.1 million vertices, on the order of a hundred seconds at the rate measured for leaves — for a pass that reaches a few hundred points. The second pass tests those points against whole non-leaves, found through the regions' index and tested region by region, where one prepared geometry serves every test |
| A materialized view of the pieces, or a cut per run | A view lags the geometry until someone refreshes it, and a stale piece places a point wrongly rather than slowly. A cut per run is the 11.5 minutes the issue measured for the leaves, on every run |
| Refresh the pieces at each writer, in TypeScript | ADR-0035's reasoning: a migration, a `psql` session or a writer added later bypasses it |
| Refresh the pieces on a change of `is_leaf` too | Every structural edit that leaves a parent childless — deleting or moving its last child, pruning an import tree — makes it a leaf, and the handler then nulls its geometry for recompute. Cutting the old outline in between is up to a minute of work inside a request, thrown away by the next statement. A leaf without pieces is tested whole, so waiting for its next geometry write costs time and never a row |
| Fail the geometry write when the cut fails | Would block a curator's save for the sake of a copy that makes placement fast, not right |

## Consequences

**Positive:**

- Placing a run's moved objects no longer holds the run open for minutes: 3.4 s for the 1078
  worship points, and 7.3 s for re-placing the whole world view's 7844 points, against 25 minutes
  for the first and, at the 2.2 s a point the previous statement took, nearly five hours for the
  second. One object inside a leaf is placed in under a millisecond (measured on the development
  catalogue on 2026-09-10; `docs/tech/experiences.md` § Region assignment has the table).
- A run's placement and a world view's rebuild cannot drift apart: they are one statement.
- A place is listed under the smallest region that holds it and the regions above it, so a
  non-leaf's outline drawn around an enclave no longer puts the enclave's places in it.

**Negative / Trade-offs:**

- A write of a leaf's geometry pays for its cut inside the writing statement: about 0.3 s for
  an ordinary leaf; 56 s for Scotland, the largest at 1 575 052 vertices, whose write took
  98.5 s before it — inside the 300 s bound the compute paths set, with less to spare. A compute
  of every leaf of a world view pays it once per leaf, 11.5 minutes for the mirror's 3594.
- A non-leaf's outline no longer places a point a leaf holds. That is right for a world view
  whose regions nest; a world view whose non-leaf regions overlap subtrees that are not their
  own would lose those rows, and would need this decision revisited. No such world view has
  geometry today.
- A point on a border is placed by the outline that holds it, and where two levels of GADM
  disagree by metres that can be the wrong country — Segment Rumichaca is now in Ecuador only.
  Which country a component belongs to is a question about the source's data, not about
  geometry (#264).
- One more table the schema has to keep. Migration 054 must run before the backend that reads
  it, and a database that re-applied `01-schema.sql` without running 054 places correctly and
  slowly with nothing on screen to say why.
- The trigger is invisible from the TypeScript that relies on it, and the mocked `pg` lane cannot
  see it: `backend/src/db/regionGeomPieces.test.ts` guards its terms as text, and its behaviour
  was verified by hand against the development database in rolled-back transactions (#522).
- The pieces meet their leaf to floating-point noise along the cuts rather than bit for bit. A
  point that falls on a cut is asked of the whole leaf, and the rows placed through the pieces
  were compared with the rows the whole geometries place, on every offered point.

## References

- Related ADRs: [ADR-0031](0031-a-display-rung-drops-what-a-reader-cannot-see.md) (subdivided
  geometry for tiles, turned down and untouched here),
  [ADR-0035](0035-ancestor-geometry-invalidation-lives-in-the-database.md) (a derived obligation
  kept by a trigger)
- Related docs: `docs/tech/experiences.md` § Region assignment, `docs/tech/geometry-columns.md`
  § `region_geom_pieces` table, `db/migrations/README.md`
- PR / issue: #851, following #753 (sync log 105); #264, #469, #850
