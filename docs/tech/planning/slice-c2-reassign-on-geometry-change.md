# Slice C2 — reassign when region geometry changes

**Status:** design proposed 2026-08-04, not approved. Local working document, never committed.

**Goal:** editing a region's boundary should fix that region's experience assignments by
itself, so the manual full rebuild has no remaining job and can be removed.

## Where this comes from

Slice C made a sync place what moved, and the manual rebuild kept exactly one purpose: region
*geometry* changed, so locations have to be tested against the new boundary. Until that is
automatic, an edited region silently keeps the experiences it had — the assignment rows are
still there and nothing recomputes them.

## The two shapes that do not work, and why

**Call the assignment from each geometry write.** Geometry is written from six places —
`geometryCompute`, `geometryComputeSingle`, `geometryComputeSSE`,
`computeSingleMemberFastPath`, and the import tree operations. Wiring a call into each is the
"fixed one copy of four" failure this codebase has produced repeatedly; a missed site leaves
a region wrong with nothing to notice it.

**A queue table drained by a worker.** The application has no job runner. Long work is a
fire-and-forget promise with an in-memory progress map (`runningSyncs`), and the only timers
are housekeeping `setInterval`s in `index.ts` and the auth service. Introducing a worker is a
new architectural pattern and would need an ADR of its own — a large answer to a small
question.

## Corrected after mapping the write sites (2026-08-04)

Two findings overturn the shape proposed below; it is kept for the reasoning, not the plan.

**"Curated" exists and is not `is_public`.** `world_views.source_type` gains a `_done` suffix
at `POST /wv-import/matches/:id/finalize`, and only once no region is left needing review.
It is independent of visibility — the finalize handler's own docstring says the world view
"remains editable from the WorldView Editor", and `is_public` is a manual toggle with no
relation to import state. Neither flag alone answers "should assignments be maintained here".

**A visitor can write geometry, so no request is a safe place to drain.**
`getRootRegionGeometries` and `getSubregionGeometries` back-fill `regions.geom` during a
public read, fire-and-forget with `.catch(() => {})`. And sixteen admin actions do not write
geometry at all — they *null* it through `invalidateRegionGeometry`, leaving it to be
re-materialized later, possibly by one of those visitor reads. The moment geometry changes is
decoupled from the admin action by design.

So the drainer must be **periodic**. The claim below that this would be a new pattern needing
an ADR was wrong: `setInterval` housekeeping already runs in `index.ts:142` and
`authService.ts:72`. Coalescing in the queue table also settles the bulk-import worry — a
thousand-region recompute drains as one pass.

## Superseded: a trigger records, the same request drains

A fifth trigger on `regions`, beside the four it already has (two of which fire on geometry
change), writes the region id to a small table when `geom` actually changes. The trigger is
what makes this complete: it does not care which of the six sites did the write, so no site
can be forgotten.

Draining happens synchronously at the end of the operation that caused it, before the
response. No new runner, no new pattern. A write from outside a request — a migration, a psql
session — leaves rows in the table that the next operation drains; degraded, but never wrong.

### What has to be recomputed for a changed region R

Two sets, both computable at drain time from current state, which is why the trigger needs to
store nothing but the region id:

- experiences **currently assigned** to R — they may have to lose it;
- experiences whose location now falls **inside R's geometry** — they may have to gain it.

Their union goes to `assignRegionsForExperiences` from slice C, which already recomputes an
experience wholly and correctly, including ancestor propagation and the experience-level
denormalisation. Nothing new has to be written to do the work itself.

The old geometry never has to be captured. That is the point of taking the union above:
"used to be in R" is answered by the assignment rows that still exist, not by the geometry
that is gone.

### Sketch

```sql
CREATE TABLE region_geometry_changes (
    region_id  INTEGER PRIMARY KEY REFERENCES regions(id) ON DELETE CASCADE,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION note_region_geometry_change() RETURNS TRIGGER AS $$
BEGIN
    -- Only a real change. Recomputing geometry to the same value is common in
    -- the world-view editor and must not queue work.
    IF NEW.geom IS DISTINCT FROM OLD.geom THEN
        INSERT INTO region_geometry_changes (region_id) VALUES (NEW.id)
        ON CONFLICT (region_id) DO UPDATE SET changed_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Primary key on `region_id`, so a region edited fifty times in a session is one row of work.

## What must be settled before implementing

- **Where "the end of the operation" is** for each of the six writers. The trigger makes the
  *recording* complete; the draining still has to be called somewhere, and the honest answer
  may be that a few of the six need it rather than all.
- **Cost on a bulk import.** Recomputing a world view's geometry touches thousands of regions
  at once. Draining that synchronously would make the import wait for a near-full
  reassignment — worse than what it replaces. Likely rule: drain synchronously below a
  threshold, and above it tell the operator to run the full rebuild, which is the tool that
  fits that shape.
- Whether the manual rebuild can then be **removed** or only demoted. Removing it is the goal;
  the bulk case above may be the reason to keep it.

## Verification

- editing a region's boundary so it swallows a neighbouring point assigns that experience to
  it, with no admin action;
- shrinking a region so a point falls outside removes that experience from it **and** from the
  experience-level row, if no other location of that experience is inside;
- a geometry recompute that produces an identical polygon queues nothing;
- ancestors follow in both directions.
