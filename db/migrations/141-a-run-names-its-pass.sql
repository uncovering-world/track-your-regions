-- 141-a-run-names-its-pass.sql
--
-- Several sources may fill their kinds from one gather (#1818, ADR-0132). A
-- pass gathers once and runs each source after the first from what it
-- gathered, with a log of its own, and every log after the first names the
-- first one's, so the history reads the pass as one run.
--
-- No run before this file shared a gather, so no row is written.
--
-- Re-runnable: the column and the index are created only when absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_logs
  ADD COLUMN IF NOT EXISTS pass_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_experience_sync_logs_pass
  ON experience_sync_logs(pass_log_id) WHERE pass_log_id IS NOT NULL;

COMMENT ON COLUMN experience_sync_logs.pass_log_id IS 'The log of the first source of the pass this run was part of (ADR-0132): the run read its candidates from the gather that run made, and the history shows the two together. NULL on the first run of a pass and on a run that shared no gather; the pass of a log is COALESCE(pass_log_id, id).';

COMMIT;
