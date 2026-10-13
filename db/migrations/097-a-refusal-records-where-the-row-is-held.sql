-- 097-a-refusal-records-where-the-row-is-held.sql
--
-- What a kind's rule refused as another place's, and where it found it held
-- (ADR-0102, #1444): Public Art refuses the Bamberg Horseman as "inside
-- Bamberg Cathedral", and the places of worship, which admit the cathedral,
-- take the horseman from that record. One row per refusing source and work,
-- written from what the run filtered whether or not the source ever held the
-- work as a row. Empty until Public Art's next run writes it.
--
-- 01-schema.sql declares the same table for a fresh database.
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_hand_overs (
    source_id INTEGER NOT NULL REFERENCES experience_sources(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    name TEXT,
    reason TEXT NOT NULL,
    held_in TEXT[] NOT NULL CHECK (cardinality(held_in) > 0),
    sync_log_id INTEGER REFERENCES experience_sync_logs(id) ON DELETE SET NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_id, external_id)
);
COMMENT ON TABLE experience_hand_overs IS 'A work a source''s rule refused as held by another place (ADR-0102): the reason, and the places it found it held in, item ids nearest first (the Cornaro chapel, then Santa Maria della Vittoria). The refusing run writes what it filtered and, on a complete run, drops what it no longer refuses this way; a works kind admitting one of the places takes the work.';

COMMIT;
