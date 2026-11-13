-- 236-a-visit-holds-its-trips.sql
--
-- A visit holds its trips, each with an approximate date (#2120, ADR-0202).
-- The visit's own moment, visited_at, was when the tick was made and never
-- when the traveller was there, so it becomes marked_at, and the trips table
-- arrives empty: no trip is written for a visit made before, since a tick's
-- moment as a trip's date would be wrong on almost every one. A visit with no
-- trip is a visit with no date. Order-independent with 01-schema.sql, which
-- declares the same. Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'user_visited_experiences' AND column_name = 'visited_at') THEN
    ALTER TABLE user_visited_experiences RENAME COLUMN visited_at TO marked_at;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_visit_trips (
    id SERIAL PRIMARY KEY,
    visit_id INTEGER NOT NULL REFERENCES user_visited_experiences(id) ON DELETE CASCADE,
    year SMALLINT CHECK (year >= 1900),
    month SMALLINT CHECK (month BETWEEN 1 AND 12),
    day SMALLINT CHECK (day BETWEEN 1 AND 31),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (month IS NULL OR year IS NOT NULL),
    CHECK (day IS NULL OR month IS NOT NULL),
    CHECK (day IS NULL OR make_date(year, month, day) IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_user_visit_trips_visit ON user_visit_trips(visit_id);
COMMENT ON TABLE user_visit_trips IS 'A traveller''s trips to a place they visited, each with an approximate date: year, month and day each optional, a month only within a year and a day only within a month; all three empty is a trip they do not remember the date of (#2120, ADR-0202). Owner-only.';

COMMIT;
