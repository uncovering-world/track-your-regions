-- 023: a run records what the object holds, not only what its fields say
--
-- One new column. `experience_sync_changes.changed_fields` covers the object's own
-- twelve scalar fields; nothing covered the points and works it holds, so a run
-- that hung a new painting or dropped a component of a serial site left no trace
-- of which one. See ADR-0026.
--
-- Keyed by kind of contents rather than a column per kind, so the next kind costs
-- no migration:
--
--   {"locations": {"added": [{"name": ..., "ref": ...}], "withdrawn": [], "returned": []},
--    "treasures": {"added": [...], "withdrawn": [], "returned": []}}
--
-- Nothing to backfill, and nothing that could be. The delta is the difference
-- between two beliefs a run held, and the runs on disk did not record theirs.
-- `experience_locations.created_at` cannot stand in: 6548 of 6680 rows carry
-- 2026-08-04, the day the old delete-and-reinsert re-created them. So every row
-- written before this file keeps NULL, and NULL means "not recorded" rather than
-- "nothing moved" -- a distinction anything reading this column has to respect,
-- because the two are indistinguishable in the data and only one of them is true.
--
-- Treasures will be add-only for a while, and that is deliberate. Nothing unlinks
-- a work, because no contents coverage floor exists for treasures: run 42 fetched
-- 291 artworks where the run before it fetched 1906 and reported success, and
-- unlinking on such a run would take real works off the walls. So a museum row
-- with no "withdrawn" entries is not evidence that nothing left (ADR-0026
-- decision 5).
--
-- Order: this file may run before or after the next re-application of
-- `01-schema.sql`, in either order and any number of times. `ADD COLUMN IF NOT
-- EXISTS` is a no-op where the column exists, and `01-schema.sql` carries the same
-- ALTER for the same reason -- `CREATE TABLE IF NOT EXISTS` cannot add a column to
-- a table that is already there.
--
-- Applying this file changes nothing anyone sees. It adds a place for the next
-- run to write what it did; no read, no query and no screen consults the column
-- until its consumers land.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/023-contents-delta.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_sync_changes ADD COLUMN IF NOT EXISTS contents JSONB;

COMMENT ON COLUMN experience_sync_changes.contents IS 'What the run did to what the object holds, keyed by kind of contents: {"locations": {"added": [{"name","ref"}], "withdrawn": [...], "returned": [...]}, "treasures": {...}}. See ADR-0026. Keyed rather than one column per kind so a new kind of contents costs no migration; a kind the run did nothing to is absent. Items are named, never identified by id, so the record stays legible after the row it names is renamed. NULL means the run recorded nothing here - for a run older than this column that is not the same as "the contents did not move", and the location rows cannot be asked instead (created_at was overwritten wholesale on 2026-08-04).';

COMMIT;
