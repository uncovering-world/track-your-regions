-- 132-one-active-suggestion-per-region-and-division.sql
--
-- A world-view import offers a region one active suggestion per GADM
-- division (#1620). The development database enforced that with a unique
-- index no file declared, so a database built from db/init/01-schema.sql
-- stored the duplicates the dev database refused: the geoshape matcher's
-- 414 failures in #1619 were that index refusing a division offered twice.
--
-- The writers keep the rule: the per-region matchers skip a division already
-- suggested, rejected or assigned; the whole-tree passes write after an
-- import or a re-match cleared the world view; grouping, which keeps a
-- region's rejections, skips the divisions they name; the copies and undos
-- clear the region first, and merging a child into its parent drops the
-- parent's copy of a division the child holds. The index makes the rule hold
-- for two writers racing on one region too.
--
-- A rejected suggestion stays outside the index: the rejection is what keeps
-- a division from being suggested again, and the matchers read it for that.
-- `rejected` becomes NOT NULL, since a NULL would escape both the index and
-- every reader, which ask `rejected = false` or `rejected = true`.
--
-- Each region and division is brought down to one row, and the count removed
-- is reported. A rejection wins over an active copy, since the rejection is
-- the curator's decision; among copies of one kind the highest score stays,
-- the lowest id on a tie. One row per pair also keeps the geo-similarity
-- step's un-reject of a region's suggestions inside the index. Re-runnable:
-- the index is made only where missing, and the dev database already holds it.

\set ON_ERROR_STOP on

BEGIN;

UPDATE region_match_suggestions SET rejected = false WHERE rejected IS NULL;
ALTER TABLE region_match_suggestions ALTER COLUMN rejected SET NOT NULL;

DO $$
DECLARE
  removed INTEGER;
BEGIN
  WITH ranked AS (
    SELECT id, row_number() OVER (
      PARTITION BY region_id, division_id ORDER BY rejected DESC, score DESC NULLS LAST, id
    ) AS rank
    FROM region_match_suggestions
  )
  DELETE FROM region_match_suggestions s USING ranked r
  WHERE s.id = r.id AND r.rank > 1;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'region_match_suggestions: % duplicate suggestion(s) removed', removed;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_region_match_suggestions_active_unique
  ON region_match_suggestions (region_id, division_id) WHERE rejected = false;

COMMIT;
