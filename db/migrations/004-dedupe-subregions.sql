-- Migration 004: Dedupe sibling subregions and add a unique index
--
-- One-shot cleanup of duplicate sibling subregions left by a since-fixed
-- find-or-create race in regionMemberMutations.ts::ensureSubregion (#378).
-- Idempotent: re-running on a clean DB is a no-op.
--
-- Strategy: keep the lowest-id row per (world_view_id, parent_region_id, name)
-- tuple. Once the duplicates are gone, the partial unique index lets the new
-- ensureSubregion implementation use INSERT … ON CONFLICT DO UPDATE …
-- RETURNING id (race-resolved deterministically by Postgres) instead of the
-- transaction-scoped advisory lock that PR #377 introduced as a stopgap.
--
-- SAFETY: the audit on the known dev installation showed every duplicate is
-- completely orphaned (no region_members, no experience_regions, no children,
-- no user visits, no match suggestions — only region_import_state references,
-- which CASCADE intentionally as part of import-metadata cleanup). But this
-- migration runs on every production DB, where the historical race could have
-- produced different duplicates with real dependent data. The pre-flight DO
-- block aborts the entire transaction with a clear error message if any
-- duplicate has dependents, so an operator can re-point the data manually
-- (or audit the case) instead of silently losing memberships, visits, etc.
--
-- Wrapped in BEGIN/COMMIT so the pre-flight, DELETE, and CREATE INDEX succeed
-- or fail together. Plain `CREATE INDEX` (not CONCURRENTLY) is transactional
-- in PostgreSQL.
--
-- Deployment order: apply this migration to every running DB BEFORE deploying
-- the matching code change, since `ON CONFLICT (cols)` inference will fail
-- without the index.

BEGIN;

-- Block concurrent writers on regions for the duration of the migration so
-- the pre-flight dependent-data check can't be invalidated before the DELETE.
-- EXCLUSIVE conflicts with ROW SHARE (which is what FK validation acquires via
-- `SELECT … FOR KEY SHARE` when inserting into region_members,
-- experience_regions, etc.), but does NOT conflict with ACCESS SHARE — plain
-- SELECTs on regions still go through. Lock is released at COMMIT/ROLLBACK.
LOCK TABLE regions IN EXCLUSIVE MODE;

-- Stage the duplicate ids that the migration would delete.
CREATE TEMP TABLE _dedupe_candidates ON COMMIT DROP AS
SELECT id FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY world_view_id, parent_region_id, name
    ORDER BY id
  ) AS rn
  FROM regions
  WHERE parent_region_id IS NOT NULL
) ranked WHERE rn > 1;

-- Pre-flight: refuse to run if any candidate has dependent data in any FK
-- target other than region_import_state (which is intentionally CASCADE-safe
-- — it holds per-region import metadata that's expected to die with the row).
DO $$
DECLARE
  bad   text := '';
  n     bigint;
  total bigint := (SELECT count(*) FROM _dedupe_candidates);
BEGIN
  IF total = 0 THEN
    -- Already deduped (re-run on a clean DB) — nothing to check.
    RETURN;
  END IF;

  -- INTENTIONAL OMISSION: region_import_state.region_id is also FK ON DELETE
  -- CASCADE to regions(id), but is NOT checked here. Those rows ARE the
  -- per-duplicate import metadata that produced the dups in the first place;
  -- their CASCADE deletion is the desired outcome of this migration. Adding a
  -- check on it would block the migration from ever running on a dev DB,
  -- since every duplicate has a corresponding region_import_state row.
  -- Every OTHER FK target IS checked below.

  -- regions.parent_region_id — children would be orphaned via ON DELETE SET NULL
  SELECT count(*) INTO n FROM regions
    WHERE parent_region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - regions.parent_region_id: %s child region(s) (ON DELETE SET NULL would orphan them)', n); END IF;

  -- region_members — would CASCADE-delete division memberships
  SELECT count(*) INTO n FROM region_members
    WHERE region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - region_members: %s row(s) (CASCADE delete)', n); END IF;

  -- experience_regions
  SELECT count(*) INTO n FROM experience_regions
    WHERE region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - experience_regions: %s row(s) (CASCADE delete)', n); END IF;

  -- experience_location_regions
  SELECT count(*) INTO n FROM experience_location_regions
    WHERE region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - experience_location_regions: %s row(s) (CASCADE delete)', n); END IF;

  -- experience_rejections
  SELECT count(*) INTO n FROM experience_rejections
    WHERE region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - experience_rejections: %s row(s) (CASCADE delete)', n); END IF;

  -- experience_curation_log
  SELECT count(*) INTO n FROM experience_curation_log
    WHERE region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - experience_curation_log: %s row(s) (ON DELETE SET NULL would orphan audit entries)', n); END IF;

  -- user_visited_regions
  SELECT count(*) INTO n FROM user_visited_regions
    WHERE region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - user_visited_regions: %s row(s) (CASCADE delete — loses user visit history)', n); END IF;

  -- region_match_suggestions (both columns)
  SELECT count(*) INTO n FROM region_match_suggestions
    WHERE region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - region_match_suggestions.region_id: %s row(s) (CASCADE delete)', n); END IF;
  SELECT count(*) INTO n FROM region_match_suggestions
    WHERE donor_region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - region_match_suggestions.donor_region_id: %s row(s) (ON DELETE SET NULL)', n); END IF;

  -- curator_assignments
  SELECT count(*) INTO n FROM curator_assignments
    WHERE region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - curator_assignments: %s row(s) (CASCADE delete)', n); END IF;

  -- region_map_images
  SELECT count(*) INTO n FROM region_map_images
    WHERE region_id IN (SELECT id FROM _dedupe_candidates);
  IF n > 0 THEN bad := bad || format(E'\n  - region_map_images: %s row(s) (CASCADE delete — loses cached images)', n); END IF;

  -- (region_import_state intentionally omitted — see top of block.)

  IF bad <> '' THEN
    RAISE EXCEPTION E'Migration 004 aborted: % duplicate sibling subregion row(s) have dependent data:%\nManual cleanup required: re-point dependents to the kept (lowest-id) row per (world_view_id, parent_region_id, name) tuple, then re-run.', total, bad;
  END IF;
END $$;

DELETE FROM regions WHERE id IN (SELECT id FROM _dedupe_candidates);

CREATE UNIQUE INDEX IF NOT EXISTS idx_regions_unique_subregion_name
  ON regions(world_view_id, parent_region_id, name)
  WHERE parent_region_id IS NOT NULL;

COMMIT;
