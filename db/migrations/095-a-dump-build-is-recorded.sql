-- 095-a-dump-build-is-recorded.sql
--
-- The ledger of public-dump builds (ADR-0101 decision 3, #1433): one row per
-- build, naming the dump, the dated file, how it was read, what it was
-- verified against and its outcome.
--
-- 01-schema.sql declares the same table for a fresh database.
-- Re-runnable: the table and index are created where missing.

\set ON_ERROR_STOP on

BEGIN;

-- One row per build of a public dump (ADR-0101 decision 3): which dump, which
-- file of which date, how it was read, whether it was verified, and what the
-- build made of it. A reader of a dump-derived table names the build it reads.
CREATE TABLE IF NOT EXISTS dump_builds (
    id SERIAL PRIMARY KEY,
    dump VARCHAR(60) NOT NULL,
    file_name TEXT NOT NULL,
    dump_date DATE NOT NULL,
    url TEXT NOT NULL,
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('stream', 'local')),
    bytes BIGINT NOT NULL DEFAULT 0,
    expected_bytes BIGINT,
    checksum_kind VARCHAR(10) CHECK (checksum_kind IN ('md5', 'sha1')),
    checksum_expected TEXT,
    checksum_actual TEXT,
    lines BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
    error TEXT,
    started_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dump_builds_dump ON dump_builds(dump, started_at DESC);
COMMENT ON TABLE dump_builds IS 'A build of a public dump (ADR-0101): the dump, the dated file, stream or local copy, the checksum it was verified against (or its size and a clean end of stream where none is published), the lines read and the outcome. A consumer commits only after verification.';

COMMIT;
