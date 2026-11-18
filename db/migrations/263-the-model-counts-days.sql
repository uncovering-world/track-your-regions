-- 263-the-model-counts-days.sql
--
-- The clean catalogue model, additive half, step 1 of 4 (#2634, ADR-0217):
-- the day arithmetic every period of the model reads.
--
-- * day_index(), date_first(), date_last(): the SQL twins of dayIndex and
--   periodOf in @tyr/shared/lifetime. A day is (year * 12 + month - 1) * 31 +
--   day - 1; a year, a month or a span is every day it may be.
-- * current_day_index(): today, as the latest calendar day on Earth (UTC+14).
-- * period_meets(): whether a period may cover any day of a span, a date that
--   does not settle it counting as covered (ADR-0217 decision 6).
--
-- period_ok() is not changed here: holding a stored outer day to date_first()
-- and date_last() tightens what today's period writer may store, so it lands
-- with that writer (#1719). Nor is
-- source_id_fits_scheme(): the OpenStreetMap and Wikivoyage schemes join it
-- together with @tyr/shared/identifiers, which partRecords.db.test.ts holds it
-- to, in the slice that seeds their sources. Until then the CHECKs of 264 that
-- name an OpenStreetMap object refuse any, and every row holds none.
--
-- Writes no row. Re-runnable: every function is CREATE OR REPLACE. Order-
-- independent with 01-schema.sql, which declares the same.

\set ON_ERROR_STOP on

BEGIN;

-- The day index periodOf orders days by (@tyr/shared/lifetime dayIndex):
-- (year * 12 + month - 1) * 31 + day - 1.
CREATE OR REPLACE FUNCTION day_index(y INTEGER, m INTEGER, d INTEGER) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT (y * 12 + m - 1) * 31 + d - 1 $$;

-- The first and the last day a date may be: periodOf's twins (@tyr/shared/lifetime).
-- A day is itself, a month all its days (day 31 for every month, as dayIndex counts), a
-- year all its days, a span every year within its width either side ("1960s" stored as 1960 'decade' covers
-- 1951 → 1969, as periodOf reads it). NULL with no year.
CREATE OR REPLACE FUNCTION date_first(y INTEGER, m SMALLINT, d SMALLINT, span TEXT) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN y IS NULL THEN NULL
                WHEN span IS NOT NULL THEN day_index(y - (CASE span WHEN 'decade' THEN 10 WHEN 'century' THEN 100 ELSE 1000 END) + 1, 1, 1)
                WHEN m IS NULL THEN day_index(y, 1, 1)
                WHEN d IS NULL THEN day_index(y, m, 1)
                ELSE day_index(y, m, d) END
$$;

CREATE OR REPLACE FUNCTION date_last(y INTEGER, m SMALLINT, d SMALLINT, span TEXT) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN y IS NULL THEN NULL
                WHEN span IS NOT NULL THEN day_index(y + (CASE span WHEN 'decade' THEN 10 WHEN 'century' THEN 100 ELSE 1000 END) - 1, 12, 31)
                WHEN m IS NULL THEN day_index(y, 12, 31)
                WHEN d IS NULL THEN day_index(y, m, 31)
                ELSE day_index(y, m, d) END
$$;

-- Today as the latest calendar day on Earth (UTC+14, latestDayOnEarth): a place that opens
-- on 1 June stands from the first moment it is 1 June anywhere.
CREATE OR REPLACE FUNCTION current_day_index() RETURNS INTEGER LANGUAGE sql STABLE AS $$
    SELECT day_index(EXTRACT(year FROM t)::int, EXTRACT(month FROM t)::int, EXTRACT(day FROM t)::int)
      FROM (SELECT (now() AT TIME ZONE 'Etc/GMT-14')::date AS t) x
$$;

-- Whether a period may cover any day of [first_day, last_day]: a date that does not settle the
-- question counts as covered (ADR-0217 d6). An unknown start may be any day; an end with no date
-- may be any day after the start.
CREATE OR REPLACE FUNCTION period_meets(p_from_first INTEGER, p_ended BOOLEAN, p_until_last INTEGER,
                                        first_day INTEGER, last_day INTEGER) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT (p_from_first IS NULL OR p_from_first <= last_day)
       AND (NOT p_ended OR p_until_last IS NULL OR p_until_last >= first_day);
$$;

COMMIT;
