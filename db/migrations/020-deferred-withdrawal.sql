-- 020: a withdrawal waits for the point that replaces it (ADR-0025 decision 5)
--
-- One nullable self-reference and one partial index. Nothing reads the column on
-- a database where no source is gated: `requires_curation` is false on all three
-- categories, so every point a run inserts lands visible and the writer never
-- writes a pairing. Applying this file changes what nobody sees.
--
-- Why the column exists at all: a point that moved is a withdrawal plus an
-- insert, and under a gated source the insert lands `pending`. Applying the
-- withdrawal in the same run would take the old pin off the map while the new
-- one is invisible — and 1119 of the catalogue's 1604 experiences hold exactly
-- one point (measured 2026-08-11), so for most of them that is an object still in
-- every list with nothing on the map. So the arrival names the point it replaces,
-- and `POST /api/experiences/:id/publish` applies the withdrawal in the same
-- transaction that makes the arrival visible.
--
-- Order: this file may run before or after the next re-application of
-- `01-schema.sql`, in either order and any number of times. `ADD COLUMN IF NOT
-- EXISTS` carries the REFERENCES clause inside it, so a second application adds
-- neither the column nor a duplicate constraint; `CREATE INDEX IF NOT EXISTS` is
-- inert the same way. The column is nullable with no default and no backfill —
-- no existing row can be made to violate anything, and there is nothing to
-- credit to a decision nobody made (contrast migration 009, which wrote a value
-- and credited 1547 rows to a run that never saw them).
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/020-deferred-withdrawal.sql

\set ON_ERROR_STOP on

BEGIN;

-- `ON DELETE SET NULL` rather than CASCADE: deleting the old point must not take
-- the new one with it. The pairing is then simply gone, which is the right
-- reading — there is no longer a withdrawal to hold.
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS withdrawal_deferred_for_location_id INTEGER REFERENCES experience_locations(id) ON DELETE SET NULL;
COMMENT ON COLUMN experience_locations.withdrawal_deferred_for_location_id IS 'Set on a pending point that replaces another: the named point stopped being offered, and its missing_since is held back until this one is published (ADR-0025 decision 5). NULL on every other row.';

-- The withdrawal statement asks, for each stored row, whether anything is
-- waiting on it — a predicate with no experience_id to narrow it. Partial,
-- because the column is NULL on all but the handful of rows in flight, and every
-- query asks only about those. It is also the index the foreign key above needs:
-- Postgres does not create one for a referencing column, so without it every
-- delete of a location scans this table.
CREATE INDEX IF NOT EXISTS idx_experience_locations_deferred_withdrawal ON experience_locations(withdrawal_deferred_for_location_id) WHERE withdrawal_deferred_for_location_id IS NOT NULL;

-- A row the source no longer lists has no position in that list, and now that
-- has two spellings: recorded (`missing_since`) or still waiting on a
-- replacement. The comment is re-stated here because `01-schema.sql` states it
-- too, and a database that gets only this file must not keep the old wording.
COMMENT ON COLUMN experience_locations.ordinal IS 'Display order within the experience. A sync numbers from 1; a curator-created first location is 0. NULL when the source no longer lists this point — whether that is already recorded (missing_since) or still waiting on the point that replaces it (withdrawal_deferred_for_location_id).';

COMMIT;
