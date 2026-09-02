-- 041: A work's link is marked, not deleted, behind a coverage floor (#588, ADR-0044)
--
-- Nothing has ever unlinked a work from a museum. `upsertMuseumTreasures` links
-- with ON CONFLICT DO NOTHING and stops there, by decision (ADR-0023, ADR-0026
-- decision 5): museum run 42 fetched 291 artworks where run 3 had fetched 1906
-- and reported success, and a run like it that also unlinked would have taken
-- two thirds of the catalogue's works off the walls. The guard that makes
-- withdrawal safe is a coverage floor over the works, and this migration adds
-- the two columns the floor and the withdrawal write:
--
--   1. `experience_treasures.missing_since` -- the mark on a link the source
--      stopped placing here, the same observation a point carries (ADR-0022),
--      hidden from every reader-facing read by the same predicate;
--   2. `experience_sync_logs.withdrawal_skipped_reason` -- why a run marked
--      nothing, when the floor refused it. A run carrying one is `partial`.
--
-- One file for both because they are one decision: a mark is only safe once a
-- run has shown it saw the works it holds, and a refusal that lands nowhere a
-- person reads is a run that "found nothing to withdraw".
--
-- No backfill. Every link stored today is one some run placed and no run has
-- since contradicted, which is exactly what NULL means. Re-running is a no-op.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;
COMMENT ON COLUMN experience_treasures.missing_since IS 'When a run first placed this work somewhere other than here, or nowhere, having seen enough of the works its museums hold to be believed (the coverage floor, ADR-0044). A machine observation, not a verdict. NULL = the source still places the work here; every reader-facing read of a museum''s works carries missing_since IS NULL. A run that places the work here again clears it.';

-- Every reader-facing read of a museum's works carries `missing_since IS NULL`,
-- and the withdrawal arm asks it per museum on every run. Partial, like the
-- points' index, because no read ever asks for the marked rows alone.
CREATE INDEX IF NOT EXISTS idx_experience_treasures_offered
    ON experience_treasures(experience_id) WHERE missing_since IS NULL;

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS withdrawal_skipped_reason TEXT;
COMMENT ON COLUMN experience_sync_logs.withdrawal_skipped_reason IS 'Why this run marked none of the works its museums stopped holding: works coverage below the floor (ADR-0044). Every value worksCoverageSkipReason() produces lands here, and a run carrying one is partial, never success. NULL where withdrawals were applied, and on every run of a source whose contents need no floor: points are paired per object, not measured per pool.';

COMMIT;
