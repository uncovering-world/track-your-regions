-- 210-archaeologys-sites-take-the-crowding-and-its-museums-do-not.sql
--
-- A crowded city shows a place unless ten better-known places of its kind and
-- type stand within 10 km (ADR-0172). Archaeology now admits its sites by the
-- place kinds' frame (ADR-0179), so its sites take the rule as the six kinds
-- do, and its runs' after-step fills membership_fame for it, which a site run
-- that cannot read a signal admits by (ADR-0175 decision 6).
--
-- Its museums do not. A museum enters Archaeology for what it is and for the
-- finds it holds (ADR-0058), and a place holding a work a reader is shown is
-- never crowded out (ADR-0173). On 2026-11-02, 62 of the 126 museums the kind
-- holds showed no find yet, the Bardo, the Gold Museum in Bogota and the Grand
-- Egyptian Museum among them: ranked by their own articles they would compete
-- for ten seats a museum is not admitted by. A kind names the types it exempts
-- (experience_kinds.crowding_exempt_types); an exempt type is never scored,
-- never crowded out and takes none of the ten.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: the column is added if absent, the functions are replaced, and
-- the kind takes the rule only where it declares none.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kinds ADD COLUMN IF NOT EXISTS crowding_exempt_types TEXT[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN experience_kinds.crowding_exempt_types IS 'The types of the kind a crowded city never hides and that take none of the ten: a type the kind admits for the works it holds, which its own article''s fame does not measure (ADR-0179). Archaeology''s museums, admitted works-first (ADR-0058), half of them holding no find the catalogue shows yet. Empty: every type is counted.';
COMMENT ON COLUMN membership_fame.score IS 'The mean of three percentiles among the candidates of the same kind and type worldwide, set by refresh_crowding(): readers a year, whether a Wikivoyage edition uses the item (a presence, not a count, ADR-0177), and Wikipedia editions. Null for a membership that is no candidate (refused, its place lost, or of a type its kind exempts, ADR-0179), or one measured since the last refresh.';

-- Recount the crowded-out memberships within a kind's radius of near, or of
-- the whole catalogue: as migration 202 declared it, less the memberships of
-- a type their kind exempts.
CREATE OR REPLACE FUNCTION recount_crowding(near geometry DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(2201, 0);

  DELETE FROM membership_crowding mc
   USING experience_kind_memberships m, experiences e, experience_kinds k
   WHERE mc.membership_id = m.id AND e.id = m.experience_id AND k.id = m.kind_id
     AND (near IS NULL OR k.crowding_radius_km IS NULL
          OR (e.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(e.location::geography, near::geography, k.crowding_radius_km * 1000)));

  INSERT INTO membership_crowding (membership_id, outranked_by)
  SELECT c.id, n.better
    FROM experience_kind_memberships c
    JOIN experience_kinds k ON k.id = c.kind_id AND k.crowding_limit IS NOT NULL
    JOIN experiences ce ON ce.id = c.experience_id
    JOIN membership_fame cf ON cf.membership_id = c.id AND cf.score IS NOT NULL
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS better
        FROM experiences de
        JOIN experience_kind_memberships d ON d.experience_id = de.id AND d.kind_id = c.kind_id
                                          AND d.type IS NOT DISTINCT FROM c.type AND d.id <> c.id
        JOIN membership_fame df ON df.membership_id = d.id AND df.score > cf.score
       WHERE de.location && crowding_box(ce.location, k.crowding_radius_km)
         AND ST_DWithin(de.location::geography, ce.location::geography, k.crowding_radius_km * 1000)
         AND d.admission <> 'refused' AND de.existence <> 'lost'
         AND NOT place_shows_works(de.id)
    ) n
   WHERE c.admission <> 'refused' AND ce.existence <> 'lost' AND ce.location IS NOT NULL
     AND (c.type IS NULL OR c.type <> ALL(k.crowding_exempt_types))
     AND (near IS NULL
          OR (ce.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(ce.location::geography, near::geography, k.crowding_radius_km * 1000)))
     AND n.better >= k.crowding_limit
     AND NOT place_shows_works(ce.id)
  ON CONFLICT (membership_id) DO UPDATE SET outranked_by = EXCLUDED.outranked_by, computed_at = NOW();
END $$;

-- Score every candidate among its kind and type worldwide, then recount the
-- whole catalogue: as migration 204 declared it, less the exempt types, which
-- are scored null.
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
       AND (m.type IS NULL OR m.type <> ALL(k.crowding_exempt_types))
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

UPDATE experience_kinds SET crowding_limit = 10, crowding_radius_km = 10
 WHERE id = 5 AND crowding_limit IS NULL;
-- Apart from the limit, so a kind already given one still exempts its museums.
UPDATE experience_kinds SET crowding_exempt_types = '{museum}' WHERE id = 5;

COMMIT;
