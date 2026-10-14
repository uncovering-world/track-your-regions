-- 100-a-dump-build-beats-a-heartbeat.sql
--
-- A running dump build says who runs it and that it is alive every minute
-- (#1463), so a build is refused while another process builds the same dump,
-- and a restart closes only its own builds and those that stopped beating.
-- At most one build of a dump is running: a second running row is refused.
--
-- 01-schema.sql declares the same columns and index for a fresh database.
-- Re-runnable: the columns and the index are created where missing, and a
-- running row the index would refuse is closed first.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE dump_builds ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE dump_builds ADD COLUMN IF NOT EXISTS runner TEXT;
COMMENT ON COLUMN dump_builds.heartbeat_at IS 'When the running build last said it is alive, every minute, whatever process runs it (#1463). A running row that has not beaten for five minutes is a build that stopped.';
COMMENT ON COLUMN dump_builds.runner IS 'What runs the build: the backend on this host (server:<hostname>), or a script. A backend that starts closes the running rows of its own runner, which its previous run left.';

-- Every running row but the newest of each dump stopped long ago.
UPDATE dump_builds b SET status = 'failed', error = 'The build stopped: its process ended or restarted.', finished_at = NOW()
 WHERE status = 'running'
   AND EXISTS (SELECT 1 FROM dump_builds n WHERE n.dump = b.dump AND n.status = 'running' AND n.started_at > b.started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dump_builds_one_running ON dump_builds(dump) WHERE status = 'running';

COMMIT;
