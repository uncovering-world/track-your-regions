-- 101-a-dump-build-is-queued-for-the-worker.sql
--
-- A dump build is queued by the admin panel and run by the dump worker
-- (#1467), so a restart of the backend does not stop it: the row holds what
-- was asked for, the running build's progress and an admin's cancel, and a
-- queued row has no file until the worker resolves one. At most one build of
-- a dump is queued or running.
--
-- 01-schema.sql declares the same table for a fresh database.
-- Re-runnable: each change is made where it is missing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE dump_builds ALTER COLUMN file_name DROP NOT NULL;
ALTER TABLE dump_builds ALTER COLUMN dump_date DROP NOT NULL;
ALTER TABLE dump_builds ALTER COLUMN url DROP NOT NULL;
ALTER TABLE dump_builds ADD COLUMN IF NOT EXISTS request JSONB;
ALTER TABLE dump_builds ADD COLUMN IF NOT EXISTS progress JSONB;
ALTER TABLE dump_builds ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;

ALTER TABLE dump_builds DROP CONSTRAINT IF EXISTS dump_builds_status_check;
ALTER TABLE dump_builds ADD CONSTRAINT dump_builds_status_check
  CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled'));

DROP INDEX IF EXISTS idx_dump_builds_one_running;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dump_builds_one_active ON dump_builds(dump) WHERE status IN ('queued', 'running');

COMMENT ON COLUMN dump_builds.heartbeat_at IS 'When the running build last said it is alive, every few seconds, whatever process runs it (#1463). A running row that has not beaten for five minutes is a build that stopped.';
COMMENT ON COLUMN dump_builds.runner IS 'What runs the build: the dump worker on this host (worker:<hostname>), or a script. A worker that starts closes the running rows of its own runner, which its previous run left.';
COMMENT ON COLUMN dump_builds.request IS 'What the admin asked for (#1467): kind (verify or keep) and, for a build from the local copy, only (that copy''s file name), which the worker reads when it takes the queued build.';
COMMENT ON COLUMN dump_builds.progress IS 'The running build''s progress as the panel shows it (#1467): phase message, bytes downloaded and read, lines; written by the worker with its heartbeat.';
COMMENT ON COLUMN dump_builds.cancel_requested_at IS 'When an admin asked the build to stop (#1467); the worker reads it with its heartbeat and cancels.';

COMMIT;
