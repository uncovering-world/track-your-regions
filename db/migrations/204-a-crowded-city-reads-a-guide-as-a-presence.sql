-- 204-a-crowded-city-reads-a-guide-as-a-presence.sql
--
-- A crowded city shows a place unless ten better-known places of its kind and
-- type stand within 10 km (ADR-0172). Fame was the mean of three percentile
-- ranks, one of them the count of Wikivoyage editions that use the item. That
-- count is coarse, 0 to 7 for Rome's churches, and a guide that names a place
-- under another item gives it 0, so each step of it moved the mean by a large
-- step: the Ortakoy Mosque, 106,612 readers and 37 editions, sat under eleven
-- mosques for its two guides, and Saint Paul outside the Walls under Santa
-- Maria in Trastevere. Fame now reads whether a guide uses the item, not how
-- many do (ADR-0177, #2262). Measured at ADR-0175's point, it hides 16 of the
-- surveys' demanded places instead of 20, at the same noise. This migration
-- rescores and recounts the catalogue once.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: the function is replaced and the refresh recomputes.

\set ON_ERROR_STOP on

BEGIN;

COMMENT ON COLUMN membership_fame.score IS 'The mean of three percentiles among the candidates of the same kind and type worldwide, set by refresh_crowding(): readers a year, whether a Wikivoyage edition uses the item (a presence, not a count, ADR-0177), and Wikipedia editions. Null for a membership that is no candidate (refused, or its place lost), or one measured since the last refresh.';

CREATE OR REPLACE FUNCTION refresh_crowding() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE crowded integer;
BEGIN
  WITH candidates AS (
    SELECT f.membership_id, m.kind_id, m.type, f.readers, f.guide_editions, f.wikipedia_editions
      FROM membership_fame f
      JOIN experience_kind_memberships m ON m.id = f.membership_id
      JOIN experience_kinds k ON k.id = m.kind_id AND k.crowding_limit IS NOT NULL
      JOIN experiences e ON e.id = m.experience_id
     WHERE m.admission <> 'refused' AND e.existence <> 'lost' AND e.location IS NOT NULL
  ), scored AS (
    SELECT membership_id,
           ((percent_rank() OVER (PARTITION BY kind_id, type ORDER BY readers)
           + percent_rank() OVER (PARTITION BY kind_id, type ORDER BY guide_editions > 0)
           + percent_rank() OVER (PARTITION BY kind_id, type ORDER BY wikipedia_editions)) / 3)::real AS score
      FROM candidates
  )
  UPDATE membership_fame f SET score = s.score
    FROM membership_fame f2 LEFT JOIN scored s ON s.membership_id = f2.membership_id
   WHERE f.membership_id = f2.membership_id AND f.score IS DISTINCT FROM s.score;

  PERFORM recount_crowding(NULL);
  SELECT count(*) INTO crowded FROM membership_crowding;
  RETURN crowded;
END $$;

SELECT refresh_crowding();

COMMIT;
