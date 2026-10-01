-- 068-catalogue-coverage.sql
--
-- Four tables that hold a copy of db/catalogue-coverage/ (ADR-0081, #1204): the
-- register of kinds of experience, the surveyed regions, what a traveller
-- expects in each region, and the kinds each expectation is filed under.
--
-- The files are the source of truth. scripts/catalogue-coverage.sh load replaces
-- the content of all four tables from them in one transaction, and nothing else
-- writes them, so this migration creates the tables and loads nothing: a
-- database gets its rows from the command, the same way after this file as
-- after a fresh 01-schema.sql.
--
-- Apart from experience_kinds on purpose: that table is what a traveller
-- browses by, and a proposed kind in it would be one clause away from a
-- visitor's list.
--
-- Order-independent with 01-schema.sql, which carries the same statements;
-- re-running this file finds the tables and indexes already there and does
-- nothing.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS coverage_kinds (
    slug VARCHAR(80) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    form VARCHAR(20) NOT NULL CHECK (form IN ('place', 'work', 'food', 'drink', 'event', 'route', 'activity', 'title', 'person', 'species', 'object', 'sound')),
    definition TEXT NOT NULL,
    status VARCHAR(10) NOT NULL CHECK (status IN ('live', 'proposed')),
    experience_kind_id INTEGER REFERENCES experience_kinds(id),
    issue_number INTEGER,
    vision_heading TEXT,
    CONSTRAINT coverage_kinds_proposed_names_no_catalogue_kind CHECK (status = 'live' OR experience_kind_id IS NULL)
);

-- One record per catalogue kind: two records claiming Archaeology would count
-- every expectation of it twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_kinds_experience_kind
    ON coverage_kinds(experience_kind_id) WHERE experience_kind_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS coverage_regions (
    slug VARCHAR(80) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    country VARCHAR(255) NOT NULL,
    centre GEOMETRY(Point, 4326) NOT NULL,
    radius_km DOUBLE PRECISION NOT NULL CHECK (radius_km > 0),
    surveyed DATE NOT NULL
);

-- The ids are held to their shape here because the comparison joins them to
-- experiences.external_id and treasures.external_id as text.
CREATE TABLE IF NOT EXISTS coverage_expectations (
    region_slug VARCHAR(80) NOT NULL REFERENCES coverage_regions(slug) ON DELETE CASCADE,
    slug VARCHAR(120) NOT NULL,
    name TEXT NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    type VARCHAR(20) NOT NULL CHECK (type IN ('place', 'work', 'food', 'drink', 'event', 'route', 'activity', 'title', 'person', 'species', 'object', 'sound')),
    wikidata_id VARCHAR(20) CHECK (wikidata_id ~ '^Q[1-9][0-9]*$'),
    same_as TEXT[] NOT NULL DEFAULT '{}',
    unesco_id VARCHAR(20) CHECK (unesco_id ~ '^[1-9][0-9]*$'),
    venue TEXT,
    source_count INTEGER NOT NULL CHECK (source_count >= 2),
    sitelinks INTEGER CHECK (sitelinks >= 0),
    location GEOMETRY(Point, 4326),
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (region_slug, slug)
);

CREATE INDEX IF NOT EXISTS idx_coverage_expectations_wikidata
    ON coverage_expectations(wikidata_id) WHERE wikidata_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_expectations_location
    ON coverage_expectations USING GIST (location);

CREATE TABLE IF NOT EXISTS coverage_expectation_kinds (
    region_slug VARCHAR(80) NOT NULL,
    expectation_slug VARCHAR(120) NOT NULL,
    kind_slug VARCHAR(80) NOT NULL REFERENCES coverage_kinds(slug) ON DELETE CASCADE,
    PRIMARY KEY (region_slug, expectation_slug, kind_slug),
    CONSTRAINT coverage_expectation_kinds_entry FOREIGN KEY (region_slug, expectation_slug) REFERENCES coverage_expectations(region_slug, slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coverage_expectation_kinds_kind
    ON coverage_expectation_kinds(kind_slug);

COMMENT ON TABLE coverage_kinds IS 'The register of kinds of experience, live and proposed, loaded from db/catalogue-coverage/kinds.jsonl (ADR-0081). A copy: the file is the source of truth.';
COMMENT ON COLUMN coverage_kinds.form IS 'What a member of the kind is. An expectation is filed only under a kind whose form is its own type.';
COMMENT ON COLUMN coverage_kinds.issue_number IS 'The issue that owns building a proposed kind. Its priority and order live there, never here (ADR-0079).';
COMMENT ON TABLE coverage_regions IS 'The surveyed regions, loaded from db/catalogue-coverage/regions.jsonl (ADR-0081).';
COMMENT ON TABLE coverage_expectations IS 'What two or more independent sources recommend in a surveyed region, loaded from db/catalogue-coverage/expectations/ (ADR-0081). Identified by wikidata_id, same_as and unesco_id, never by name.';
COMMENT ON COLUMN coverage_expectations.same_as IS 'Other Wikidata items that are this same place: a building and the museum inside it.';
COMMENT ON COLUMN coverage_expectations.source_count IS 'How many sources named the entry. Which ones is not published.';
COMMENT ON TABLE coverage_expectation_kinds IS 'The kinds of the register an expectation is filed under. An expectation with no row here is not sorted yet.';

COMMIT;
