-- 027: a point and a work can hold a curator's claim
--
-- `experiences.curated_fields` has existed since the catalogue learned that a
-- run must not overwrite what a person decided (#488). What an experience is
-- *made of* never learned it: `locationWriter` sets a point's name, reference
-- and coordinate from the source on every arm it runs, and the treasure upsert
-- sets every column from `EXCLUDED`. A curator who fixes either has it back the
-- way the source likes it after the next run, silently.
--
-- Measured 2026-08-20 on this database: zero points and zero works have ever
-- been decided by a person, so nothing is being repaired here — this is the
-- column that has to exist before the verdict is worth asking for. The gate
-- offers a curator "take the source's point" and "keep the source's point"; the
-- third answer needs somewhere to be written down.
--
-- Two tables, not three. `experience_treasures` carries no field of its own —
-- it is a link, and its only column beyond the two ids is `curation_state`, an
-- axis rather than a value — so a claim on it would have nothing to protect.
--
-- NOT NULL with a default here, where `experiences.curated_fields` is nullable
-- and read through `?? []`. The guards below are SQL, and `jsonb ? 'name'` on a
-- NULL is NULL rather than false: a nullable column would silently take the
-- source's value on every row that had never been claimed, which is every row.
--
-- Apply:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/027-contents-claims.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_locations
    ADD COLUMN IF NOT EXISTS curated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN experience_locations.curated_fields IS
    'Column names a curator has claimed on this point: name, location. The sync keeps the stored value for each, the way it does for an experience (#488). Never external_ref or ordinal — those are the source''s handle on the row and its place in the source''s list, and a claim on them would break the pairing that decides whether a point moved or was replaced.';

ALTER TABLE treasures
    ADD COLUMN IF NOT EXISTS curated_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN treasures.curated_fields IS
    'Column names a curator has claimed on this work: name, artist, year, image_url. Not sitelinks_count or is_iconic, which are a measurement and a threshold rather than a judgement, and not external_id, which is identity.';

COMMIT;

-- What this migration deliberately does not do: backfill. An empty array is the
-- honest state of every row — see the measurement above — and a claim invented
-- from a difference between the stored value and the source would be a verdict
-- nobody gave.
