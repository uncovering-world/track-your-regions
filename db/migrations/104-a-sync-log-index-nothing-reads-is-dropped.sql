-- 104-a-sync-log-index-nothing-reads-is-dropped.sql
--
-- idx_experience_sync_logs_latest (source_id, completed_at DESC, id DESC,
-- real completed runs only) was made by 012 for the New chip's lookup of
-- a source's latest completed run, which #529 deleted. No query looks runs
-- up by (source_id, completed_at) any more (#620): every reader reaches its
-- rows by source_id, where idx_experience_sync_logs_source serves it, or by
-- id, where the primary key does; the review queue's two sorts on
-- completed_at run over rows already reached by id. On the development
-- database on 2026-10-15 the index had 0 scans, and with sequential scans
-- turned off the planner still chose the other two for every reader. It cost
-- every run's insert and named a query that no longer exists.
--
-- 01-schema.sql no longer creates it. Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

DROP INDEX IF EXISTS idx_experience_sync_logs_latest;

COMMIT;
