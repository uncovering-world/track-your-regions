# Slice C — stop destroying region assignments, then assign incrementally

**Status:** design approved 2026-08-04. Local working document, never committed.

**Goal:** a sync should leave region assignments alone unless something actually moved, and
what does move should be re-assigned automatically, without a manual step and without a
window in which regions look empty.

## What is actually wrong

Not "assignment is manual". The sync **destroys** assignments and the manual step exists to
rebuild them.

`upsertSingleLocation` (`syncUtils.ts:240-248`) and UNESCO's `upsertExperienceLocations`
(`unescoSyncService.ts:396-400`) both begin with

```sql
DELETE FROM experience_locations WHERE experience_id = $1
```

and re-insert — for every object the run touches, changed or not. Measured on the live
database after the slice-5 acceptance round: **6647 of 6677 location rows were created that
day**; only 30 survived from the previous run.

`experience_location_regions.location_id` is `ON DELETE CASCADE`. So every one of those
deletes takes the location's region assignments with it. The full recompute afterwards is not
placing new objects — it is rebuilding what the run just destroyed.

Two consequences follow:

1. The cost that made assignment feel like a heavyweight step is self-inflicted.
2. `docs/tech/experiences.md:226` — "Re-assignment and sync flows only clear/recompute
   `auto`, preserving manual curation" — is **false at the location level**. The cascade does
   not read `assignment_type`, so a `manual` location→region row dies with the rest. True at
   the experience level, where `experience_regions` references `experiences` and the sync
   upserts rather than deletes. No data has been lost yet only because there are currently
   zero `manual` rows. **This doc must be corrected as part of this slice.**

## Identity: the point, not the reference

The obvious key, `(experience_id, external_ref)`, does not work. Measured: 6676 of 6677 rows
carry an `external_ref`, but **8 experiences have a duplicated one** — all transboundary
sites (`749ter-001` on W-Arly-Pendjari appears three times, with three distinct points).
UNESCO's reference identifies a *component*; a component spanning borders is listed once per
country. So the reference is not unique per location and cannot be the key.

The unique constraint that does exist, `(experience_id, ordinal)`, is positional: if the
source reorders `components_list`, ordinal 3 becomes a different place, and keeping its
assignment would be worse than rebuilding it.

**The identity that matters here is the coordinate.** If the point is unchanged its region
assignment is still correct; if it moved, the assignment has to be recomputed regardless.
That makes geometry equality both sufficient and exactly aligned with the purpose, and it
sidesteps the ambiguous reference entirely.

## The write path

Per experience, given the incoming list of points:

1. **Fast path.** If the stored point set equals the incoming point set, and names and
   references match, do nothing — no writes, no assignment work. This is the overwhelming
   majority: 1235 of 1272 UNESCO rows were unchanged in the acceptance run.
2. Otherwise, in one transaction:
   - rows whose point matches an incoming point **keep their `id`**; update `name`,
     `external_ref` and `ordinal`;
   - stored rows whose point is no longer offered are deleted (their assignments go with
     them, correctly);
   - incoming points with no match are inserted.

`ordinal` has a unique constraint per experience, so a reordering would collide mid-update.
Avoid it without a schema change: within the transaction, first set the affected experience's
ordinals to their negatives, then to their final values. Two extra statements, and only on
the path where the set actually changed.

Both write paths — `syncUtils.upsertSingleLocation` and UNESCO's multi-location variant —
get the same treatment. UNESCO is the one that matters: all 484 multi-location experiences
are its.

## Incremental assignment

Once locations are stable, the work after a run is small and known: the locations inserted or
moved in step 2. Assign those, in every world view that has geometry, at run completion.

- No delete-everything step, so no window in which a world view has no assignments.
- Runs inside the sync's completion path, so the admin has no step to remember and the nag
  banner goes away.
- Only world views with geometry: Wikivoyage (2) has none, so it is skipped rather than
  rebuilt into nothing.

The existing full recompute stays, manual, for the case that genuinely needs it: region
geometry changed, so every location must be re-tested. That is the honest division —
**incremental maintenance is automatic, full rebuild is an admin tool** — rather than
"import" versus "assignment".

## Verification

The claims above are measurements, and the implementation has to be checked the same way, not
by reading the diff:

- after a sync with no source changes, `experience_location_regions` row **ids** are
  unchanged (not merely the count — the count would match even if everything were rebuilt);
- a location whose coordinate moved loses its old assignment and gains the right new one;
- a `manual` location→region row survives a sync that does not move its point — the case the
  docs promise today and the code breaks;
- the number of unassigned experiences after a sync is zero without anyone pressing anything.
