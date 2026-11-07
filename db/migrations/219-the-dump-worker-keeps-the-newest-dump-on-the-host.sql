-- 219-the-dump-worker-keeps-the-newest-dump-on-the-host.sql
--
-- dumps.wikimedia.org caps a client at three connections, and the pipeline
-- counts them within one process (#2353). The backend asked the host for each
-- dump's newest file while the worker downloaded, so the two could hold more
-- than three together. The worker now asks, at most once a day per dump, and
-- keeps what it learnt here for the admin panel to read. A workbench table
-- (ADR-0124): the pipeline's own state, read by an admin screen, never by a
-- reader.
--
-- Re-runnable: created if absent; the comment is replaced.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS workbench.dump_newest_on_host (
    dump VARCHAR(60) PRIMARY KEY,
    newest_date DATE,
    asked_at TIMESTAMPTZ NOT NULL,
    answered BOOLEAN NOT NULL
);

COMMENT ON TABLE workbench.dump_newest_on_host IS 'The newest complete file the host lists for each dump, as the dump worker last learnt it (#1583, #2353): its date (null while none was found), when the host was asked, and whether it answered; asked at most once a day, and a host that did not answer keeps the date it gave before. The admin panel reads it; only the worker asks the host, so every request to dumps.wikimedia.org shares one process''s connection cap.';

COMMIT;
