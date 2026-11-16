-- 257-the-four-dates-give-way-to-periods.sql
--
-- place_dates and record_dates go (#2578, ADR-0217 decision 2): a place's time
-- is held as periods in place_periods, and each source's view of it in
-- record_periods (migration 256), which hold what the four slots held and the
-- gap they could not, the Cathedral of Christ the Saviour's 1931 among them.
-- The runs write the period tables, and nothing reads the two that go.
--
-- No row is carried over. The development database held none on 2026-11-16,
-- and a row a run wrote since is written again, as periods, by the source's
-- next run: each date was read from the place's Wikidata item, and no curator
-- screen ever wrote one. One transaction, and re-runnable.

\set ON_ERROR_STOP on

BEGIN;

-- Dropping a table takes an exclusive lock on it and on the tables its
-- foreign keys name (experiences, source_records, experience_sources, users)
-- for an instant; a long transaction on any of them must not stall their
-- writers behind this one.
SET LOCAL lock_timeout = '10s';

DROP TABLE IF EXISTS record_dates;
DROP TABLE IF EXISTS place_dates;

COMMIT;
