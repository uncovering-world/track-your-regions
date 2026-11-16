-- 256-a-place-holds-its-periods.sql
--
-- Time is held as periods (#2578, ADR-0217): place_periods holds, per place,
-- the periods in which it stood, was used, was closed or was held, each from
-- one approximate date until another, ended or open, with the outer days it
-- may cover; record_periods holds each source's view of the same, per record.
-- experiences.stands_today is derived from the standing periods by a trigger:
-- the Cathedral of Christ the Saviour in Moscow (1883 to 1931, and since
-- 2000) stands, and Nelson's Pillar in Dublin (1809 to 1966) does not.
--
-- The tables are new and empty, and no run or curator writes them yet, so the
-- file creates them and writes no row: every place keeps the column's default,
-- which is what a place with no period reads. One transaction,
-- order-independent with 01-schema.sql, which declares the same, and
-- re-runnable: every table, index, function, trigger and comment is created
-- where missing or replaced.

\set ON_ERROR_STOP on

BEGIN;

-- The new column and its trigger take an exclusive lock on experiences, and
-- the foreign keys a share lock on source_records, experience_sources and
-- users, until the commit: a long transaction on any of them must not stall
-- their writers behind this one. The column's default is constant, so no row
-- is rewritten.
SET LOCAL lock_timeout = '10s';

-- Whether five columns are one approximate date: a month only within a year, a
-- day only within a month, a span only on a year with no month, circa only on
-- a year. No year at all is a date that is not known.
CREATE OR REPLACE FUNCTION approx_date_ok(y INTEGER, m SMALLINT, d SMALLINT, span TEXT, circa BOOLEAN) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT (y IS NULL OR y <> 0)
       AND (m IS NULL OR (y IS NOT NULL AND m BETWEEN 1 AND 12))
       AND (d IS NULL OR (m IS NOT NULL AND d BETWEEN 1 AND 31))
       AND (span IS NULL OR (y IS NOT NULL AND m IS NULL))
       AND (circa IS NOT TRUE OR y IS NOT NULL);
$$;

-- Whether the columns of a period are one period: each end a date, an end date
-- only on a period that has ended, an outer day exactly where its end has a
-- year, and the start's first day never after the end's last.
CREATE OR REPLACE FUNCTION period_ok(
    from_year INTEGER, from_month SMALLINT, from_day SMALLINT, from_span TEXT, from_circa BOOLEAN,
    ended BOOLEAN,
    until_year INTEGER, until_month SMALLINT, until_day SMALLINT, until_span TEXT, until_circa BOOLEAN,
    from_first INTEGER, until_last INTEGER
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT approx_date_ok(from_year, from_month, from_day, from_span, from_circa)
       AND approx_date_ok(until_year, until_month, until_day, until_span, until_circa)
       AND (ended OR until_year IS NULL)
       AND (from_first IS NULL) = (from_year IS NULL)
       AND (until_last IS NULL) = (until_year IS NULL)
       AND (from_first IS NULL OR until_last IS NULL OR from_first <= until_last);
$$;

CREATE TABLE IF NOT EXISTS place_periods (
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    says VARCHAR(8) NOT NULL CHECK (says IN ('stood', 'used', 'closed', 'held')),
    ordinal SMALLINT NOT NULL CHECK (ordinal > 0),
    from_year INTEGER,
    from_month SMALLINT,
    from_day SMALLINT,
    from_span VARCHAR(10) CHECK (from_span IN ('decade', 'century', 'millennium')),
    from_circa BOOLEAN NOT NULL DEFAULT false,
    from_property VARCHAR(12) CHECK (from_property ~ '^P[1-9][0-9]*$'),
    from_statement TEXT CHECK (source_id_fits_scheme('wikidata-statement', from_statement)),
    ended BOOLEAN NOT NULL DEFAULT false,
    until_year INTEGER,
    until_month SMALLINT,
    until_day SMALLINT,
    until_span VARCHAR(10) CHECK (until_span IN ('decade', 'century', 'millennium')),
    until_circa BOOLEAN NOT NULL DEFAULT false,
    until_property VARCHAR(12) CHECK (until_property ~ '^P[1-9][0-9]*$'),
    until_statement TEXT CHECK (source_id_fits_scheme('wikidata-statement', until_statement)),
    ending VARCHAR(12) CHECK (ending IN ('destroyed', 'demolished', 'removed', 'collapsed')),
    what TEXT,
    from_first INTEGER,
    until_last INTEGER,
    source_id INTEGER NOT NULL REFERENCES experience_sources(id),
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (experience_id, says, ordinal),
    CONSTRAINT place_periods_period CHECK (period_ok(
        from_year, from_month, from_day, from_span, from_circa, ended,
        until_year, until_month, until_day, until_span, until_circa, from_first, until_last)),
    CONSTRAINT place_periods_ending_of_standing CHECK (ending IS NULL OR (says = 'stood' AND ended)),
    CONSTRAINT place_periods_what_of_use CHECK (what IS NULL OR (says IN ('used', 'closed') AND btrim(what) <> ''))
);
-- A place stands in one open period at most, and the derivation of
-- stands_today finds it here.
CREATE UNIQUE INDEX IF NOT EXISTS idx_place_periods_standing ON place_periods(experience_id) WHERE says = 'stood' AND NOT ended;
CREATE INDEX IF NOT EXISTS idx_place_periods_decided_by ON place_periods(decided_by) WHERE decided_by IS NOT NULL;

COMMENT ON TABLE place_periods IS 'A place''s periods (#2578, ADR-0217): one row per period, saying that the place stood, was used, was closed or was held from one date until another, numbered in time order within what it says. A place is gone when it has stood periods and none is open (experiences.stands_today). Written by db/placePeriodsWriter.ts alone (ADR-0069).';
COMMENT ON COLUMN place_periods.says IS 'What was so in the period: stood (the place itself stood), used (what it housed or was used for), closed (it could not be visited), held (an event took place there). The vocabulary is PERIOD_SAYS in @tyr/shared/lifetime. Only a stood period that ends takes the place off today''s lists.';
COMMENT ON COLUMN place_periods.ordinal IS 'The period''s place in time order among the place''s periods that say the same, from 1, numbered by the writer.';
COMMENT ON COLUMN place_periods.from_year IS 'The year the period began, signed as the Wikidata subset gives it from Wikidata''s JSON: 250 BC is -250, and there is no year zero. A day is a day of the proleptic Gregorian calendar. NULL where the start is not known.';
COMMENT ON COLUMN place_periods.from_span IS 'How coarsely the year is known, where coarser than a year: decade, century or millennium; month and day are then NULL.';
COMMENT ON COLUMN place_periods.from_circa IS 'The source dates the start approximately (Wikidata''s circa qualifier, or a curator''s about).';
COMMENT ON COLUMN place_periods.from_property IS 'The Wikidata property the start was read from (P571 inception, P1619 official opening, ...); NULL for a curator''s date.';
COMMENT ON COLUMN place_periods.from_statement IS 'The Wikidata statement the start was read from (Q194474$...), so a curator can find it; NULL for a curator''s date.';
COMMENT ON COLUMN place_periods.ended IS 'Whether the period has an end. false: it still holds with no end in sight, and the until columns are NULL. true with a NULL until_year: it ended, and when is not known. A standing period or a use that has an end ended in the past; a closure or an occurrence may end on a day still ahead.';
COMMENT ON COLUMN place_periods.until_year IS 'The year the period ended, numbered as from_year; NULL on an open period and on one that ended at a date not known.';
COMMENT ON COLUMN place_periods.ending IS 'On a stood period that ended, how the place stopped standing, where the source says: destroyed, demolished, removed or collapsed.';
COMMENT ON COLUMN place_periods.what IS 'A curator''s words for a use (mosque, capital) or for why the place is closed; NULL on a period a run wrote.';
COMMENT ON COLUMN place_periods.from_first IS 'The first day the start may be, as the count of days periodOf (@tyr/shared/lifetime) orders dates by; NULL where the start is not known. Written by the writer from that rule; a read as of a date compares it.';
COMMENT ON COLUMN place_periods.until_last IS 'The last day the end may be, counted as from_first; NULL on an open period and on an end with no date.';
COMMENT ON COLUMN place_periods.source_id IS 'The source whose view of the place the period was taken from; Curators (11) for a period a curator set.';
COMMENT ON COLUMN place_periods.decided_by IS 'The curator who set the period; NULL for a period a run wrote.';

CREATE TABLE IF NOT EXISTS record_periods (
    record_id INTEGER NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
    says VARCHAR(8) NOT NULL CHECK (says IN ('stood', 'used', 'closed', 'held')),
    ordinal SMALLINT NOT NULL CHECK (ordinal > 0),
    from_year INTEGER,
    from_month SMALLINT,
    from_day SMALLINT,
    from_span VARCHAR(10) CHECK (from_span IN ('decade', 'century', 'millennium')),
    from_circa BOOLEAN NOT NULL DEFAULT false,
    from_property VARCHAR(12) CHECK (from_property ~ '^P[1-9][0-9]*$'),
    from_statement TEXT CHECK (source_id_fits_scheme('wikidata-statement', from_statement)),
    ended BOOLEAN NOT NULL DEFAULT false,
    until_year INTEGER,
    until_month SMALLINT,
    until_day SMALLINT,
    until_span VARCHAR(10) CHECK (until_span IN ('decade', 'century', 'millennium')),
    until_circa BOOLEAN NOT NULL DEFAULT false,
    until_property VARCHAR(12) CHECK (until_property ~ '^P[1-9][0-9]*$'),
    until_statement TEXT CHECK (source_id_fits_scheme('wikidata-statement', until_statement)),
    ending VARCHAR(12) CHECK (ending IN ('destroyed', 'demolished', 'removed', 'collapsed')),
    what TEXT,
    from_first INTEGER,
    until_last INTEGER,
    PRIMARY KEY (record_id, says, ordinal),
    CONSTRAINT record_periods_period CHECK (period_ok(
        from_year, from_month, from_day, from_span, from_circa, ended,
        until_year, until_month, until_day, until_span, until_circa, from_first, until_last)),
    CONSTRAINT record_periods_ending_of_standing CHECK (ending IS NULL OR (says = 'stood' AND ended)),
    CONSTRAINT record_periods_what_of_use CHECK (what IS NULL OR (says IN ('used', 'closed') AND btrim(what) <> ''))
);

COMMENT ON TABLE record_periods IS 'Each source''s view of a place''s periods (#2578, ADR-0217 decision 3, ADR-0084): the periods the record''s source last reported, in the shape of place_periods, written whole by the run beside the record''s reported_* columns. Written by db/placePeriodsWriter.ts alone (ADR-0069).';

-- Whether a place stands today: it holds no standing period, or one that is
-- open. A standing period never ends in the future (the writer refuses one),
-- so the answer does not go stale with the calendar. PL/pgSQL, so the two
-- probes keep their plans across the calls of a run.
CREATE OR REPLACE FUNCTION place_stands(place_id INTEGER) RETURNS BOOLEAN AS $$
BEGIN
    RETURN NOT EXISTS (SELECT 1 FROM place_periods p WHERE p.experience_id = place_id AND p.says = 'stood')
        OR EXISTS (SELECT 1 FROM place_periods p WHERE p.experience_id = place_id AND p.says = 'stood' AND NOT p.ended);
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS stands_today BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_experiences_gone ON experiences(id) WHERE NOT stands_today;
COMMENT ON COLUMN experiences.stands_today IS 'Derived from the place''s standing periods by derive_stands_today(): false once the place has stood periods and none is open, true otherwise. Written only by that trigger, and stands_today_is_derived() refuses any other value (ADR-0217 decision 5). No reader reads it yet: existence still hides a lost place.';

-- Keep experiences.stands_today equal to what the place's standing periods
-- say, after every write to them. Only a stood period counts, and only its
-- being there and its being open, so a write to a use or a closure touches no
-- place. The row triggers of one statement all fire after it, so a list
-- written in one statement moves the column once at most.
CREATE OR REPLACE FUNCTION derive_stands_today() RETURNS trigger AS $$
DECLARE
    was INTEGER;
    now_of INTEGER;
    stands BOOLEAN;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        IF OLD.says = 'stood' THEN
            was := OLD.experience_id;
        END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        IF NEW.says = 'stood' AND NEW.experience_id IS DISTINCT FROM was THEN
            now_of := NEW.experience_id;
        END IF;
    END IF;
    IF was IS NOT NULL THEN
        stands := place_stands(was);
        UPDATE experiences SET stands_today = stands WHERE id = was AND stands_today <> stands;
    END IF;
    IF now_of IS NOT NULL THEN
        stands := place_stands(now_of);
        UPDATE experiences SET stands_today = stands WHERE id = now_of AND stands_today <> stands;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_stands_today ON place_periods;
CREATE TRIGGER trg_derive_stands_today
    AFTER INSERT OR DELETE OR UPDATE OF ended, says, experience_id
    ON place_periods
    FOR EACH ROW EXECUTE FUNCTION derive_stands_today();

-- stands_today is derived and never set: a new place holds no period and so
-- stands, and an update may only write what the periods say, which is what
-- derive_stands_today() writes. The two triggers fire after the row is
-- written, as every trigger on experiences does, and only for a statement that
-- names a value other than the one the row would hold anyway.
CREATE OR REPLACE FUNCTION stands_today_is_derived() RETURNS trigger AS $$
BEGIN
    IF NEW.stands_today IS DISTINCT FROM place_stands(NEW.id) THEN
        RAISE EXCEPTION 'experiences.stands_today is derived from place_periods: the periods of place % say %',
            NEW.id, place_stands(NEW.id) USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_new_place_stands ON experiences;
CREATE TRIGGER trg_new_place_stands
    AFTER INSERT
    ON experiences
    FOR EACH ROW WHEN (NOT NEW.stands_today) EXECUTE FUNCTION stands_today_is_derived();

DROP TRIGGER IF EXISTS trg_stands_today_is_derived ON experiences;
CREATE TRIGGER trg_stands_today_is_derived
    AFTER UPDATE OF stands_today
    ON experiences
    FOR EACH ROW WHEN (OLD.stands_today IS DISTINCT FROM NEW.stands_today) EXECUTE FUNCTION stands_today_is_derived();

COMMIT;
