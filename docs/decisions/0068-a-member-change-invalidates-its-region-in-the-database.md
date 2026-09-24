# ADR-0068: A member change invalidates its region in the database

**Date:** 2026-09-25
**Status:** Accepted
**Issue:** [#718](https://github.com/uncovering-world/track-your-regions/issues/718), [#1026](https://github.com/uncovering-world/track-your-regions/issues/1026)
**Narrows:** [ADR-0035](0035-ancestor-geometry-invalidation-lives-in-the-database.md)

---

## Context

A region's outline is the union of its children and of its own member divisions, so changing
what a region holds makes its stored `geom` stale, exactly as moving a child does. ADR-0035 put
the *upward* half of that rule in the database: a write to `regions.geom` clears the derived
parent, and the cascade reaches the root. It left the region's *own* clearing to TypeScript,
because a member change writes no geometry for a trigger on `regions` to see.
`invalidateRegionGeometry()` is what a member writer was to call.

The World View Editor's member paths called it. A dozen import-review writers did not (#718):
- accepting and rejecting a match;
- clearing members, resetting a match, collapsing to a parent;
- syncing instances, handling a region as a grouping, auto-resolving children;
- three undo arms, resolving an overlap, a coverage assignment, re-matching a world view;
- the geoshape cache.

Each rewrote `region_members` and named no region. A region computed mid-review then kept an
outline it no longer held. Nothing below it was `NULL`, so no ordinary run selected it again,
and every run reported Complete. This is the failure ADR-0035 moved the upward rule into the
database to end, and it came back through the half left in TypeScript.

The calls that were made had a problem of their own (#1026). The import review's tree
operations cleared after `COMMIT`, so a failed clearing answered 500 for an edit that had
committed.

## Decision

**1. A write to `region_members` clears its region's geometry, in the same statement.**
`invalidate_member_regions_geometry()` runs from three statement-level triggers, one per
event, each with transition tables:
- **INSERT** clears the regions the new rows name.
- **DELETE** clears the regions the removed rows named.
- **UPDATE** clears both the old and the new region of a row whose `region_id`, `division_id`
  or `custom_geom` changed. A renamed part (`custom_name`) draws the same outline, so it clears
  nothing.

A hand-drawn region is skipped: its shape is drawn, not derived. A region with no geometry
has nothing to clear. Clearing a region is a write to `regions.geom`, so ADR-0035's trigger
carries the change to the ancestors.

Statement-level rather than per row, so a bulk write clears each touched region once. An
import's match or a re-match of a world view writes thousands of rows. There are three
triggers because PostgreSQL gives a transition-table trigger one event and no column list.

**2. `invalidateRegionGeometry()` is for structural changes only.** A region changing parents,
or a branch deleted, writes neither a member nor a geometry while changing a parent's union, so
its writer still names that parent: `updateRegion`, `deleteRegion`, `flattenSubregion`, placing
a division's GADM children in new subregions (a new region has no outline for the trigger to
carry upward), and the import review's reparent, merge, remove, dismiss, prune and smart
flatten. Every call after a pure member write is deleted. The trigger makes it redundant, and
keeping it would be the second spelling of a rule that now has one owner.

**3. A structural clearing runs in the writer's transaction when there is one.**
`invalidateRegionGeometry(regionId, db)` takes the transaction's client. The import review's
tree operations call it before `COMMIT`. A failure then rolls the operation back, so the
handler answers an error for an operation that did not happen rather than one that did. Inside a
transaction a lock error is not swallowed, since it has already aborted the transaction. On the
pool, a writer with no transaction, the #283 tolerance stands.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Add the call to each of the dozen writers (#718's first proposal) | It fixes today's writers and leaves the next one to remember, which is how the dozen came about. ADR-0035 already chose the database for the half of this rule that had the same shape |
| A row-level trigger | A match of a large world view writes thousands of member rows, and a row trigger would issue one `UPDATE regions` per row where one per statement does |
| One trigger for all three events | A trigger with transition tables takes one event, and an UPDATE trigger with transition tables takes no column list. Three triggers on one function is the smallest legal shape |
| Clearing on every UPDATE, whatever column | A rename would clear a region and, through the cascade, its continent. That is about a hundred seconds of recompute for no change of shape |

## Consequences

**Positive:**

- No member writer can leave a stale outline, including writers that do not exist yet. The
  dozen import-review writers are covered without a line each.
- The TypeScript calls after pure member writes are gone, along with a post-commit block whose
  failure the transfer had to swallow.
- The tree operations' clearing commits or rolls back with the edit (#1026).

**Negative / Trade-offs:**

- **A member write now costs an `UPDATE regions` per touched region** that has geometry. While
  a tree has no geometry, as in an import before its first compute, the `geom IS NOT NULL`
  filter makes it match nothing.
- **A member write under a continent clears the continent.** That is the rule, and it now
  holds for every writer rather than for the ones that remembered it. A curator working in a
  computed tree will see the map redraw after the next run, as the editor's member paths
  always did.
- **A member write holds its regions' row locks until it commits.** The clearing and the
  cascade above it lock the region and every ancestor that still has geometry, for the rest of
  the writer's transaction. Before, the clearing was a short statement of its own after the
  commit, and on the pool a lock or deadlock was swallowed (#283). Now two member transactions
  can deadlock when they touch the same ancestors in opposite order, such as a transfer from
  Europe to Asia and one from Asia to Europe. PostgreSQL rolls one of them back, and it answers
  an error the curator can retry. A member write also waits behind a run that is writing one of
  those regions' geometry, and clears the outline that run has just stored.
