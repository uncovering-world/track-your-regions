-- 061-run-statuses-are-checked.sql
--
-- A run's status columns take only the statuses the code writes (#794).
--
-- experience_sync_logs.status, experience_sources.last_sync_status,
-- import_runs.status and region_import_state.match_status took any text: the
-- values lived in column comments, import_runs' named a 'finalized' nothing
-- writes, and last_sync_status' left out the 'cancelled' its writers record.
-- The four CHECKs below list exactly what @tyr/shared/runStatuses declares,
-- and the generated schema types hold the package to them.
--
-- Added NOT VALID, then each validated in a transaction of its own: adding a
-- CHECK outright scans its table under ACCESS EXCLUSIVE, and in one
-- transaction a later scan would keep every earlier table locked. VALIDATE
-- CONSTRAINT takes a lock that lets reads and writes through, and a
-- transaction apiece holds it for one table's scan only. A stored row holding any other
-- value fails the validation rather than being rewritten; the development
-- catalogue on 2026-09-25 held only listed values in all four, and no NULL in
-- the three run columns (a source that has never synced has a NULL
-- last_sync_status, which the CHECK allows).
-- Re-runnable: each constraint is dropped if present and added again.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_logs DROP CONSTRAINT IF EXISTS experience_sync_logs_status_check;
ALTER TABLE experience_sync_logs ADD CONSTRAINT experience_sync_logs_status_check
  CHECK (status IN ('running', 'success', 'partial', 'failed', 'cancelled')) NOT VALID;

ALTER TABLE experience_sources DROP CONSTRAINT IF EXISTS experience_sources_last_sync_status_check;
ALTER TABLE experience_sources ADD CONSTRAINT experience_sources_last_sync_status_check
  CHECK (last_sync_status IN ('success', 'partial', 'failed', 'cancelled')) NOT VALID;

ALTER TABLE import_runs DROP CONSTRAINT IF EXISTS import_runs_status_check;
ALTER TABLE import_runs ADD CONSTRAINT import_runs_status_check
  CHECK (status IN ('running', 'matching', 'reviewing', 'failed')) NOT VALID;

ALTER TABLE region_import_state DROP CONSTRAINT IF EXISTS region_import_state_match_status_check;
ALTER TABLE region_import_state ADD CONSTRAINT region_import_state_match_status_check
  CHECK (match_status IN ('no_candidates', 'needs_review', 'auto_matched', 'manual_matched', 'children_matched', 'suggested')) NOT VALID;

COMMENT ON COLUMN experience_sync_logs.status IS 'Sync status: running, then success, partial, failed or cancelled (CHECK; @tyr/shared/runStatuses)';
COMMENT ON COLUMN experience_sources.last_sync_status IS 'How the source''s last sync ended: success, partial, failed or cancelled (CHECK; @tyr/shared/runStatuses)';
COMMENT ON COLUMN import_runs.status IS 'Import run status: running, matching, reviewing, failed (CHECK; @tyr/shared/runStatuses)';
COMMENT ON COLUMN region_import_state.match_status IS 'Match lifecycle: no_candidates, needs_review, auto_matched, manual_matched, children_matched, suggested (CHECK; @tyr/shared/runStatuses)';

COMMIT;

BEGIN;
ALTER TABLE experience_sync_logs VALIDATE CONSTRAINT experience_sync_logs_status_check;
COMMIT;
BEGIN;
ALTER TABLE experience_sources VALIDATE CONSTRAINT experience_sources_last_sync_status_check;
COMMIT;
BEGIN;
ALTER TABLE import_runs VALIDATE CONSTRAINT import_runs_status_check;
COMMIT;
BEGIN;
ALTER TABLE region_import_state VALIDATE CONSTRAINT region_import_state_match_status_check;
COMMIT;
