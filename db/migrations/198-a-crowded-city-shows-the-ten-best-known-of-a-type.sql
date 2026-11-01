-- 198-a-crowded-city-shows-the-ten-best-known-of-a-type.sql
--
-- A city with many places of one type flooded a reader's list and map: 85
-- places of worship within 10 km of central Rome on the development catalogue
-- of 2026-11-01, listed by name. A place is now shown unless ten places of the
-- same kind and type within 10 km of it are better known (ADR-0172, #2201).
-- The kind declares the rule (crowding_limit, crowding_radius_km); a
-- membership's signals and its blended fame are membership_fame, written by
-- the run's after-step; the memberships crowded out are membership_crowding,
-- recounted around a place whenever its candidacy changes and in full after
-- every run. A membership absent from membership_crowding is shown, so a
-- recount that never happened hides nothing.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent or replaced.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kinds ADD COLUMN IF NOT EXISTS crowding_limit INTEGER CHECK (crowding_limit > 0);
ALTER TABLE experience_kinds ADD COLUMN IF NOT EXISTS crowding_radius_km REAL CHECK (crowding_radius_km > 0);
DO $$ BEGIN
  ALTER TABLE experience_kinds ADD CONSTRAINT experience_kinds_crowding_whole
    CHECK ((crowding_limit IS NULL) = (crowding_radius_km IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON COLUMN experience_kinds.crowding_limit IS 'How many better-known places of the same kind and type within crowding_radius_km crowd a place out of what a reader is shown (ADR-0172). Null: the kind shows every place it admits.';
COMMENT ON COLUMN experience_kinds.crowding_radius_km IS 'The radius crowding_limit is counted within, in kilometres (ADR-0172). Set with crowding_limit or not at all.';

-- The six kinds #2177 measured. Art Museums, Archaeology and World Heritage
-- Sites are measured before they take the rule.
UPDATE experience_kinds SET crowding_limit = 10, crowding_radius_km = 10
 WHERE id IN (3, 4, 6, 7, 8, 9) AND crowding_limit IS NULL;

CREATE TABLE IF NOT EXISTS membership_fame (
    membership_id INTEGER PRIMARY KEY REFERENCES experience_kind_memberships(id) ON DELETE CASCADE,
    readers INTEGER NOT NULL CHECK (readers >= 0),
    guide_editions INTEGER NOT NULL CHECK (guide_editions >= 0),
    wikipedia_editions INTEGER NOT NULL CHECK (wikipedia_editions >= 0),
    score REAL CHECK (score >= 0 AND score <= 1),
    measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE membership_fame IS 'How well known a membership''s place is, for a kind that declares crowding_limit (ADR-0172): the readership year''s readers, the Wikivoyage editions that use its item and its Wikipedia editions, read from the workbench by the run''s after-step, so no reader touches the workbench.';
COMMENT ON COLUMN membership_fame.score IS 'The mean of the three signals'' percentiles among the candidates of the same kind and type worldwide, set by refresh_crowding(). Null for a membership that is no candidate (refused, or its place lost), or one measured since the last refresh.';

CREATE TABLE IF NOT EXISTS membership_crowding (
    membership_id INTEGER PRIMARY KEY REFERENCES experience_kind_memberships(id) ON DELETE CASCADE,
    outranked_by INTEGER NOT NULL CHECK (outranked_by > 0),
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE membership_crowding IS 'The memberships crowded out of what a reader is shown (ADR-0172): crowding_limit or more candidates of the same kind and type within crowding_radius_km score higher. Absent means shown. A reader finds a crowded-out place by search and opens its card; no list, map or count holds it.';
COMMENT ON COLUMN membership_crowding.outranked_by IS 'How many better-known candidates of its kind and type lie within the radius.';

-- The box around a point holding every point within km of it, in degrees, so
-- the GiST index on experiences.location finds the neighbours before the
-- exact distance is measured. Generous on purpose: 110 km to a degree.
CREATE OR REPLACE FUNCTION crowding_box(point geometry, km double precision) RETURNS geometry
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ST_Expand(point, km / (110.0 * GREATEST(cos(radians(ST_Y(point))), 0.01)), km / 110.0)
$$;

-- Recount the crowded-out memberships of every place within its kind's radius
-- of `near`, or of the whole catalogue when `near` is null. A candidate is an
-- admitted membership of a kind that declares the rule, on a place that is
-- not lost and has a point, with a score; db/membership.ts states the same
-- set (membershipAdmittedSql, hideLostSql).
--
-- One recount at a time, until its transaction ends: two whose areas overlap
-- would each delete what the other has not committed and insert the same
-- membership twice. Under the lock every statement after it sees what the
-- previous recount committed. The key's class is #2201, as a place
-- identifier's is #1143 (lock_place_identifier_keys).
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
    ) n
   WHERE c.admission <> 'refused' AND ce.existence <> 'lost' AND ce.location IS NOT NULL
     AND (near IS NULL
          OR (ce.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(ce.location::geography, near::geography, k.crowding_radius_km * 1000)))
     AND n.better >= k.crowding_limit
  ON CONFLICT (membership_id) DO UPDATE SET outranked_by = EXCLUDED.outranked_by, computed_at = NOW();
END $$;

-- Score every candidate among its kind and type worldwide, then recount the
-- whole catalogue: what the run's after-step calls once the fame is written.
-- Answers how many memberships are crowded out.
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
           + percent_rank() OVER (PARTITION BY kind_id, type ORDER BY guide_editions)
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

-- A membership's candidacy changes: recount around its place. An insert
-- changes nothing, since a membership has no score until the next refresh.
-- Separate functions per table, so neither reads a field the other's row lacks.
-- The triggers are deferred to the commit: the recount's lock is then held for
-- the last moment of a transaction rather than across a run's sweep, which
-- goes on locking memberships a curator's write may be waiting on.
CREATE OR REPLACE FUNCTION crowding_follows_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE point geometry;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF EXISTS (SELECT 1 FROM experience_kinds WHERE id = OLD.kind_id AND crowding_limit IS NOT NULL) THEN
      SELECT location INTO point FROM experiences WHERE id = OLD.experience_id;
      IF point IS NOT NULL THEN PERFORM recount_crowding(point); END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.experience_id IS DISTINCT FROM OLD.experience_id OR NEW.kind_id IS DISTINCT FROM OLD.kind_id)
       AND EXISTS (SELECT 1 FROM experience_kinds WHERE id = NEW.kind_id AND crowding_limit IS NOT NULL) THEN
      SELECT location INTO point FROM experiences WHERE id = NEW.experience_id;
      IF point IS NOT NULL THEN PERFORM recount_crowding(point); END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS crowding_follows_membership_change ON experience_kind_memberships;
CREATE CONSTRAINT TRIGGER crowding_follows_membership_change
  AFTER UPDATE OF admission, type, kind_id, experience_id ON experience_kind_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.admission IS DISTINCT FROM NEW.admission OR OLD.type IS DISTINCT FROM NEW.type
        OR OLD.kind_id IS DISTINCT FROM NEW.kind_id OR OLD.experience_id IS DISTINCT FROM NEW.experience_id)
  EXECUTE FUNCTION crowding_follows_membership();

DROP TRIGGER IF EXISTS crowding_follows_membership_delete ON experience_kind_memberships;
CREATE CONSTRAINT TRIGGER crowding_follows_membership_delete
  AFTER DELETE ON experience_kind_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION crowding_follows_membership();

-- A place is lost, found again, moved or deleted: recount where it was and
-- where it is.
CREATE OR REPLACE FUNCTION crowding_follows_place() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.location IS NOT NULL THEN PERFORM recount_crowding(OLD.location); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.location IS NOT NULL AND NEW.location IS DISTINCT FROM OLD.location THEN
      PERFORM recount_crowding(NEW.location);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS crowding_follows_place_change ON experiences;
CREATE CONSTRAINT TRIGGER crowding_follows_place_change
  AFTER UPDATE OF existence, location ON experiences
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.existence IS DISTINCT FROM NEW.existence OR OLD.location IS DISTINCT FROM NEW.location)
  EXECUTE FUNCTION crowding_follows_place();

DROP TRIGGER IF EXISTS crowding_follows_place_delete ON experiences;
CREATE CONSTRAINT TRIGGER crowding_follows_place_delete
  AFTER DELETE ON experiences
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION crowding_follows_place();

COMMIT;
