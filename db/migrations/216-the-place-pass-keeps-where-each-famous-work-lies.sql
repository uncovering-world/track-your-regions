-- 216-the-place-pass-keeps-where-each-famous-work-lies.sql
--
-- The place pass reads the works of Art Museums, Places of worship and
-- Archaeology once (#1821). A famous work no kind shows is then nowhere in the
-- catalogue, and a place no kind offers that holds one, the Beinecke Library and
-- the Voynich manuscript, was named by nothing. The pass now writes where each
-- famous work lies, and a catalogue check reads it. A workbench table
-- (ADR-0124): a run's by-product, read by an admin check, never by a reader.
--
-- Re-runnable: created if absent; the comment is replaced.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS workbench.gathered_work_venues (
    work_qid TEXT NOT NULL,
    work_label TEXT NOT NULL,
    sitelinks INTEGER NOT NULL,
    venue_qid TEXT NOT NULL,
    property TEXT NOT NULL CHECK (property IN ('P195', 'P276')),
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (work_qid, venue_qid, property)
);
CREATE INDEX IF NOT EXISTS idx_gathered_work_venues_venue ON workbench.gathered_work_venues (venue_qid);
COMMENT ON TABLE workbench.gathered_work_venues IS 'Where each famous work of the place pass''s gather of works lies (#1821): every work at ICONIC_RELEASE Wikipedia editions or more that the gather read, not lost and not of unknown whereabouts, and the venues its collection (P195) and location (P276) statements name now, read by the placement''s rule (currentValues, whereaboutsUnknown in museum/placement.ts). Replaced whole by each pass that reads works (places/gatheredWorkVenues.ts), whatever any kind then shows of it, so a work no kind shows still lies in its place; read by the catalogue check that names a place no kind offers holding a famous work, never by a reader route.';

COMMIT;
