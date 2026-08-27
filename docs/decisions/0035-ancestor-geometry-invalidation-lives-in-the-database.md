# ADR-0035: Ancestor geometry invalidation lives in the database

**Date:** 2026-08-27
**Status:** Accepted

---

## Context

A region's geometry is the union of its children and of its own member
divisions. A write to `regions.geom` therefore leaves every derived ancestor
covering a smaller world than it contains, and the ancestor has to be marked
stale so the next world-view run recomputes it bottom-up.

[#667](https://github.com/uncovering-world/track-your-regions/issues/667)
established that rule after four of the eight top-level regions of the
Administrative world view were found holding a fraction of what they contain —
North America drawing Mexico and the Caribbean, 18.3 % of the countries under
it, because the import attached the members of countries split across continents
three days after the continents were computed.

Missing the rule at one writer is not a delay, it is permanent. A world-view run
selects a closure — every derived region with no geometry, and every derived
ancestor of one — and evaluates it once per run. A write that does not
invalidate consumes the `NULL` that closure seeds on, so a parent whose own
union then fails keeps its stale outline with nothing `NULL` beneath it, is
never selected again, and every run reports Complete. Only a forced run recovers
it.

#667's fix put an `invalidateAncestorGeometry()` call at each writer. The review
of its PR (#679) found **seven writers beyond the one the issue described**, one
round at a time, including `createRegion` with a drawn shape, which turned out
to be the live path of the last three. Two further problems came out of the same
review:

- the invalidation is a **second statement**, made after the write has
  committed, so it can fail on its own — a deadlock leaves the ancestors stale
  for good. Raising makes the failure visible without making it recover, and
  `createRegion` could not even raise: an `INSERT` is not idempotent, so a 500
  after the row had committed would skip the client's follow-up and make a retry
  create a second region;
- `getSubregionGeometries` writes `regions.geom` as a side effect of a public
  `GET`. Adding the call there would let an anonymous read blank a continent for
  every visitor.

The database already maintains derived state on `regions.geom` through triggers
(`update_region_metadata()`, `update_region_focus_data()`), and `trg_update_is_leaf`
is already a trigger on `regions` that writes *another row*.

## Decision

Ancestor invalidation is enforced by a trigger on `regions.geom`.
`invalidate_parent_region_geometry()` nulls the immediate derived parent's four
cached geometry columns; the walk upward is the trigger cascade, since nulling
the parent is itself a write to `regions.geom`. Two arms call it:
`AFTER UPDATE OF geom ... WHEN (OLD.geom IS DISTINCT FROM NEW.geom)` and
`AFTER INSERT ... WHEN (NEW.geom IS NOT NULL)`.

No TypeScript marks ancestors stale after a *geometry write* any more.
`invalidateAncestorGeometry()` is deleted with its eight call sites;
`invalidateRegionGeometry()` — what a member or structure edit calls — becomes a
single-row statement that nulls that region's own geometry and lets the trigger
carry the news up.

**A structural change stays TypeScript's**, because it writes no geometry for a
trigger on `regions.geom` to see while changing what two unions hold. A
reparent names the moved region and both parents; a delete names the departed
region's parent. This decision does not close that door, and does not claim to:
the import-review tree operations do not invalidate at all today — among them
`reparentRegion`, `mergeChildIntoParent`, `removeRegionFromImport`,
`dismissChildren` and `pruneToLeaves` — which is #496.

A read path does not write `regions.geom`. The fire-and-forget caches in
`getSubregionGeometries` and `getRootRegionGeometries` are removed rather than
made to invalidate.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the rule in TypeScript, reduced to one chokepoint every writer must call, plus a test that fails when a new writer appears (the shape of `regionFocusAntimeridian.test.ts`) | Cheaper, no schema change, no migration, and testable in the mocked lane — but it can only bind TypeScript. A migration, a `psql` session or a future service writing the column bypasses it, and the invalidation stays a second statement that can fail after the write has committed. It also leaves the public-`GET` writer needing a decision of its own rather than being covered by construction. Explicitly named as an acceptable outcome by #680; taken as the fallback if the trigger had proved unworkable |
| A trigger that walks the whole chain in a recursive CTE, rather than one level with a cascade | Duplicates the walk the cascade performs for free, and does not terminate on a cycle in `parent_region_id`. The one-level form stops on its own at an ancestor that is already `NULL` |
| Recompute the ancestor rather than null it | Recomputing Asia is around a hundred seconds of union, and four continent-scale unions currently exceed the 300 s `statement_timeout` (#459). A curator computing one Russian oblast would wait for it. A nulled continent is absent from the map until the next run and Catalogue Checks reports it meanwhile: loud and absent beats quiet and wrong |
| Keep the public reads' cache writes and let them invalidate | One anonymous request would take a continent off the map for every visitor. What they cached was a bare union with none of the pipeline's work, and storing it took the region out of the run's closure — the defect stands with or without the trigger |

## Consequences

**Positive:**

- No writer can bypass the rule, including writers that do not exist yet and
  writers that are not TypeScript. The count of writers stops being something
  anyone has to keep correct.
- The invalidation runs inside the writing statement, so it cannot fail
  separately from the write. `AncestorInvalidationFailed`, the rethrow that
  carried it, and `createRegion`'s documented inability to rethrow all disappear.
- Eight call sites and their eight explanations of one rule are gone. A writer
  writes.
- Two public `GET`s stop writing to the database.

**Negative / Trade-offs:**

- The rule is invisible from the TypeScript that depends on it. Mitigated by
  `backend/src/db/regionAncestorInvalidation.test.ts`, which guards that the
  terms are in the schema, that migration `036` says the same thing, that no
  TypeScript nulls a geometry along a walk of `parent_region_id`, that no read
  path writes one, and that no bulk load disables the trigger.
- The mocked `pg` lane cannot see a trigger, so the behaviour is verified by a
  probe run by hand against the dev database in a rolled-back transaction rather
  than by CI. That gap is #522, not this decision's to close.
- Existing databases need migration `036` applied by hand, and nothing records
  which migrations a database has seen (#435).
- A write to `regions.geom` now costs 0.53 ms more — 6.1 % of a write measured
  at 8.7 ms, across 400 real regions of the Administrative world view. About two
  seconds over a run that writes all 3 831 of them, against per-region unions
  measured in seconds and minutes.

## References

- Related ADRs: [ADR-0004](0004-drizzle-orm-plus-raw-pool-for-postgis.md) (raw
  `pool` for PostGIS); the precedent for keeping a geometry rule in SQL where the
  geometry is, rather than in each reader, is `geometry_focus()` (#674) —
  described in `docs/tech/geometry-columns.md`
- Related docs: `docs/tech/geometry-columns.md` § Region creation workflow,
  `docs/tech/data-assertions.md`
- PR / issue: #680, following #667 and PR #679
