-- 054-leaf-pieces-for-placement.sql
--
-- Cut every leaf region's geometry into small pieces, and keep it cut, so that
-- placing a point tests the pieces of the leaves that might hold it instead of
-- whole continents (#851, ADR-0054).
--
-- Placement asked every region of a world view whether it held each point. A
-- bounding box narrows that only where the box is small, and the boxes of Russia
-- and of Asia -- 7.1 million vertices -- span every longitude, since Russia's
-- parts reach both sides of the antimeridian: the first run of the Places of
-- worship source spent 25 minutes placing its 1078 points. Placement now tests
-- the leaves through these pieces, takes every ancestor's row from the tree as
-- before, and asks the other regions only about the points no leaf holds.
--
-- The file installs what 01-schema.sql carries -- the table and its two indexes,
-- the cut, the trigger function and its two arms -- and cuts every leaf that has
-- a geometry and no pieces yet: the 3594 leaves of the development database, in
-- about a quarter of an hour, with a NOTICE every 250 leaves so a long run can be
-- told from a stuck one. Writes to regions wait for that time, because a
-- geometry written while the backfill runs would otherwise have its fresh pieces
-- joined by a cut of the outline it replaced. Reads, and placement, go on.
--
-- Run it before starting the backend that places through the pieces: that
-- backend reads region_geom_pieces, and against a database without the table
-- every placement fails and every run that moved something ends partial. A
-- database that has re-applied 01-schema.sql has the table and the trigger but no
-- pieces, and places correctly until this file runs, only more slowly -- 31 s
-- rather than 5 for the direct step of the development world view, far from the
-- hours the old statement took -- so this is the file not to record with
-- db:baseline instead of running it.
--
-- A leaf whose cut fails is left without pieces and named in a WARNING, as the
-- trigger leaves it, so one geometry GEOS cannot cut neither aborts the run nor
-- undoes the leaves cut before it; placement tests such a leaf whole.
--
-- Re-runnable: every object is CREATE ... IF NOT EXISTS or OR REPLACE, and the
-- backfill cuts only the leaves that have no pieces, so a second run tries a
-- failed leaf again. Order-independent with 01-schema.sql.

\set ON_ERROR_STOP on

BEGIN;

LOCK TABLE regions IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS region_geom_pieces (
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    geom GEOMETRY(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_region_geom_pieces_geom ON region_geom_pieces USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_region_geom_pieces_region ON region_geom_pieces(region_id);

COMMENT ON TABLE region_geom_pieces IS 'A leaf region''s geometry cut into pieces of at most 256 vertices, for testing which leaf holds a point. Kept by trg_regions_geom_pieces; never drawn (ADR-0054).';

-- The one spelling of the cut. It reads the row rather than taking a geometry,
-- since a trigger's NEW can be older than the row by the time it runs.
CREATE OR REPLACE FUNCTION cut_region_geom_pieces(p_region_id INTEGER) RETURNS INTEGER AS $$
DECLARE
  cut INTEGER;
BEGIN
  INSERT INTO region_geom_pieces (region_id, geom)
  SELECT r.id, ST_Multi(piece)
  FROM regions r
  CROSS JOIN LATERAL ST_Subdivide(r.geom, 256) AS piece
  WHERE r.id = p_region_id
    AND r.is_leaf
    AND r.geom IS NOT NULL;
  GET DIAGNOSTICS cut = ROW_COUNT;
  RETURN cut;
END;
$$ LANGUAGE plpgsql;

-- On a geometry write only, not on is_leaf: a parent left childless is nulled for
-- recompute by the handler that emptied it, and cutting its old outline first
-- would be work thrown away. A failed cut leaves no pieces and a warning; the
-- delete stays outside the handled block so no stale pieces survive it.
CREATE OR REPLACE FUNCTION refresh_region_geom_pieces() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM region_geom_pieces WHERE region_id = NEW.id;
  BEGIN
    PERFORM cut_region_geom_pieces(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'region % keeps no pieces for placement: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_region_geom_pieces() IS 'Trigger function: a write to regions.geom replaces that region''s pieces with the cut of its current geometry, if it is a leaf (ADR-0054).';

CREATE OR REPLACE TRIGGER trg_regions_geom_pieces
  AFTER UPDATE OF geom ON regions
  FOR EACH ROW
  WHEN (OLD.geom IS DISTINCT FROM NEW.geom)
  EXECUTE FUNCTION refresh_region_geom_pieces();

CREATE OR REPLACE TRIGGER trg_regions_geom_insert_pieces
  AFTER INSERT ON regions
  FOR EACH ROW
  WHEN (NEW.geom IS NOT NULL)
  EXECUTE FUNCTION refresh_region_geom_pieces();

DO $$
DECLARE
  started TIMESTAMPTZ := clock_timestamp();
  total INTEGER;
  done INTEGER := 0;
  failed INTEGER := 0;
  pieces BIGINT := 0;
  leaf RECORD;
BEGIN
  SELECT count(*) INTO total
  FROM regions r
  WHERE r.is_leaf
    AND r.geom IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM region_geom_pieces p WHERE p.region_id = r.id);
  RAISE NOTICE 'cutting % leaves', total;

  FOR leaf IN
    SELECT r.id
    FROM regions r
    WHERE r.is_leaf
      AND r.geom IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM region_geom_pieces p WHERE p.region_id = r.id)
    ORDER BY r.id
  LOOP
    -- As the trigger does it: a leaf whose cut fails keeps no pieces and is
    -- tested whole by placement, and the leaves already cut stay cut.
    BEGIN
      pieces := pieces + cut_region_geom_pieces(leaf.id);
    EXCEPTION WHEN OTHERS THEN
      failed := failed + 1;
      RAISE WARNING 'region % keeps no pieces for placement: %', leaf.id, SQLERRM;
    END;
    done := done + 1;
    IF done % 250 = 0 OR done = total THEN
      RAISE NOTICE '% of % leaves cut into % pieces, % failed, % elapsed',
        done, total, pieces, failed, clock_timestamp() - started;
    END IF;
  END LOOP;
END $$;

ANALYZE region_geom_pieces;

\echo 'Leaves with a geometry, and how many of them have pieces, per world view:'
SELECT r.world_view_id,
       count(*) AS leaves_with_geometry,
       count(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM region_geom_pieces p WHERE p.region_id = r.id)
       ) AS with_pieces
FROM regions r
WHERE r.is_leaf
  AND r.geom IS NOT NULL
GROUP BY r.world_view_id
ORDER BY r.world_view_id;

COMMIT;
