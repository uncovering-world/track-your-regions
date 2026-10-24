-- 167-coverage-calibration-lists.sql
--
-- A kind's fame line is chosen and re-checked on the kind's own calibration
-- list: the tops a traveller expects of the kind, named by reference lists a
-- person can read again (#1864). Until now the lists lived in the prose of a
-- source record (docs/sources/global/wikidata-towers.md's 23 survey towers and
-- 52 federation members, the bridges' 79 works), so when a line moved, a rule
-- changed or Wikidata retyped an item, nothing re-checked whether an obvious
-- top had fallen out.
--
-- db/catalogue-coverage/calibration-sources.jsonl is the register of the
-- reference lists, and db/catalogue-coverage/calibration/<kind>.jsonl one list
-- per live kind of place, each entry naming the sources that call it a top.
-- These tables are their copy, loaded with the coverage tables by
-- scripts/catalogue-coverage.sh load (ADR-0081) and written by nothing else;
-- the coverage report reads them to say, per kind, how many of its tops a
-- reader sees and why each miss stands.
--
-- The files are the source of truth and the load replaces every row, so this
-- migration creates the tables and loads nothing. Order-independent with
-- 01-schema.sql, which carries the same statements; re-running this file finds
-- the tables already there and does nothing.

\set ON_ERROR_STOP on

-- Named workbench.<table> as 01-schema.sql names them: the search path is
-- public, workbench, so an unqualified CREATE TABLE would land them in public,
-- and IF NOT EXISTS would then make a second copy beside the schema's (ADR-0121).

BEGIN;

CREATE TABLE IF NOT EXISTS workbench.coverage_calibration_sources (
    slug VARCHAR(80) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url TEXT,
    read DATE NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS workbench.coverage_calibration_entries (
    kind_slug VARCHAR(80) NOT NULL REFERENCES workbench.coverage_kinds(slug) ON DELETE CASCADE,
    slug VARCHAR(120) NOT NULL,
    name TEXT NOT NULL,
    wikidata_id VARCHAR(20) NOT NULL CHECK (wikidata_id ~ '^Q[1-9][0-9]*$'),
    sitelinks INTEGER CHECK (sitelinks >= 0),
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (kind_slug, slug),
    CONSTRAINT coverage_calibration_entries_one_item UNIQUE (kind_slug, wikidata_id)
);

CREATE INDEX IF NOT EXISTS idx_coverage_calibration_entries_wikidata
    ON workbench.coverage_calibration_entries(wikidata_id);

CREATE TABLE IF NOT EXISTS workbench.coverage_calibration_entry_sources (
    kind_slug VARCHAR(80) NOT NULL,
    entry_slug VARCHAR(120) NOT NULL,
    source_slug VARCHAR(80) NOT NULL REFERENCES workbench.coverage_calibration_sources(slug) ON DELETE CASCADE,
    PRIMARY KEY (kind_slug, entry_slug, source_slug),
    CONSTRAINT coverage_calibration_entry_sources_entry FOREIGN KEY (kind_slug, entry_slug) REFERENCES workbench.coverage_calibration_entries(kind_slug, slug) ON DELETE CASCADE
);

COMMENT ON TABLE workbench.coverage_calibration_sources IS 'The reference lists a kind''s calibration entries are named by, loaded from db/catalogue-coverage/calibration-sources.jsonl (#1864). A copy: the file is the source of truth.';
COMMENT ON COLUMN workbench.coverage_calibration_sources.read IS 'The date the list was read, which is the date of the membership it states.';
COMMENT ON TABLE workbench.coverage_calibration_entries IS 'The tops a traveller expects of a live kind, one list per kind, loaded from db/catalogue-coverage/calibration/<kind>.jsonl (#1864). The kind''s fame line is chosen and re-checked on it. Identified by wikidata_id, never by name.';
COMMENT ON COLUMN workbench.coverage_calibration_entries.sitelinks IS 'The entry''s Wikipedia editions as Wikidata gave them when the list was compiled, so the report can tell an absent top under the kind''s editions line from one the kind''s classes do not reach.';
COMMENT ON TABLE workbench.coverage_calibration_entry_sources IS 'Which reference lists name a calibration entry as a top. An entry names at least one.';

COMMIT;
