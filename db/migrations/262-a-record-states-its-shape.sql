-- 262-a-record-states-its-shape.sql
--
-- A record states its shape (#2577, ADR-0218 decisions 1 to 4):
-- experiences.shape (point, area, line, none) replaces whole_shape, and
-- experiences_shape_holds replaces experiences_location_iff_not_dispersed.
-- Having parts is a second fact, read from experience_parts.
--
-- What it changes on a database that holds the catalogue:
--
-- * Every row takes a shape from the one it held as a whole: a dispersed
--   whole is none, a container an area, and every other row a point. On the
--   development catalogue of 2026-11-16 that is 486 rows of shape none (the
--   serial World Heritage sites) and no area, since no container whole
--   exists. No coordinate is written or emptied: a row of shape none is the
--   row that held no coordinate before, which the file checks before it
--   commits.
-- * whole_shape, its constraint, whole_shape_of(), whole_shape_follows_parts()
--   and their two triggers go. default_shape_of() and shape_follows_parts()
--   keep the same rules under the new column: asked when a point gains its
--   first part, and a point again with the last.
--
-- No reader answers differently after it: shownByPartsSql
-- (db/readerPredicates.ts) asks shape = 'none' where a reader asked for a
-- dispersed whole or a missing coordinate.
--
-- One transaction: the column arrives with its default, which writes no row,
-- and the backfill writes shape alone, which queues no deferred trigger event
-- (crowding_follows_place_change fires on existence and location), so the
-- ALTERs after it are not refused (db/migrations/README.md). Runs before the
-- next re-application of 01-schema.sql, which declares the same. Re-runnable:
-- the backfill reads whole_shape only while the column is there.

\set ON_ERROR_STOP on

BEGIN;

-- The ALTERs take experiences and experience_parts exclusively for
-- milliseconds: a long transaction on them must not stall their writers
-- behind this one.
SET LOCAL lock_timeout = '10s';

-- What a record is on the ground (ADR-0218): a point a traveller goes to, an
-- area a traveller is inside, a line a traveller is on, or none, a record met
-- at its parts. It says what the thing is, and the geometry columns say what
-- the catalogue holds of it. Having parts is a second fact
-- (experience_parts): Seville's World Heritage site is none and is its
-- cathedral, its Alcázar and its Archivo de Indias, while a place whose parts
-- stand within a walk of each other is an area that keeps its coordinate.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS shape VARCHAR(5) NOT NULL DEFAULT 'point'
    CHECK (shape IN ('point', 'area', 'line', 'none'));
COMMENT ON COLUMN experiences.shape IS 'What the record is on the ground (ADR-0218): point, area, line or none (met at its parts: a serial World Heritage site). Written by shape_follows_parts() when the record gains its first part or loses its last; point on every other record.';

-- The old triggers go before the backfill and the new ones arrive after the
-- constraint, so nothing shapes a row between the two.
DROP TRIGGER IF EXISTS trg_whole_shape_part_insert ON experience_parts;
DROP TRIGGER IF EXISTS trg_whole_shape_part_delete ON experience_parts;
DROP FUNCTION IF EXISTS whole_shape_follows_parts();
DROP FUNCTION IF EXISTS whole_shape_of(INTEGER);

DO $$
DECLARE
  mismatched INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'experiences' AND column_name = 'whole_shape') THEN
    EXECUTE $backfill$
      UPDATE experiences
         SET shape = CASE whole_shape WHEN 'dispersed' THEN 'none' ELSE 'area' END
       WHERE whole_shape IS NOT NULL
         AND shape IS DISTINCT FROM CASE whole_shape WHEN 'dispersed' THEN 'none' ELSE 'area' END
    $backfill$;
  END IF;
  -- The premise the readers move on: no coordinate exactly on shape none.
  SELECT count(*) INTO mismatched FROM experiences WHERE (location IS NULL) <> (shape = 'none');
  IF mismatched > 0 THEN
    RAISE EXCEPTION '262: % rows hold no coordinate without being of shape none, or the reverse', mismatched;
  END IF;
END $$;

ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_location_iff_not_dispersed;
ALTER TABLE experiences DROP COLUMN IF EXISTS whole_shape;
COMMENT ON COLUMN experiences.location IS 'The record''s coordinate. Held to its shape by experiences_shape_holds (ADR-0218): none on a record of shape none, which is its parts and has no point of its own.';

-- The shape holds the coordinate: a point has one, a record of shape none has
-- none, and an area or a line has one or the outline or line that stands for
-- it. ELSE false: a shape this does not name holds nothing.
ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_shape_holds;
ALTER TABLE experiences ADD CONSTRAINT experiences_shape_holds
    CHECK (CASE shape
        WHEN 'point' THEN location IS NOT NULL
        WHEN 'area'  THEN location IS NOT NULL OR boundary IS NOT NULL
        WHEN 'line'  THEN location IS NOT NULL OR path IS NOT NULL
        WHEN 'none'  THEN location IS NULL
        ELSE false
    END);

-- The shape a record takes by default (ADR-0218 decision 3): point with no
-- part; with parts, none when it holds a World Heritage record or its parts'
-- standing points lie more than 1 km apart, and an area otherwise. A serial
-- World Heritage site is none whatever the walk between its parts (Würzburg's
-- two, 159 m apart). Asked once, when the first parts arrive: an area's later
-- parts do not move its shape (an outlier 44 km off would otherwise take a
-- valley's coordinate away), and the check whole-shape-drift names one they
-- would.
--
-- Exact without measuring every two points: each standing point's reach is
-- its distance from one of them, the origin. Two points are never farther
-- apart than their reaches added up, so only a pair whose reaches add up to
-- 1 km is measured, and of every such pair at least one point reaches half of
-- it. The origin is the standing point nearest the points' centre (ties by
-- the point's id), so an outlier is never the origin: a gatehouse 700 m from
-- 757 parcels would put every parcel past half the rule from it, and every
-- pair would be measured. Points all within 500 m of the origin are an area
-- at once, the 758 shelters of a whole on one spot among them; a point more
-- than 1 km from the origin makes the record none at the first pair. The
-- bounds keep a millimetre to spare, so a pair the rounding of a reach could
-- hide is measured.
CREATE OR REPLACE FUNCTION default_shape_of(place INTEGER) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  WITH standing AS MATERIALIZED (
    SELECT el.id, el.location::geography AS point
      FROM experience_parts p JOIN experience_locations el ON el.experience_id = p.part_id
     WHERE p.whole_id = place
       AND el.missing_since IS NULL AND el.existence <> 'lost' AND el.merged_into_id IS NULL AND el.refused_at IS NULL
  ),
  centre AS MATERIALIZED (
    SELECT ST_Centroid(ST_Collect(point::geometry)::geography) AS point FROM standing
  ),
  origin AS MATERIALIZED (
    SELECT s.point
      FROM standing s, centre c
     ORDER BY ST_Distance(s.point, c.point), s.id
     LIMIT 1
  ),
  measured AS MATERIALIZED (
    SELECT s.point, ST_Distance(s.point, origin.point) AS reach
      FROM standing s, origin
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM experience_parts p WHERE p.whole_id = place) THEN 'point'
    WHEN EXISTS (SELECT 1 FROM source_records r WHERE r.experience_id = place AND r.source_id = 1) THEN 'none'
    WHEN EXISTS (
      SELECT 1
        FROM measured a JOIN measured b ON a.reach + b.reach >= 999.999
       WHERE a.reach >= 499.9995
         AND NOT ST_DWithin(a.point, b.point, 1000)) THEN 'none'
    ELSE 'area' END
$$;
COMMENT ON FUNCTION default_shape_of(INTEGER) IS 'The shape a record takes by default (ADR-0218): point with no part; with parts, none with a World Heritage record or parts more than 1 km apart, else area.';

-- Keeps every record's shape and coordinate in step with its parts
-- (ADR-0218): a point that gains its first part takes its default shape
-- (default_shape_of), and gives up its coordinate when that is none, with a
-- curator's claim on it, which no answer could then write; a record that
-- loses its last part is a point again, at the coordinate its kind record
-- reports (the World Heritage record's first), else at a standing point of
-- its own; with neither it keeps its shape.
CREATE OR REPLACE FUNCTION shape_follows_parts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- default_shape_of measures the parts' points against each other, so it
    -- is asked once for each record that is still a point, in a MATERIALIZED
    -- CTE: a subquery on the inner side of a nested loop is run again for
    -- every outer row, and the planner picks that loop, experiences outside,
    -- whenever its statistics say the table is nearly empty.
    WITH shaped AS MATERIALIZED (
      SELECT e.id, default_shape_of(e.id) AS shape
        FROM experiences e
       WHERE e.shape = 'point' AND e.id IN (SELECT n.whole_id FROM new_parts n)
    )
    UPDATE experiences e
       SET shape = shaped.shape,
           location = CASE WHEN shaped.shape = 'none' THEN NULL ELSE e.location END,
           curated_fields = CASE WHEN shaped.shape = 'none' THEN e.curated_fields - 'location' ELSE e.curated_fields END,
           updated_at = NOW()
      FROM shaped
     -- Asked again here, not only in the CTE: a row another statement shaped
     -- while this one waited on its lock is rechecked by this clause alone.
     WHERE e.id = shaped.id AND e.shape = 'point';
  ELSE
    UPDATE experiences e
       SET shape = 'point', location = back.location, updated_at = NOW()
      FROM (SELECT w.whole_id, COALESCE(held.location,
              (SELECT r.reported_location FROM source_records r
                WHERE r.experience_id = w.whole_id AND r.kind_id IS NOT NULL AND r.reported_location IS NOT NULL
                ORDER BY r.source_id = 1 DESC, r.id LIMIT 1),
              (SELECT el.location FROM experience_locations el
                WHERE el.experience_id = w.whole_id AND el.missing_since IS NULL AND el.existence <> 'lost'
                  AND el.merged_into_id IS NULL AND el.refused_at IS NULL
                ORDER BY el.id LIMIT 1)) AS location
              FROM (SELECT DISTINCT o.whole_id FROM old_parts o) w
              JOIN experiences held ON held.id = w.whole_id) back
     -- The shapes parts give. A line is stated by nothing yet and follows no
     -- part.
     WHERE e.id = back.whole_id AND e.shape IN ('none', 'area')
       -- A record nothing gives a coordinate keeps its shape, which the check
       -- whole-shape-drift names, rather than refuse the delete.
       AND back.location IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM experience_parts p WHERE p.whole_id = back.whole_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_shape_part_insert ON experience_parts;
CREATE TRIGGER trg_shape_part_insert
  AFTER INSERT ON experience_parts
  REFERENCING NEW TABLE AS new_parts
  FOR EACH STATEMENT EXECUTE FUNCTION shape_follows_parts();
DROP TRIGGER IF EXISTS trg_shape_part_delete ON experience_parts;
CREATE TRIGGER trg_shape_part_delete
  AFTER DELETE ON experience_parts
  REFERENCING OLD TABLE AS old_parts
  FOR EACH STATEMENT EXECUTE FUNCTION shape_follows_parts();

COMMIT;
