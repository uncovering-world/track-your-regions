-- 015: wipe the museum category once, before the first works-first run.
--
-- The rows currently in category 2 were selected by asking which Wikidata entity owns famous
-- paintings, which produced four curatorial departments of the Louvre and no Louvre. The
-- treasure links behind them cannot be cleaned by a sync, because unlinking is deliberately
-- unimplemented until a contents coverage floor exists. Whether anyone's records stand in the
-- way is not this header's judgement to make: the guard below refuses the wipe outright if a
-- single curation entry, visit or viewed-treasure record exists for the category.
--
-- The sync itself still marks rather than deletes (ADR-0022). This is a one-off.
--
-- Order: no dependency on 01-schema.sql re-application — this is DML only, no DDL and no seed
-- row touched. It does need to run before the first works-first sync repopulates category 2:
-- the guard below checks volume, not whether this file has already run, so re-running it once
-- fresh rows exist would wipe them too if they happen to still be under the same thresholds —
-- which a just-imported row always is, since it starts with no visits and no curation by
-- definition. This file is a one-time manual action, not a repeatable step.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/015-museum-clean-slate.sql

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  category_name text;
  curated integer;
  visits integer;
  location_visits integer;
  viewed_treasures integer;
BEGIN
  -- Ids come from SERIAL and seed insertion order; nothing else pins 2 to this category.
  -- Migration 014 guards the same ambiguity before an UPDATE — this file is a DELETE.
  SELECT name INTO category_name FROM experience_categories WHERE id = 2;
  IF category_name IS DISTINCT FROM 'Top Art Museums' THEN
    RAISE EXCEPTION 'refusing to wipe: category 2 is not Top Art Museums (found %)', category_name;
  END IF;

  SELECT count(*) INTO curated
    FROM experience_curation_log l JOIN experiences e ON e.id = l.experience_id
   WHERE e.category_id = 2;
  SELECT count(*) INTO visits
    FROM user_visited_experiences v JOIN experiences e ON e.id = v.experience_id
   WHERE e.category_id = 2;
  -- A location can be visited without the parent experience ever being marked
  -- visited (unmarkVisited() only deletes from user_visited_experiences), so this
  -- has to be counted separately or it is invisible to the guard.
  SELECT count(*) INTO location_visits
    FROM user_visited_locations uvl
    JOIN experience_locations el ON el.id = uvl.location_id
    JOIN experiences e ON e.id = el.experience_id
   WHERE e.category_id = 2;

  -- The table the deletion below reaches furthest, and the easiest one to miss.
  -- A viewed treasure is not a visit to anything: `POST
  -- /api/users/me/viewed-treasures/:id` records it with no experience id at all,
  -- so a person can have logged forty artworks while both counts above read
  -- zero. `user_viewed_treasures.treasure_id` cascades, and the orphan sweep at
  -- the bottom deletes exactly the treasures those records point at.
  SELECT count(*) INTO viewed_treasures
    FROM user_viewed_treasures uvt
    JOIN experience_treasures et ON et.treasure_id = uvt.treasure_id
    JOIN experiences e ON e.id = et.experience_id
   WHERE e.category_id = 2;

  IF curated > 0 THEN
    RAISE EXCEPTION 'refusing to wipe: % curation-log entries exist for museums', curated;
  END IF;
  -- Zero, not a tolerance. Any non-zero threshold here is a statement that some
  -- number of people's records are expendable, which is an owner's decision to
  -- make out loud rather than a constant to inherit. Where a database does hold
  -- such records this file is meant to stop and be argued with.
  IF visits > 0 THEN
    RAISE EXCEPTION 'refusing to wipe: % user visits exist for museums', visits;
  END IF;
  IF location_visits > 0 THEN
    RAISE EXCEPTION 'refusing to wipe: % user visits to individual locations exist for museums', location_visits;
  END IF;
  IF viewed_treasures > 0 THEN
    RAISE EXCEPTION 'refusing to wipe: % viewed-treasure records exist for museums', viewed_treasures;
  END IF;
END $$;

-- Which treasures this category holds, captured before the cascade removes the
-- links that say so. Without it the sweep below can only ask "is anything
-- linked to this treasure", which is also true of a treasure that belonged to
-- another category and was orphaned by something else entirely.
CREATE TEMP TABLE museum_treasures ON COMMIT DROP AS
SELECT DISTINCT et.treasure_id
  FROM experience_treasures et
  JOIN experiences e ON e.id = et.experience_id
 WHERE e.category_id = 2;

-- experience_locations, experience_location_regions, experience_treasures and
-- user_visited_experiences all cascade from experiences.
DELETE FROM experiences WHERE category_id = 2;

-- treasures are global by external_id, so the junction table cascade leaves them
-- orphaned. Scoped to what this category held: unscoped, the statement is a
-- global orphan sweep that happens to be running inside a museum migration, and
-- its blast radius is every category at once.
DELETE FROM treasures t
 USING museum_treasures m
 WHERE t.id = m.treasure_id
   AND NOT EXISTS (SELECT 1 FROM experience_treasures et WHERE et.treasure_id = t.id);

COMMIT;
