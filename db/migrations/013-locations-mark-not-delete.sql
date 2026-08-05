-- 013: a location the source stopped offering is marked, not deleted
--
-- `user_visited_locations.location_id` and
-- `experience_location_regions.location_id` are both `ON DELETE CASCADE`, so
-- deleting a location silently takes the user's record of having stood there
-- and every region assignment on it, manual ones included. A source that drops
-- a point for one run — or an import correction that re-homes an object — is
-- enough to destroy data no run can put back.
--
-- So a location gets what an experience already has: a machine observation
-- (`missing_since`) that a curator later judges. `ordinal` becomes nullable
-- because a row the source no longer lists has no position in the source's
-- list; NULL sorts last, which is where such a row belongs. The existing
-- UNIQUE(experience_id, ordinal) key is unaffected — Postgres does not compare
-- NULLs, so any number of marked rows coexist with the positioned ones.
--
-- There is deliberately NO backfill. Nothing has been observed missing yet,
-- because until now anything missing was deleted. Compare migration 009, which
-- did write a value and thereby credited 1547 rows to a run that never saw
-- them (caught in PR #493). A migration must state the truth about rows that
-- predate its feature.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/013-locations-mark-not-delete.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_locations
    ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;

COMMENT ON COLUMN experience_locations.missing_since IS
    'When a run first offered this experience without this point. A machine observation, not a verdict. NULL = currently offered.';

ALTER TABLE experience_locations
    ALTER COLUMN ordinal DROP NOT NULL;

COMMENT ON COLUMN experience_locations.ordinal IS
    'Display order within the experience. A sync numbers from 1; a curator-created first location is 0. NULL when the source no longer lists this point — see missing_since.';

-- Every read of an experience's current points carries `missing_since IS NULL`,
-- and the writer's fast path counts them per experience on every object of
-- every run. Partial, because no read ever asks for the marked rows alone.
CREATE INDEX IF NOT EXISTS idx_experience_locations_offered
    ON experience_locations(experience_id) WHERE missing_since IS NULL;

COMMIT;
