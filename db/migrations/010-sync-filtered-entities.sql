-- 010: tell filtered entities apart from failures (issue #480)
--
-- The museum sync answers an artwork query with whatever Wikidata returns for
-- `wdt:P195`, which includes collections as entities — the Royal Collection,
-- Collection Crozat — alongside museums. Those have no physical address, so the
-- coordinate check drops them, correctly. But the drop was recorded in
-- `error_details`, which made every museum run `partial` with eight failures
-- nobody could ever fix, and would have blocked missing detection outright on
-- an authoritative source.
--
-- Filtering is not failing. This adds a counter for it and a changeset type, so
-- the run stays successful and the entities remain visible.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/010-sync-filtered-entities.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS total_filtered INTEGER DEFAULT 0;

ALTER TABLE experience_sync_changes DROP CONSTRAINT IF EXISTS experience_sync_changes_change_type_check;
ALTER TABLE experience_sync_changes ADD CONSTRAINT experience_sync_changes_change_type_check
    CHECK (change_type IN ('created', 'updated', 'conflict', 'missing', 'returned', 'failed', 'filtered'));

COMMIT;
