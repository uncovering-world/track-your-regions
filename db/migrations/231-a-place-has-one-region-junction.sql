-- 231-a-place-has-one-region-junction.sql
--
-- A place's regions are one row per region in experience_regions, its parts
-- included (#2120, ADR-0197). Each row says whether a reader finds the place
-- there (listing), so a region's reads no longer ask, row by row, whether a
-- point a reader may see lies in it. refresh_place_regions() writes the
-- rows from where placement put each point the place shows, its direct
-- parts' points included, and the triggers on experience_locations and
-- experience_parts call it when a point's state or a part relation changes.
--
-- The backfill writes every place's rows once. On the development catalogue
-- (2026-11-11) that adds about 15,800 rows, most of them the serial sites' parts',
-- drops rows still held by places a merge folded (194), and lists Park Güell,
-- a part of the Works of Antoni Gaudí whose Public art membership arrived
-- after its point was placed.
--
-- Two transactions: the schema, short, then the backfill. Order-independent
-- with 01-schema.sql, which declares the same. Re-runnable: the column,
-- constraints and index are added where missing, the functions and triggers
-- replaced, and a second backfill writes nothing.

\set ON_ERROR_STOP on

BEGIN;

-- The column and the index take the table's exclusive lock until this
-- transaction commits: a long transaction on it must not stall the region
-- reads behind it.
SET LOCAL lock_timeout = '10s';

-- Whether a reader finds the place in this region (ADR-0197). offered: a
-- point a reader may see puts it here, and readers list it here. The other two
-- are curators' alone: fallback, where the place shows no point a reader may
-- see anywhere and its unread points put it here (an arrival waiting for a
-- curator); scope, where only an unread point puts it here while a point a
-- reader sees puts it elsewhere (a move waiting for a curator). A manual row
-- is offered.
ALTER TABLE experience_regions ADD COLUMN IF NOT EXISTS listing VARCHAR(8) NOT NULL DEFAULT 'offered';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_regions_listing_check') THEN
        ALTER TABLE experience_regions ADD CONSTRAINT experience_regions_listing_check
            CHECK (listing IN ('offered', 'fallback', 'scope'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_regions_manual_offered_check') THEN
        ALTER TABLE experience_regions ADD CONSTRAINT experience_regions_manual_offered_check
            CHECK (assignment_type IS DISTINCT FROM 'manual' OR listing = 'offered');
    END IF;
END $$;
COMMENT ON COLUMN experience_regions.listing IS 'offered: a point a reader may see puts the place here, and readers list it here. fallback: the place shows no such point anywhere, and its unread points put it here. scope: only an unread point puts it here while a point a reader sees puts it elsewhere. fallback and scope are for curators only. A manual row is offered (ADR-0197).';

CREATE INDEX IF NOT EXISTS idx_experience_regions_experience ON experience_regions(experience_id);
-- A region's rows with the columns a reader's test reads, so a read that
-- starts from a region reads none of them from the table (#2283).
CREATE INDEX IF NOT EXISTS idx_experience_regions_region_listing
    ON experience_regions(region_id) INCLUDE (experience_id, listing);
DROP INDEX IF EXISTS idx_experience_regions_region_rows;

-- The points the places `places` show, each once per place, with whether a
-- reader may see it: a place's own points and its direct parts' points, the
-- two arms every reader of a place's points reads (PLACE_POINT_ARMS in
-- backend/src/db/placePoints.ts), so a region never lists a place whose
-- points a reader is not shown. A part's parts are not a whole's points
-- (#2121 decides what a nested whole shows). The points placement places:
-- offered, and not turned down (ADR-0053). Visible adds the reader's term,
-- published (ADR-0025). The two are offeredLocationSql and
-- publishedContentSql (backend/src/db/readerPredicates.ts), held to these by
-- placeRegionsSchema.test.ts.
CREATE OR REPLACE FUNCTION place_shown_points(places INTEGER[])
RETURNS TABLE (place_id INTEGER, location_id INTEGER, visible BOOLEAN)
LANGUAGE sql STABLE AS $$
  WITH made_of (place_id, member_id) AS (
    SELECT p, p FROM unnest(places) AS p WHERE p IS NOT NULL
    UNION
    SELECT prt.whole_id, prt.part_id
      FROM experience_parts prt WHERE prt.whole_id = ANY(places))
  SELECT DISTINCT made_of.place_id, el.id, el.curation_state <> 'pending'
    FROM made_of JOIN experience_locations el ON el.experience_id = made_of.member_id
   WHERE el.missing_since IS NULL AND el.existence <> 'lost' AND el.merged_into_id IS NULL
     AND el.refused_at IS NULL
$$;
COMMENT ON FUNCTION place_shown_points(INTEGER[]) IS 'The points these places show, their own and their direct parts'', as readers show them (PLACE_POINT_ARMS), each with whether a reader may see it (ADR-0197): what place_regions_expected() places a place by.';

-- The automatic rows the places `places` are expected to hold, in one world
-- view or in all: the regions of the points each shows, with the listing
-- each row carries.
CREATE OR REPLACE FUNCTION place_regions_expected(places INTEGER[], world_view INTEGER DEFAULT NULL)
RETURNS TABLE (experience_id INTEGER, region_id INTEGER, listing TEXT)
LANGUAGE sql STABLE AS $$
  WITH shown AS MATERIALIZED (SELECT * FROM place_shown_points(places)),
  seen AS (
    SELECT shown.place_id, bool_or(shown.visible) AS any_visible
      FROM shown GROUP BY shown.place_id),
  placed AS (
    SELECT shown.place_id, elr.region_id, bool_or(shown.visible) AS visible
      FROM shown
      JOIN experience_location_regions elr ON elr.location_id = shown.location_id
      JOIN regions r ON r.id = elr.region_id
     WHERE world_view IS NULL OR r.world_view_id = world_view
     GROUP BY shown.place_id, elr.region_id)
  SELECT placed.place_id, placed.region_id,
         CASE WHEN placed.visible THEN 'offered' WHEN seen.any_visible THEN 'scope' ELSE 'fallback' END
    FROM placed JOIN seen ON seen.place_id = placed.place_id
$$;
COMMENT ON FUNCTION place_regions_expected(INTEGER[], INTEGER) IS 'The automatic experience_regions rows these places are expected to hold, in one world view or all (ADR-0197): what refresh_place_regions() writes and the catalogue check place-regions-out-of-step compares.';

-- Every place that has automatic rows or may need some: a place with a point,
-- a whole, a place holding an automatic row. What a refresh of every place and
-- the catalogue check place-regions-out-of-step go over.
CREATE OR REPLACE FUNCTION places_with_regions() RETURNS INTEGER[]
LANGUAGE sql STABLE AS $$
  SELECT ARRAY(SELECT el.experience_id FROM experience_locations el
               UNION SELECT prt.whole_id FROM experience_parts prt
               UNION SELECT er.experience_id FROM experience_regions er
                      WHERE er.assignment_type IS DISTINCT FROM 'manual')
$$;
COMMENT ON FUNCTION places_with_regions() IS 'Every place that holds automatic experience_regions rows or may need some (ADR-0197): what refresh_place_regions(NULL) and the catalogue check place-regions-out-of-step go over.';

-- The places a change of `places` reaches: themselves and the wholes they
-- are direct parts of, whose rows their points give (place_shown_points);
-- NULL names every place. What a refresh rewrites, and what its keys are
-- taken for.
CREATE OR REPLACE FUNCTION place_regions_reach(places INTEGER[]) RETURNS INTEGER[]
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN places IS NULL THEN places_with_regions() ELSE ARRAY(
    SELECT p FROM unnest(places) AS p WHERE p IS NOT NULL
    UNION
    SELECT prt.whole_id FROM experience_parts prt WHERE prt.part_id = ANY(places)) END
$$;
COMMENT ON FUNCTION place_regions_reach(INTEGER[]) IS 'These places and the wholes they are direct parts of; NULL names every place (ADR-0197): what refresh_place_regions() rewrites and lock_place_regions() locks.';

-- Locks, for the transaction, the places a refresh of `places` would
-- rewrite, before anything is computed or written for them: one key per
-- place among 1,024 under 1197, taken in key order, as the identity registry
-- takes its keys (ADR-0143). A key already held is held again at no wait. The
-- refresh takes them itself; a writer that writes a place's experience_regions
-- row and then refreshes it in the same transaction takes them first, so it
-- never holds a row a refresh holding the key waits for while waiting for
-- that key (backend/src/db/locks.ts).
--
-- The reach is read again once the keys are held: a wait may have let a
-- part relation commit that adds a whole (a place made a part of a site
-- while its point was being placed). The keys it adds are taken in turn,
-- until the reach holds still. A key so added that is lower than one already
-- held is taken out of order; two transactions doing that over one pair of
-- keys meet in a cycle, which Postgres breaks by aborting one.
CREATE OR REPLACE FUNCTION lock_place_regions(places INTEGER[]) RETURNS INTEGER[]
LANGUAGE plpgsql AS $$
DECLARE
  affected INTEGER[];
  held INTEGER[] := '{}';
  wanted INTEGER[];
  place_key INTEGER;
BEGIN
  LOOP
    affected := place_regions_reach(places);
    wanted := ARRAY(SELECT DISTINCT p % 1024 FROM unnest(affected) AS p
                     WHERE NOT (p % 1024) = ANY(held) ORDER BY 1);
    EXIT WHEN cardinality(wanted) = 0;
    FOREACH place_key IN ARRAY wanted LOOP
      PERFORM pg_advisory_xact_lock(1197, place_key);
    END LOOP;
    held := held || wanted;
  END LOOP;
  RETURN affected;
END;
$$;
COMMENT ON FUNCTION lock_place_regions(INTEGER[]) IS 'Locks for the transaction, in key order, the places a refresh of these would rewrite (ADR-0197), and returns them: what refresh_place_regions() takes before computing, and what a writer of a place''s experience_regions row takes before writing it.';

-- Rewrites the automatic rows of the places `places` and of the wholes they
-- are direct parts of, as place_regions_expected() makes them, in one
-- world view or in all; NULL names every place. Writes only what differs, so a
-- second call writes nothing, and never touches a curator's manual row.
-- Returns how many rows it wrote or removed.
CREATE OR REPLACE FUNCTION refresh_place_regions(places INTEGER[], world_view INTEGER DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  affected INTEGER[];
  written INTEGER;
BEGIN
  -- The places themselves, locked before their rows are computed, whether
  -- they hold rows yet or not: two transactions placing two parts of a new
  -- whole would otherwise each compute the whole's rows without the other's
  -- point, and the later write would keep its stale listing. The statements
  -- after this one see what the transaction waited for committed.
  affected := lock_place_regions(places);
  IF affected IS NULL OR cardinality(affected) = 0 THEN
    RETURN 0;
  END IF;

  WITH expected AS MATERIALIZED (
    SELECT x.experience_id, x.region_id, x.listing FROM place_regions_expected(affected, world_view) x
  ),
  removed AS (
    DELETE FROM experience_regions er
     USING regions r
     WHERE er.experience_id = ANY(affected) AND er.assignment_type IS DISTINCT FROM 'manual'
       AND r.id = er.region_id AND (world_view IS NULL OR r.world_view_id = world_view)
       AND NOT EXISTS (SELECT 1 FROM expected x
                        WHERE x.experience_id = er.experience_id AND x.region_id = er.region_id)
    RETURNING 1
  ),
  put AS (
    INSERT INTO experience_regions AS er (experience_id, region_id, assignment_type, listing)
    SELECT x.experience_id, x.region_id, 'auto', x.listing FROM expected x
     ORDER BY x.experience_id, x.region_id
    ON CONFLICT (experience_id, region_id) DO UPDATE SET listing = EXCLUDED.listing
     WHERE er.assignment_type IS DISTINCT FROM 'manual' AND er.listing IS DISTINCT FROM EXCLUDED.listing
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM removed) + (SELECT count(*) FROM put) INTO written;
  RETURN written;
END;
$$;
COMMENT ON FUNCTION refresh_place_regions(INTEGER[], INTEGER) IS 'Rewrites the automatic experience_regions rows of these places and of the places they are parts of, as place_regions_expected() makes them (ADR-0197); NULL names every place. Called by placement and by the triggers that follow a point''s state and a part relation.';

-- A point's state decides which rows its places carry: a curator's publish or
-- refusal, a source's withdrawal, a verdict, a merge folding it, a point moved
-- to another place. Where it lies does not change here, so these need no
-- placement: the rows are refreshed from where it was placed. A moved
-- coordinate is placement's, which refreshes after it places. One refresh per
-- statement, never per row, and never recursing: the function walks up once.
CREATE OR REPLACE FUNCTION place_regions_follow_points() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM refresh_place_regions(ARRAY(
      SELECT o.experience_id FROM old_points o JOIN new_points n ON n.id = o.id
       WHERE (o.experience_id, o.curation_state, o.refused_at, o.missing_since, o.existence, o.merged_into_id)
             IS DISTINCT FROM
             (n.experience_id, n.curation_state, n.refused_at, n.missing_since, n.existence, n.merged_into_id)
      UNION
      SELECT n.experience_id FROM old_points o JOIN new_points n ON n.id = o.id
       WHERE n.experience_id IS DISTINCT FROM o.experience_id));
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_place_regions(ARRAY(SELECT DISTINCT o.experience_id FROM old_points o));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_place_regions_point_update ON experience_locations;
CREATE TRIGGER trg_place_regions_point_update
  AFTER UPDATE ON experience_locations
  REFERENCING OLD TABLE AS old_points NEW TABLE AS new_points
  FOR EACH STATEMENT EXECUTE FUNCTION place_regions_follow_points();
DROP TRIGGER IF EXISTS trg_place_regions_point_delete ON experience_locations;
CREATE TRIGGER trg_place_regions_point_delete
  AFTER DELETE ON experience_locations
  REFERENCING OLD TABLE AS old_points
  FOR EACH STATEMENT EXECUTE FUNCTION place_regions_follow_points();

-- A part relation made, moved or taken away changes the points its whole
-- shows, and the old whole's.
CREATE OR REPLACE FUNCTION place_regions_follow_parts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  places INTEGER[];
BEGIN
  -- One refresh over the old and the new relations together, so one
  -- statement takes its locks in one key order: two opposite moves refreshed
  -- old then new would each hold what the other waits for.
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
  PERFORM refresh_place_regions(places);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_place_regions_part_insert ON experience_parts;
CREATE TRIGGER trg_place_regions_part_insert
  AFTER INSERT ON experience_parts
  REFERENCING NEW TABLE AS new_parts
  FOR EACH STATEMENT EXECUTE FUNCTION place_regions_follow_parts();
DROP TRIGGER IF EXISTS trg_place_regions_part_update ON experience_parts;
CREATE TRIGGER trg_place_regions_part_update
  AFTER UPDATE ON experience_parts
  REFERENCING OLD TABLE AS old_parts NEW TABLE AS new_parts
  FOR EACH STATEMENT EXECUTE FUNCTION place_regions_follow_parts();
DROP TRIGGER IF EXISTS trg_place_regions_part_delete ON experience_parts;
CREATE TRIGGER trg_place_regions_part_delete
  AFTER DELETE ON experience_parts
  REFERENCING OLD TABLE AS old_parts
  FOR EACH STATEMENT EXECUTE FUNCTION place_regions_follow_parts();

COMMIT;

-- The backfill in a transaction of its own, so the table's exclusive lock is
-- released before it starts: readers go on reading the rows as they stood
-- (every row offered, as the column's default says) until it commits. On the
-- development catalogue the rows it computes take 0.3 s to read; it writes
-- about 60,000 (the new rows and the listings that are not offered).
BEGIN;

SELECT refresh_place_regions(NULL) AS rows_written;

COMMIT;
