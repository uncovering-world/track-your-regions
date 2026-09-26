-- 063-run-status-moves-are-guarded.sql
--
-- A run's status walks its moves, and is never NULL (#794).
--
-- The database refuses a status move @tyr/shared/runStatuses
-- (RUN_STATUS_MOVES) does not list, on experience_sync_logs and import_runs,
-- as it does for curation_state (ADR-0070). region_import_state.match_status
-- gets no guard: some writer makes every one of its moves.
--
-- experience_sync_logs.status and import_runs.status become NOT NULL. Both
-- have defaulted to 'running' since they were created and every writer names
-- a status, so a NULL is a row nobody wrote a status to; it is closed 'failed',
-- the verdict the startup sweep gives a run nobody closed. The development
-- catalogue on 2026-09-26 held none. The NOT NULL rides on a validated CHECK,
-- so SET NOT NULL finds the proof in the catalogue instead of scanning the
-- table under ACCESS EXCLUSIVE, and the CHECK is dropped once it has served.
-- Re-runnable: the function is CREATE OR REPLACE, each trigger and CHECK is
-- dropped if present, and SET NOT NULL on a NOT NULL column changes nothing.

\set ON_ERROR_STOP on

BEGIN;
-- Before the guard exists, whose lists hold no move from NULL. On a re-run the
-- columns are NOT NULL and there is nothing left to backfill.
UPDATE experience_sync_logs SET status = 'failed', completed_at = COALESCE(completed_at, NOW())
 WHERE status IS NULL;
UPDATE import_runs SET status = 'failed', completed_at = COALESCE(completed_at, NOW())
 WHERE status IS NULL;

ALTER TABLE experience_sync_logs DROP CONSTRAINT IF EXISTS experience_sync_logs_status_not_null;
ALTER TABLE experience_sync_logs ADD CONSTRAINT experience_sync_logs_status_not_null
  CHECK (status IS NOT NULL) NOT VALID;
ALTER TABLE import_runs DROP CONSTRAINT IF EXISTS import_runs_status_not_null;
ALTER TABLE import_runs ADD CONSTRAINT import_runs_status_not_null
  CHECK (status IS NOT NULL) NOT VALID;
COMMIT;

BEGIN;
ALTER TABLE experience_sync_logs VALIDATE CONSTRAINT experience_sync_logs_status_not_null;
COMMIT;
BEGIN;
ALTER TABLE import_runs VALIDATE CONSTRAINT import_runs_status_not_null;
COMMIT;

BEGIN;
ALTER TABLE experience_sync_logs ALTER COLUMN status SET NOT NULL;
ALTER TABLE experience_sync_logs DROP CONSTRAINT experience_sync_logs_status_not_null;
ALTER TABLE import_runs ALTER COLUMN status SET NOT NULL;
ALTER TABLE import_runs DROP CONSTRAINT import_runs_status_not_null;

-- A run's status move the lifecycle does not allow is refused (#794).
--
-- A sync log closes from running and may have its verdict corrected after,
-- but never becomes running again: the startup sweep would take it for a run
-- a restart interrupted. An import run goes running -> matching -> reviewing,
-- or to failed from either of the first two, and nothing leaves reviewing or
-- failed. The moves are listed in @tyr/shared/runStatuses (RUN_STATUS_MOVES)
-- and here, and a database-lane spec (runStatusMoves.db.test.ts) walks every
-- pair against the list. An insert is not a move.
CREATE OR REPLACE FUNCTION guard_run_status_move() RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN;
BEGIN
  allowed := CASE TG_TABLE_NAME
    WHEN 'experience_sync_logs' THEN NEW.status <> 'running'
    WHEN 'import_runs' THEN (OLD.status, NEW.status) IN
      (('running', 'matching'), ('matching', 'reviewing'), ('running', 'failed'), ('matching', 'failed'))
    ELSE FALSE
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'status may not move from % to % on %', OLD.status, NEW.status, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_run_status_move ON experience_sync_logs;
CREATE TRIGGER guard_run_status_move
  BEFORE UPDATE OF status ON experience_sync_logs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION guard_run_status_move();
DROP TRIGGER IF EXISTS guard_run_status_move ON import_runs;
CREATE TRIGGER guard_run_status_move
  BEFORE UPDATE OF status ON import_runs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION guard_run_status_move();
COMMIT;
