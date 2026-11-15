-- 255-a-place-holds-its-dates.sql
--
-- A place can hold its lifetime (#1719, ADR-0214): place_dates holds, per
-- place, when it began, when what stands now was rebuilt, when what it housed
-- or was used for ended, and when the place itself stopped standing, each a
-- year numbered as the Wikidata subset gives it, with month, day or span,
-- circa, and the source it was read from; record_dates holds each source's
-- view of the same, per record. Göbekli Tepe begins about 10,000 BC, which no Postgres date can
-- hold.
--
-- Both tables are new and empty: no run or curator writes them yet, so the
-- file creates them and writes no row. One transaction, order-independent
-- with 01-schema.sql, which declares the same, and re-runnable: every table,
-- index and comment is created where missing or replaced.

\set ON_ERROR_STOP on

BEGIN;

-- The foreign keys take a share lock on experiences, source_records,
-- experience_sources and users until the commit; a long transaction on any of
-- them must not stall their writers behind this one.
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS place_dates (
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    slot VARCHAR(10) NOT NULL CHECK (slot IN ('began', 'rebuilt', 'use_ended', 'ended')),
    year INTEGER CHECK (year <> 0),
    month SMALLINT CHECK (month BETWEEN 1 AND 12),
    day SMALLINT CHECK (day BETWEEN 1 AND 31),
    span VARCHAR(10) CHECK (span IN ('decade', 'century', 'millennium')),
    circa BOOLEAN NOT NULL DEFAULT false,
    ending VARCHAR(12) CHECK (ending IN ('destroyed', 'demolished', 'removed', 'collapsed')),
    source_id INTEGER NOT NULL REFERENCES experience_sources(id),
    property VARCHAR(12) CHECK (property ~ '^P[1-9][0-9]*$'),
    statement TEXT CHECK (source_id_fits_scheme('wikidata-statement', statement)),
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (experience_id, slot),
    CONSTRAINT place_dates_month_in_year CHECK (month IS NULL OR year IS NOT NULL),
    CONSTRAINT place_dates_day_in_month CHECK (day IS NULL OR month IS NOT NULL),
    CONSTRAINT place_dates_span_of_year CHECK (span IS NULL OR (year IS NOT NULL AND month IS NULL)),
    CONSTRAINT place_dates_circa_of_year CHECK (NOT circa OR year IS NOT NULL),
    CONSTRAINT place_dates_year_unless_ended CHECK (year IS NOT NULL OR slot = 'ended'),
    CONSTRAINT place_dates_ending_of_end CHECK (ending IS NULL OR slot = 'ended')
);
CREATE INDEX IF NOT EXISTS idx_place_dates_ended ON place_dates(experience_id) WHERE slot = 'ended';
CREATE INDEX IF NOT EXISTS idx_place_dates_decided_by ON place_dates(decided_by) WHERE decided_by IS NOT NULL;

COMMENT ON TABLE place_dates IS 'A place''s lifetime (#1719, ADR-0214): one row per date it holds, began, rebuilt, use_ended or ended, each a year numbered as the Wikidata subset gives it (250 BC is -250) with month, day or span and circa, and the source it was read from. Only ended hides the place from today''s catalogue. Written by db/placeDatesWriter.ts alone (ADR-0069).';
COMMENT ON COLUMN place_dates.slot IS 'What the date says: began (the place first stood or was founded), rebuilt (what stands now was built again after an end), use_ended (what it housed or was used for ended: a monastery dissolved, a settlement abandoned), ended (the place itself stopped standing). The vocabulary is LIFETIME_SLOTS in @tyr/shared/lifetime.';
COMMENT ON COLUMN place_dates.year IS 'The year, signed as the Wikidata subset gives it from Wikidata''s JSON: 250 BC is -250, and there is no year zero. A day is a day of the proleptic Gregorian calendar. NULL only on ended, for a place a curator knows is gone without knowing when.';
COMMENT ON COLUMN place_dates.span IS 'How coarsely the year is known, where coarser than a year: decade, century or millennium; month and day are then NULL. NULL means as precisely as the year, month and day set.';
COMMENT ON COLUMN place_dates.circa IS 'The source dates it approximately (Wikidata''s circa qualifier, or a curator''s about).';
COMMENT ON COLUMN place_dates.ending IS 'On ended, how the place stopped standing, where the source says: destroyed, demolished, removed or collapsed.';
COMMENT ON COLUMN place_dates.source_id IS 'The source whose view of the place the date was taken from; Curators (11) for a date a curator set.';
COMMENT ON COLUMN place_dates.property IS 'The Wikidata property the date was read from (P571 inception, P1619 official opening, P576 dissolved or demolished, ...); NULL for a curator''s date.';
COMMENT ON COLUMN place_dates.statement IS 'The Wikidata statement the date was read from (Q194474$...), so a curator can find it; NULL for a curator''s date.';
COMMENT ON COLUMN place_dates.decided_by IS 'The curator who set the date; NULL for a date a run wrote.';

CREATE TABLE IF NOT EXISTS record_dates (
    record_id INTEGER NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
    slot VARCHAR(10) NOT NULL CHECK (slot IN ('began', 'rebuilt', 'use_ended', 'ended')),
    year INTEGER CHECK (year <> 0),
    month SMALLINT CHECK (month BETWEEN 1 AND 12),
    day SMALLINT CHECK (day BETWEEN 1 AND 31),
    span VARCHAR(10) CHECK (span IN ('decade', 'century', 'millennium')),
    circa BOOLEAN NOT NULL DEFAULT false,
    ending VARCHAR(12) CHECK (ending IN ('destroyed', 'demolished', 'removed', 'collapsed')),
    property VARCHAR(12) CHECK (property ~ '^P[1-9][0-9]*$'),
    statement TEXT CHECK (source_id_fits_scheme('wikidata-statement', statement)),
    PRIMARY KEY (record_id, slot),
    CONSTRAINT record_dates_month_in_year CHECK (month IS NULL OR year IS NOT NULL),
    CONSTRAINT record_dates_day_in_month CHECK (day IS NULL OR month IS NOT NULL),
    CONSTRAINT record_dates_span_of_year CHECK (span IS NULL OR (year IS NOT NULL AND month IS NULL)),
    CONSTRAINT record_dates_circa_of_year CHECK (NOT circa OR year IS NOT NULL),
    CONSTRAINT record_dates_year_unless_ended CHECK (year IS NOT NULL OR slot = 'ended'),
    CONSTRAINT record_dates_ending_of_end CHECK (ending IS NULL OR slot = 'ended')
);

COMMENT ON TABLE record_dates IS 'Each source''s view of a place''s lifetime (#1719, ADR-0084): the dates the record''s source last reported, in the shape of place_dates, written whole by the run beside the record''s reported_* columns. Written by db/placeDatesWriter.ts alone (ADR-0069).';

COMMIT;
