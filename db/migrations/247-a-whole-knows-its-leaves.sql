-- 247-a-whole-knows-its-leaves.sql
--
-- A whole knows its leaves (#2121, ADR-0206): whole_leaves holds, for every
-- place made of parts, the places at the bottom of its parts at any depth,
-- each once, with whether a reader is shown one of its points. A whole's
-- "k of N" counts these: the Struve Geodetic Arc's 34 stations wherever the
-- Arc is listed, Fujisan's 25 places with an Oshino Hakkai of 8 inside it
-- keeping its own count once a curator nests it.
--
-- refresh_whole_leaves() is the table's one writer, called by statement
-- triggers on experience_parts and experience_locations. It is not part of
-- refresh_place_regions(): the two read the same inputs, take the same region
-- keys, and neither calls the other.
--
-- The backfill writes every whole's rows once. On the development catalogue
-- (2026-11-15) that is 5,620 rows for 482 wholes, none of them nested,
-- written in about a second on a copy of its places, points and parts.
--
-- Two transactions: the schema, short, then the backfill. Order-independent
-- with 01-schema.sql, which declares the same. Re-runnable: the table and its
-- indexes are created where missing, the functions and triggers replaced, and
-- a second backfill writes nothing.

\set ON_ERROR_STOP on

BEGIN;

-- Creating the triggers takes a lock on experience_parts and
-- experience_locations that holds their writers until this transaction
-- commits: a long transaction on either must not stall them behind it.
SET LOCAL lock_timeout = '10s';

-- whole_leaves holds, for every whole, the places at the bottom of its parts:
-- the Struve Geodetic Arc's 34 stations, Fujisan's 25 places with the 8
-- Oshino Hakkai ponds among them where Oshino Hakkai is a whole of its own.
-- A leaf is a place, not a point, so a part holding two points counts once,
-- and a whole's own points are not leaves. offered says whether a reader is
-- shown a point of the leaf. What a whole's "k of N" counts (#2121).
--
-- It is derived, and written by refresh_whole_leaves() alone, from the
-- triggers that follow a part relation and a point's state, under the same
-- region keys refresh_place_regions() takes: the two refreshes read the same
-- inputs and neither calls the other.
CREATE TABLE IF NOT EXISTS whole_leaves (
    whole_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    leaf_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    offered BOOLEAN NOT NULL,
    PRIMARY KEY (whole_id, leaf_id),
    CHECK (whole_id <> leaf_id)
);
CREATE INDEX IF NOT EXISTS idx_whole_leaves_leaf ON whole_leaves(leaf_id);
CREATE INDEX IF NOT EXISTS idx_whole_leaves_offered ON whole_leaves(whole_id) WHERE offered;
COMMENT ON TABLE whole_leaves IS 'The leaves of every whole (ADR-0206): the places reached down experience_parts, at any depth, that have no parts of their own, once per whole, each with whether a reader is shown one of its points (offered). Written by refresh_whole_leaves() alone, from the triggers that follow a part relation and a point''s state; what a whole''s k of N counts.';

-- The wholes above the places `places`, at any depth: the wholes they are
-- parts of, the wholes those are parts of, and so on. A part relation is
-- derived from records with no loop guard of their own (parts_follow_records),
-- so the walk carries its path and never steps onto a place already on it,
-- and stops eight levels up; a curator's word refuses a chain deeper than
-- four (partRecordController.ts, MOST_LEVELS).
CREATE OR REPLACE FUNCTION place_ancestors(places INTEGER[]) RETURNS SETOF INTEGER
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up (place_id, path) AS (
    SELECT prt.whole_id, ARRAY[prt.part_id, prt.whole_id]
      FROM experience_parts prt WHERE prt.part_id = ANY(places)
    UNION ALL
    SELECT prt.whole_id, up.path || prt.whole_id
      FROM up JOIN experience_parts prt ON prt.part_id = up.place_id
     WHERE NOT prt.whole_id = ANY(up.path) AND cardinality(up.path) <= 8)
  SELECT DISTINCT up.place_id FROM up
$$;
COMMENT ON FUNCTION place_ancestors(INTEGER[]) IS 'The wholes above these places at any depth, the places themselves left out (ADR-0206): cycle-safe, eight levels at most. What refresh_whole_leaves() locks and rewrites above a change.';

-- The rows the wholes `wholes` are expected to hold in whole_leaves; NULL
-- names every whole. The walk down is the walk up's mirror, with the same
-- path guard and depth. A leaf is a place that is no whole itself, so a
-- nested whole's leaves are its parent's too and the nested whole is not;
-- a place reached twice (a pond named a part of Fujisan and of Oshino Hakkai
-- inside it) is one row. Both ends are read from experiences, so a place
-- being deleted, whose relations the cascade has not reached yet, is no row.
-- The planner reads the walk as some forty times its size, and joined or
-- hashed every test below over the whole catalogue for a refresh of one
-- whole (65 ms for the Rock Art's 758 leaves); each is a probe per row
-- instead, written as a scalar subquery so no plan turns it into a join.
-- offered: one of the leaf's points is shown to a reader, the visible point
-- place_shown_points() places by: offeredLocationSql, not turned down
-- (ADR-0053), and publishedContentSql (backend/src/db/readerPredicates.ts),
-- held to these by placeRegionsSchema.test.ts.
CREATE OR REPLACE FUNCTION whole_leaves_expected(wholes INTEGER[])
RETURNS TABLE (whole_id INTEGER, leaf_id INTEGER, offered BOOLEAN)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE down (whole_id, place_id, path) AS (
    SELECT prt.whole_id, prt.part_id, ARRAY[prt.whole_id, prt.part_id]
      FROM experience_parts prt WHERE wholes IS NULL OR prt.whole_id = ANY(wholes)
    UNION ALL
    SELECT down.whole_id, prt.part_id, down.path || prt.part_id
      FROM down JOIN experience_parts prt ON prt.whole_id = down.place_id
     WHERE NOT prt.part_id = ANY(down.path) AND cardinality(down.path) <= 8),
  leaves AS (
    SELECT DISTINCT down.whole_id, down.place_id FROM down
     WHERE (SELECT true FROM experience_parts below WHERE below.whole_id = down.place_id LIMIT 1) IS NULL)
  SELECT leaves.whole_id, leaves.place_id,
         (SELECT true FROM experience_locations el
           WHERE el.experience_id = leaves.place_id
             AND el.missing_since IS NULL AND el.existence <> 'lost' AND el.merged_into_id IS NULL
             AND el.refused_at IS NULL AND el.curation_state <> 'pending'
           LIMIT 1) IS NOT NULL
    FROM leaves
   WHERE (SELECT true FROM experiences whole WHERE whole.id = leaves.whole_id) IS NOT NULL
     AND (SELECT true FROM experiences leaf WHERE leaf.id = leaves.place_id) IS NOT NULL
$$;
COMMENT ON FUNCTION whole_leaves_expected(INTEGER[]) IS 'The whole_leaves rows these wholes are expected to hold; NULL names every whole (ADR-0206): what refresh_whole_leaves() writes and the catalogue check whole-leaves-out-of-step compares.';

-- Rewrites the whole_leaves rows of every whole a change of the places
-- `places` reaches: the places themselves and every whole above them; NULL
-- names every whole, and every place holding rows. Writes only what differs,
-- and offers the insert only the rows that differ, so a refresh of a whole of
-- 758 leaves that changes one writes one, and a second call writes nothing.
-- Returns how many rows it wrote or removed.
--
-- It first takes the keys of what it rewrites, the ones lock_place_regions()
-- takes (ADR-0197): one key per place among 1,024 under 1197, in key order,
-- and the reach read again once they are held, until it holds still. Two
-- transactions changing two parts of one whole then compute its rows one
-- after the other, and a place being made a part while a point of it is
-- written waits for, and sees, the other's commit. The changed places are
-- locked whether they are wholes or not, since a part relation committed while
-- this waited may have put one under a whole. The keys are a superset of the
-- ones the region refresh takes for the same change, and the triggers calling
-- this are named to fire before the region triggers, so the region refresh
-- after it takes no key out of order.
CREATE OR REPLACE FUNCTION refresh_whole_leaves(places INTEGER[]) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  affected INTEGER[];
  wholes INTEGER[];
  held INTEGER[] := '{}';
  wanted INTEGER[];
  place_key INTEGER;
  written INTEGER;
BEGIN
  LOOP
    IF places IS NULL THEN
      affected := ARRAY(SELECT prt.whole_id FROM experience_parts prt
                        UNION SELECT wl.whole_id FROM whole_leaves wl);
    ELSE
      affected := ARRAY(SELECT p FROM unnest(places) AS p WHERE p IS NOT NULL
                        UNION SELECT place_ancestors(places));
    END IF;
    wanted := ARRAY(SELECT DISTINCT p % 1024 FROM unnest(affected) AS p
                     WHERE NOT (p % 1024) = ANY(held) ORDER BY 1);
    EXIT WHEN cardinality(wanted) = 0;
    FOREACH place_key IN ARRAY wanted LOOP
      PERFORM pg_advisory_xact_lock(1197, place_key);
    END LOOP;
    held := held || wanted;
  END LOOP;

  -- The wholes among them, and the places that held rows and may be none now.
  wholes := ARRAY(SELECT p FROM unnest(affected) AS p
                   WHERE EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.whole_id = p)
                      OR EXISTS (SELECT 1 FROM whole_leaves wl WHERE wl.whole_id = p));
  IF cardinality(wholes) = 0 THEN
    RETURN 0;
  END IF;

  WITH expected AS MATERIALIZED (
    SELECT x.whole_id, x.leaf_id, x.offered FROM whole_leaves_expected(wholes) x
  ),
  removed AS (
    DELETE FROM whole_leaves wl
     WHERE wl.whole_id = ANY(wholes)
       AND NOT EXISTS (SELECT 1 FROM expected x WHERE x.whole_id = wl.whole_id AND x.leaf_id = wl.leaf_id)
    RETURNING 1
  ),
  put AS (
    INSERT INTO whole_leaves AS wl (whole_id, leaf_id, offered)
    SELECT x.whole_id, x.leaf_id, x.offered FROM expected x
     WHERE NOT EXISTS (SELECT 1 FROM whole_leaves held
                        WHERE held.whole_id = x.whole_id AND held.leaf_id = x.leaf_id AND held.offered = x.offered)
     ORDER BY x.whole_id, x.leaf_id
    ON CONFLICT (whole_id, leaf_id) DO UPDATE SET offered = EXCLUDED.offered
     WHERE wl.offered IS DISTINCT FROM EXCLUDED.offered
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM removed) + (SELECT count(*) FROM put) INTO written;
  RETURN written;
END;
$$;
COMMENT ON FUNCTION refresh_whole_leaves(INTEGER[]) IS 'Rewrites the whole_leaves rows of these places and of every whole above them, as whole_leaves_expected() makes them, under their region keys (ADR-0206); NULL names every whole. Called by the triggers that follow a part relation and a point''s state.';

-- A part relation made, moved or taken away changes the leaves of its whole
-- and of every whole above it. Its part is locked too: a point of it being
-- written meanwhile decides whether it is offered. One refresh over the old
-- and the new relations together, so one statement takes its keys in one
-- order. Named to fire before trg_place_regions_part_*, whose keys are among
-- these.
CREATE OR REPLACE FUNCTION whole_leaves_follow_parts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  places INTEGER[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    places := ARRAY(SELECT n.whole_id FROM new_parts n UNION SELECT n.part_id FROM new_parts n);
  END IF;
  IF TG_OP = 'DELETE' THEN
    places := ARRAY(SELECT o.whole_id FROM old_parts o UNION SELECT o.part_id FROM old_parts o);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    places := ARRAY(SELECT n.whole_id FROM new_parts n UNION SELECT n.part_id FROM new_parts n
                    UNION SELECT o.whole_id FROM old_parts o UNION SELECT o.part_id FROM old_parts o);
  END IF;
  PERFORM refresh_whole_leaves(places);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_place_leaves_part_insert ON experience_parts;
CREATE TRIGGER trg_place_leaves_part_insert
  AFTER INSERT ON experience_parts
  REFERENCING NEW TABLE AS new_parts
  FOR EACH STATEMENT EXECUTE FUNCTION whole_leaves_follow_parts();
DROP TRIGGER IF EXISTS trg_place_leaves_part_update ON experience_parts;
CREATE TRIGGER trg_place_leaves_part_update
  AFTER UPDATE ON experience_parts
  REFERENCING OLD TABLE AS old_parts NEW TABLE AS new_parts
  FOR EACH STATEMENT EXECUTE FUNCTION whole_leaves_follow_parts();
DROP TRIGGER IF EXISTS trg_place_leaves_part_delete ON experience_parts;
CREATE TRIGGER trg_place_leaves_part_delete
  AFTER DELETE ON experience_parts
  REFERENCING OLD TABLE AS old_parts
  FOR EACH STATEMENT EXECUTE FUNCTION whole_leaves_follow_parts();

-- A point's state decides whether its place is an offered leaf: a curator's
-- publish or refusal, a source's withdrawal, a verdict, a merge folding it, a
-- point moved to another place, a point added or deleted. The columns are the
-- ones trg_place_regions_point_update follows, since offered is the visible of
-- the points place_shown_points() reads. One refresh per statement, never per
-- row. A point added needs no placement here, unlike a region row, so the
-- insert is followed too. Named to fire before trg_place_regions_point_*.
CREATE OR REPLACE FUNCTION whole_leaves_follow_points() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_whole_leaves(ARRAY(SELECT DISTINCT n.experience_id FROM new_points n));
  END IF;
  IF TG_OP = 'UPDATE' THEN
    PERFORM refresh_whole_leaves(ARRAY(
      SELECT o.experience_id FROM old_points o JOIN new_points n ON n.id = o.id
       WHERE (o.experience_id, o.curation_state, o.refused_at, o.missing_since, o.existence, o.merged_into_id)
             IS DISTINCT FROM
             (n.experience_id, n.curation_state, n.refused_at, n.missing_since, n.existence, n.merged_into_id)
      UNION
      SELECT n.experience_id FROM old_points o JOIN new_points n ON n.id = o.id
       WHERE n.experience_id IS DISTINCT FROM o.experience_id));
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_whole_leaves(ARRAY(SELECT DISTINCT o.experience_id FROM old_points o));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_place_leaves_point_insert ON experience_locations;
CREATE TRIGGER trg_place_leaves_point_insert
  AFTER INSERT ON experience_locations
  REFERENCING NEW TABLE AS new_points
  FOR EACH STATEMENT EXECUTE FUNCTION whole_leaves_follow_points();
DROP TRIGGER IF EXISTS trg_place_leaves_point_update ON experience_locations;
CREATE TRIGGER trg_place_leaves_point_update
  AFTER UPDATE ON experience_locations
  REFERENCING OLD TABLE AS old_points NEW TABLE AS new_points
  FOR EACH STATEMENT EXECUTE FUNCTION whole_leaves_follow_points();
DROP TRIGGER IF EXISTS trg_place_leaves_point_delete ON experience_locations;
CREATE TRIGGER trg_place_leaves_point_delete
  AFTER DELETE ON experience_locations
  REFERENCING OLD TABLE AS old_points
  FOR EACH STATEMENT EXECUTE FUNCTION whole_leaves_follow_points();

COMMIT;

-- The backfill in a transaction of its own, after the triggers stand: a part
-- relation or a point written in between refreshes its wholes itself, and this
-- writes only what is still missing.
BEGIN;

SELECT refresh_whole_leaves(NULL) AS rows_written;

COMMIT;
