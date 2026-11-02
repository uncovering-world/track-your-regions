-- 202-a-place-holding-works-is-never-crowded-out.sql
--
-- A crowded city shows the ten best-known places of a kind and type within
-- 10 km (ADR-0172). Fame reads a place's own article, not what hangs inside
-- it, so five churches of Rome holding works a reader is shown were in the
-- tail on 2026-11-02: San Luigi dei Francesi (three Caravaggios), Santa Maria
-- della Vittoria (Bernini's Ecstasy of Saint Teresa), Santa Maria in
-- Cosmedin, Sant'Agostino in Campo Marzio, Sant'Alfonso all'Esquilino. A
-- place holding such a work is now never crowded out and does not take one
-- of the ten (ADR-0173, #2245); the schema recounts around a place when what
-- it holds changes, and this migration recounts the whole catalogue once.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent or replaced.

\set ON_ERROR_STOP on

BEGIN;

-- Does the place hold a work a reader is shown: a link the source still
-- places, neither the link nor the work unread (ADR-0044, ADR-0025). Such a
-- place is never crowded out and does not take one of the ten, since what
-- hangs inside it is not in the fame of its own article (ADR-0173): San
-- Luigi dei Francesi, known for three Caravaggios, ranks under fifteen
-- churches of Rome known for themselves. experienceRegionQuery.ts counts the
-- same set as the row's works-inside mark (treasure_count).
CREATE OR REPLACE FUNCTION place_shows_works(place integer) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (
    SELECT 1 FROM experience_treasures et
      JOIN treasures t ON t.id = et.treasure_id
     WHERE et.experience_id = place AND et.missing_since IS NULL
       AND et.curation_state <> 'pending' AND t.curation_state <> 'pending')
$$;

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
     AND (near IS NULL
          OR (ce.location && crowding_box(near, k.crowding_radius_km)
              AND ST_DWithin(ce.location::geography, near::geography, k.crowding_radius_km * 1000)))
     AND n.better >= k.crowding_limit
     AND NOT place_shows_works(ce.id)
  ON CONFLICT (membership_id) DO UPDATE SET outranked_by = EXCLUDED.outranked_by, computed_at = NOW();
END $$;

-- What a place holds changes: recount around it, when it is a candidate of a
-- kind that declares the rule. A run's works pass writes links of museums by
-- the thousand; the guard keeps those from recounting anything. Separate
-- functions per table, so neither reads a field the other's row lacks.
CREATE OR REPLACE FUNCTION crowding_recount_place(place integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE point geometry;
BEGIN
  SELECT e.location INTO point FROM experiences e
   WHERE e.id = place AND e.location IS NOT NULL
     AND EXISTS (SELECT 1 FROM experience_kind_memberships m
                   JOIN experience_kinds k ON k.id = m.kind_id AND k.crowding_limit IS NOT NULL
                  WHERE m.experience_id = e.id);
  IF point IS NOT NULL THEN PERFORM recount_crowding(point); END IF;
END $$;

CREATE OR REPLACE FUNCTION crowding_follows_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM crowding_recount_place(OLD.experience_id); END IF;
  IF TG_OP = 'INSERT' THEN PERFORM crowding_recount_place(NEW.experience_id); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.experience_id IS DISTINCT FROM OLD.experience_id THEN PERFORM crowding_recount_place(NEW.experience_id); END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS crowding_follows_link_change ON experience_treasures;
CREATE CONSTRAINT TRIGGER crowding_follows_link_change
  AFTER UPDATE OF missing_since, curation_state, experience_id, treasure_id ON experience_treasures
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN ((OLD.missing_since IS NULL) IS DISTINCT FROM (NEW.missing_since IS NULL)
        OR (OLD.curation_state = 'pending') IS DISTINCT FROM (NEW.curation_state = 'pending')
        OR OLD.experience_id IS DISTINCT FROM NEW.experience_id OR OLD.treasure_id IS DISTINCT FROM NEW.treasure_id)
  EXECUTE FUNCTION crowding_follows_link();

DROP TRIGGER IF EXISTS crowding_follows_link_insert ON experience_treasures;
CREATE CONSTRAINT TRIGGER crowding_follows_link_insert
  AFTER INSERT OR DELETE ON experience_treasures
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION crowding_follows_link();

-- A work is passed by a curator: recount around every place that holds it.
CREATE OR REPLACE FUNCTION crowding_follows_work() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE place integer;
BEGIN
  FOR place IN SELECT et.experience_id FROM experience_treasures et WHERE et.treasure_id = NEW.id LOOP
    PERFORM crowding_recount_place(place);
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS crowding_follows_work_change ON treasures;
CREATE CONSTRAINT TRIGGER crowding_follows_work_change
  AFTER UPDATE OF curation_state ON treasures
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN ((OLD.curation_state = 'pending') IS DISTINCT FROM (NEW.curation_state = 'pending'))
  EXECUTE FUNCTION crowding_follows_work();

SELECT recount_crowding(NULL);

COMMIT;
