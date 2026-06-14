-- Migration 007: Deduplicate active region_match_suggestions and enforce one
-- active suggestion per (region_id, division_id).
--
-- ~10 finder/matcher insert sites accumulated duplicate suggestion rows for the
-- same division (e.g. matcher score 700 + geoshape score 996 for the same
-- country). This cleans existing active dups (keeping the highest score, then
-- the lowest id) and adds a partial unique index so future inserts dedup via
-- ON CONFLICT. Rejected rows are history and not constrained.
--
-- Idempotent: the DELETE is a no-op once unique; CREATE INDEX IF NOT EXISTS.

DELETE FROM region_match_suggestions a
USING region_match_suggestions b
WHERE a.rejected = false AND b.rejected = false
  AND a.region_id = b.region_id
  AND a.division_id = b.division_id
  AND (a.score < b.score OR (a.score = b.score AND a.id > b.id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_region_match_suggestions_active_unique
  ON region_match_suggestions (region_id, division_id)
  WHERE rejected = false;
