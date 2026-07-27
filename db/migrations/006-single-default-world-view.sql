-- Migration 006: Remove duplicate default world views and add the unique index
--
-- One-shot cleanup for databases that already carry more than one row with
-- is_default = true, produced by a since-fixed non-idempotent seed in
-- db/init/01-schema.sql (#434). That seed was guarded by a bare
-- `ON CONFLICT DO NOTHING`, but world_views had no unique constraint besides
-- its serial primary key, so the guard had nothing to fire on and every
-- re-application of the schema file inserted another "GADM (Default)" row.
-- Idempotent: re-running on a clean DB is a no-op.
--
-- Strategy: keep the lowest-id default row — the one the database has used
-- since it was created — and delete the later copies. The partial unique index
-- then makes the duplicate state unreachable, and is what the repaired seed's
-- `ON CONFLICT (is_default) WHERE is_default` infers as its arbiter.
--
-- SAFETY: on the known dev installation the duplicate was completely orphaned
-- (no regions, no import runs). On another database the duplicate could have
-- been picked in the World View selector and had regions created under it, and
-- both FKs are ON DELETE CASCADE, so the pre-flight DO block aborts the whole
-- transaction instead of cascading real data away. The operator then decides
-- per row — re-point the regions to the kept world view, or clear is_default on
-- the row worth keeping as a custom world view — and re-runs. region_render_geom
-- needs no check: it is a VIEW over regions, not a table.
--
-- Wrapped in BEGIN/COMMIT so the pre-flight, DELETE and CREATE INDEX succeed or
-- fail together. Plain `CREATE INDEX` (not CONCURRENTLY) is transactional in
-- PostgreSQL.
--
-- Order: apply this to an existing database BEFORE re-applying 01-schema.sql to
-- it. Both statements in that file depend on this one having run: the index
-- creation fails while duplicates remain, and the seed's ON CONFLICT inference
-- fails while the index is missing.

-- psql exits 0 on a failed statement unless this is set, which would report the
-- pre-flight abort below as a success to whatever ran the file. Set here rather
-- than left to the caller: the safety design of this migration is worth nothing
-- if the abort is silent.
\set ON_ERROR_STOP on

BEGIN;

-- Block concurrent writers on world_views for the duration of the migration so
-- the pre-flight check can't be invalidated before the DELETE. EXCLUSIVE does
-- not conflict with ACCESS SHARE, so plain SELECTs still go through. Lock is
-- released at COMMIT/ROLLBACK.
LOCK TABLE world_views IN EXCLUSIVE MODE;

-- Stage the default rows the migration would delete: every one but the oldest.
CREATE TEMP TABLE _duplicate_defaults ON COMMIT DROP AS
SELECT id FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM world_views
  WHERE is_default
) ranked WHERE rn > 1;

DO $$
DECLARE
  bad   text := '';
  n     bigint;
  total bigint := (SELECT count(*) FROM _duplicate_defaults);
BEGIN
  IF total = 0 THEN
    -- Fresh database, or already cleaned up — nothing to check.
    RETURN;
  END IF;

  -- regions.world_view_id — CASCADE would delete every region under the copy
  SELECT count(*) INTO n FROM regions
    WHERE world_view_id IN (SELECT id FROM _duplicate_defaults);
  IF n > 0 THEN bad := bad || format(E'\n  - regions: %s row(s) (CASCADE delete)', n); END IF;

  -- import_runs.world_view_id — CASCADE would delete the import history
  SELECT count(*) INTO n FROM import_runs
    WHERE world_view_id IN (SELECT id FROM _duplicate_defaults);
  IF n > 0 THEN bad := bad || format(E'\n  - import_runs: %s row(s) (CASCADE delete)', n); END IF;

  IF bad <> '' THEN
    RAISE EXCEPTION E'Migration 006 aborted: % duplicate default world view(s) have dependent data:%\nManual cleanup required: re-point the dependents to the kept (lowest-id) default world view, or clear is_default on the row you want to keep as a custom world view, then re-run.', total, bad;
  END IF;
END $$;

DELETE FROM world_views WHERE id IN (SELECT id FROM _duplicate_defaults);

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_views_single_default
  ON world_views(is_default) WHERE is_default;

COMMIT;
