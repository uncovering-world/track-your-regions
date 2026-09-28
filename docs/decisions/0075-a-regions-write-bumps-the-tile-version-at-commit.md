# ADR-0075: A write to regions bumps its world view's tile version, at commit

**Date:** 2026-09-28
**Status:** Accepted
**Issue:** [#688](https://github.com/uncovering-world/track-your-regions/issues/688), the first slice of [#1073](https://github.com/uncovering-world/track-your-regions/issues/1073)

---

## Context

Martin caches a tile by its URL. The web puts `world_views.tile_version` on every tile URL as `_v`, and nothing else in that URL changes when the geometry underneath does. A write that changes what a tile draws and leaves the version alone keeps the old tile in Martin's cache, served at cache speed to every reader until something else bumps.

On `main` @ 62bd2c0cd, 40 statements in 16 modules wrote `regions`. Three of them bumped the version:
- `updateRegion`, on a `uses_hull` flip;
- the single-region compute stream;
- the batch compute's finalize.

The rest did not, though each changes a tile: a drawn boundary, a reset, a hull save, a create, a delete, a reparent, and a rename in the editor or in the import review. The tile functions read these region columns:
- `name`, `color`, `parent_region_id`, `world_view_id`, `uses_hull`, `is_leaf`;
- every geometry rung;
- whether the region has a child.

ADR-0035 and ADR-0068 met the same shape for geometry invalidation: a rule every writer had to remember, and writers that did not. They moved it into triggers.

## Decision

1. **The table bumps the version.** Three deferred constraint triggers on `regions` call `bump_region_tile_version()`:
   - on INSERT and DELETE;
   - on UPDATE OF any geometry column. A statement that sets one is taken to change it, since comparing would detoast both values, and a root region's outline runs to tens of megabytes;
   - on UPDATE OF a drawn attribute (`name`, `color`, `parent_region_id`, `world_view_id`, `uses_hull`, `is_leaf`), when OLD and NEW differ. So a form saved unchanged, or a find-or-create that lands on its conflict arm, busts no URL.
2. **Once per transaction per world view, at commit.**
   - The triggers are `DEFERRABLE INITIALLY DEFERRED`, so the `world_views` row is locked last and held only until the commit. Were the bump made mid-transaction, a transaction holding the world view's row while it waits for a region another transaction holds could deadlock with that transaction's own bump.
   - The function keeps the world views it has already bumped in a transaction-local setting (`tyr.tile_version_bumped`). A batch compute that writes thousands of rows in one transaction bumps once, and a move between world views bumps both.
3. **No writer bumps by hand.** The three bumps in TypeScript are deleted, and so are the two answer fields that carried their result: `tileVersion` on a region edit and on a finished computation, which no client read.
4. **The editor re-reads the version when it closes.** `invalidateTileCache()` (`useNavigation.tsx`) takes the world view's version from a fresh read of the list. The old `+1` on the version read at load could name a version the database had already given to an earlier write, whose tiles another reader may have put in Martin's cache before the later edits.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A bump in each writer, or in a writer module | An audit found 40 writing statements, and three code paths that bumped. A list that has to be complete is the failure ADR-0035 recorded for #679: its call "had one caller" and had eight. |
| A statement-level trigger with transition tables | It fires once per statement, not per transaction. It cannot take a column list, so it runs on every UPDATE, and telling a geometry change apart would compare geometries row by row. |
| An immediate row-level trigger | It takes the `world_views` row lock at the first write, mid-transaction, which is the deadlock above. |
| A version derived from the regions, such as a maximum stamp over them | A delete removes the row that held the stamp, so the maximum can go back to a value whose tiles are already cached. |

## Consequences

**Positive:**
- Every write that changes a tile changes its URL, including writes nobody has written yet.
- Readers other than the acting admin see an edit at their next read of the world view, instead of whenever a compute next ran.

**Negative / Trade-offs:**
- A statement that sets a geometry column to its own value bumps. The focus refresh (`hull_geom = hull_geom`) and an invalidation of an already-cleared outline do, once per statement.
- A batch compute that commits region by region bumps once per region, so a reader who loads the world view during a run fetches fresh tiles. That is correct, since the geometry is changing, but it costs Martin more cache misses than one bump at the end did.
- Every transaction that writes a region also updates its world view's row at commit, as dead tuples of one small row.

## References

- Related ADRs:
  - ADR-0035: the parent's derived outline is cleared by a trigger;
  - ADR-0068: a member change clears its region by a trigger;
  - ADR-0069: the closed list of writers that the next slice of #1073 applies to `regions`.
- Related docs: `docs/tech/geometry-columns.md` § Tile cache busting.
- Issues: #688, #1073, #679.
