-- 067-a-run-log-names-what-it-has-not-placed.sql
--
-- A sync run names on its own log row the objects whose points it moved and
-- has not yet placed in their regions (#1152). Placement runs after the row
-- closes, so a restart during it left the run reading success while the
-- objects it moved were in no region, and a re-run did not place them either:
-- their points no longer moved. The progress writer keeps this list as the
-- run goes, a placement that succeeds empties it, the next real run of the
-- source takes over what an earlier one left, and the startup sweep marks a
-- run whose list outlived it partial.
-- Re-runnable: ADD COLUMN IF NOT EXISTS; the default is set separately so the
-- rows from before keep NULL, which says the run predates the list rather
-- than that it placed everything.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS unplaced_experience_ids INTEGER[];
ALTER TABLE experience_sync_logs ALTER COLUMN unplaced_experience_ids SET DEFAULT '{}';

COMMENT ON COLUMN experience_sync_logs.unplaced_experience_ids IS 'The objects whose points this run moved and that are not yet placed in their regions (#1152). Written with the run''s progress, emptied when placement succeeds, taken over by the source''s next real run, and read by the startup sweep, which marks a closed run still naming any partial. Empty on a preview, which moves nothing; NULL on runs from before the column.';

COMMIT;
