-- 109-a-dump-build-says-what-it-did.sql
--
-- A dump build that ends well says what it did (#1527): what it kept, how
-- long each step took and what it did on the way, such as an older copy
-- removed. A trial build on a sample keeps no tables, so its row is the only
-- place its result is read; a failed build's reason stays in `error`. Two
-- more kinds of build may be asked for: cutting a sample of a local copy,
-- and a trial on that sample.
--
-- 01-schema.sql declares the same column for a fresh database.
-- Re-runnable: the column is added where it is missing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE dump_builds ADD COLUMN IF NOT EXISTS outcome TEXT;

COMMENT ON COLUMN dump_builds.outcome IS 'What a build that ended well did, in words (#1527): what it kept, how long each step took, an older copy removed. Null while it runs and for one that failed or was cancelled, whose reason is in error.';
COMMENT ON COLUMN dump_builds.request IS 'What the admin asked for (#1467): kind (verify, keep, rederive, sample or trial) and, for a build that reads a local file, only (that file''s name: the local copy, or the sample a trial reads), which the worker reads when it takes the queued build.';

COMMIT;
