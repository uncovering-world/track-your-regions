-- 256-only-a-places-end-hides-it.sql
--
-- Whether a place still stands is its end (#1719, ADR-0214 decision 3): a
-- row of place_dates in the slot ended, written by a curator's answer that
-- the place is gone or by the rule that reads it as gone. experiences.existence,
-- the curator's extant or lost that the end replaces, goes, with its CHECK and
-- its index (idx_experiences_existence).
--
-- A place a curator called lost keeps that answer as an end with no year,
-- from Curators (11), decided by whoever decided it, so no gone place comes
-- back. On the development catalogue on 2026-11-15 every one of its 24,992
-- places read extant.
--
-- The crowding functions asked existence of a candidate; they ask the end
-- now, and an end written or taken back recounts around its place
-- (crowding_follows_end), where a change of existence did
-- (crowding_follows_place_change, which keeps the location alone).
--
-- One transaction, re-runnable: the ends are written where missing, the
-- trigger and the functions replaced, the column dropped if present. The
-- trigger on experiences is replaced before the column goes, since it names
-- it; the ends are written last, after every change of shape, as place_dates
-- carries a deferred trigger.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE lost_places ON COMMIT DROP AS
SELECT id, state_decided_by FROM experiences WHERE false;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'experiences' AND column_name = 'existence') THEN
    EXECUTE 'INSERT INTO lost_places SELECT id, state_decided_by FROM experiences WHERE existence = ''lost''';
  END IF;
END $do$;

DROP TRIGGER IF EXISTS crowding_follows_place_change ON experiences;
CREATE CONSTRAINT TRIGGER crowding_follows_place_change
  AFTER UPDATE OF location ON experiences
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.location IS DISTINCT FROM NEW.location)
  EXECUTE FUNCTION crowding_follows_place();

ALTER TABLE experiences DROP COLUMN IF EXISTS existence;

CREATE OR REPLACE FUNCTION crowding_above(
  of_kind integer, of_type text, of_member integer, at_point geometry, within_km double precision, above_score real
) RETURNS TABLE (membership_id integer)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT d.id
    FROM source_records d
    JOIN experiences de ON de.id = d.experience_id
    LEFT JOIN membership_fame df ON df.membership_id = d.id
   WHERE d.kind_id = of_kind AND d.type IS NOT DISTINCT FROM of_type AND d.id <> of_member
     AND de.location && crowding_box(at_point, within_km)
     AND ST_DWithin(de.location::geography, at_point::geography, within_km * 1000)
     AND d.admission <> 'refused'
     AND NOT EXISTS (SELECT 1 FROM place_dates gone WHERE gone.experience_id = de.id AND gone.slot = 'ended')
     AND d.crowding_pin IS DISTINCT FROM 'shadow'
     AND (d.crowding_pin = 'list' OR df.score > above_score)
     AND NOT place_shows_works(de.id)
$$;

CREATE OR REPLACE FUNCTION recount_crowding(near geometry DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(2201, 0);

  DELETE FROM membership_crowding mc
   USING source_records m, experiences e, experience_kinds k
   WHERE mc.membership_id = m.id AND e.id = m.experience_id AND k.id = m.kind_id
     AND (near IS NULL OR k.crowding_radius_km IS NULL
          OR (e.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(e.location::geography, near::geography, k.crowding_radius_km * 1000)));

  INSERT INTO membership_crowding (membership_id, outranked_by)
  SELECT c.id, n.better
    FROM source_records c
    JOIN experience_kinds k ON k.id = c.kind_id AND k.crowding_limit IS NOT NULL
    JOIN experiences ce ON ce.id = c.experience_id
    LEFT JOIN membership_fame cf ON cf.membership_id = c.id
    CROSS JOIN LATERAL crowding_better(c.kind_id, c.type, c.id, ce.location, k.crowding_radius_km, cf.score) n
   WHERE c.admission <> 'refused' AND ce.location IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM place_dates gone WHERE gone.experience_id = ce.id AND gone.slot = 'ended')
     AND (c.type IS NULL OR c.type <> ALL(k.crowding_exempt_types))
     AND (near IS NULL
          OR (ce.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(ce.location::geography, near::geography, k.crowding_radius_km * 1000)))
     AND NOT place_shows_works(ce.id)
     AND c.crowding_pin IS DISTINCT FROM 'list'
     AND (c.crowding_pin = 'shadow' OR cf.score IS NOT NULL)
     AND (c.crowding_pin = 'shadow' OR n.better >= k.crowding_limit)
  ON CONFLICT (membership_id) DO UPDATE SET outranked_by = EXCLUDED.outranked_by, computed_at = NOW();
END $$;

CREATE OR REPLACE FUNCTION refresh_crowding() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE crowded integer;
BEGIN
  WITH candidates AS (
    SELECT f.membership_id, m.kind_id, m.type, f.readers, f.guide_editions, f.wikipedia_editions
      FROM membership_fame f
      JOIN source_records m ON m.id = f.membership_id
      JOIN experience_kinds k ON k.id = m.kind_id AND k.crowding_limit IS NOT NULL
      JOIN experiences e ON e.id = m.experience_id
     WHERE m.admission <> 'refused' AND e.location IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM place_dates gone WHERE gone.experience_id = e.id AND gone.slot = 'ended')
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

CREATE OR REPLACE FUNCTION crowding_follows_end() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF OLD.slot = 'ended' THEN PERFORM crowding_recount_place(OLD.experience_id); END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.slot = 'ended' THEN PERFORM crowding_recount_place(NEW.experience_id); END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.slot = 'ended' AND (OLD.slot <> 'ended' OR OLD.experience_id <> NEW.experience_id) THEN
      PERFORM crowding_recount_place(NEW.experience_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS crowding_follows_end_change ON place_dates;
CREATE CONSTRAINT TRIGGER crowding_follows_end_change
  AFTER INSERT OR DELETE OR UPDATE OF slot, experience_id ON place_dates
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION crowding_follows_end();

INSERT INTO place_dates (experience_id, slot, source_id, decided_by)
SELECT l.id, 'ended', 11, l.state_decided_by
  FROM lost_places l
ON CONFLICT (experience_id, slot) DO NOTHING;

COMMIT;
