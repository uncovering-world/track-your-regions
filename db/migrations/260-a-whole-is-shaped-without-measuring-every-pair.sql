-- 260-a-whole-is-shaped-without-measuring-every-pair.sql
--
-- whole_shape_of (ADR-0210) answers the 1 km rule without measuring every two
-- of a whole's parts' points: each point's distance from the one nearest
-- their centre bounds every pair it is in, so only a pair whose two distances
-- add up to 1 km is measured. The answer is the same for every whole; what
-- changes is the cost. For 758 parts on one spot it was every one of 574,000
-- pairs, 0.6 to 1.4 s on the development box and more on a CI runner, where
-- the 758-part case of wholeLeaves.db.test.ts timed out at 5 s; it is now two
-- distances per part, about 2 ms. 758 parts within 400 m of each other, a
-- large container, take 3 ms where they took 0.3 to 1.6 s, and so does a
-- gatehouse 700 m from 757 parcels. The Catalogue Check whole-shape-drift
-- asks it of every whole.
--
-- No row changes. Order-independent with 01-schema.sql, which declares the
-- same; re-runnable.

\set ON_ERROR_STOP on

BEGIN;

-- The shape a place takes as it becomes a whole (ADR-0210): dispersed when it
-- holds a World Heritage record, or its parts' standing points lie more than
-- 1 km apart; container otherwise. Asked once, when the first parts arrive:
-- a container's later parts do not move its shape (an outlier 44 km off would
-- otherwise take a valley's point away), and the check whole-shape-drift
-- names one they would.
--
-- Exact without measuring every two points: each standing point's reach is
-- its distance from one of them, the origin. Two points are never farther
-- apart than their reaches added up, so only a pair whose reaches add up to
-- 1 km is measured, and of every such pair at least one point reaches half of
-- it. The origin is the standing point nearest the points' centre (ties by
-- the point's id), so an outlier is never the origin: a gatehouse 700 m from
-- 757 parcels would put every parcel past half the rule from it, and every
-- pair would be measured. Points all within 500 m of the origin are a
-- container at once, the 758 shelters of a whole on one spot among them; a
-- point more than 1 km from the origin is a dispersed whole at the first
-- pair. The bounds keep a millimetre to spare, so a pair the rounding of a
-- reach could hide is measured.
CREATE OR REPLACE FUNCTION whole_shape_of(place INTEGER) RETURNS TEXT
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
    WHEN EXISTS (SELECT 1 FROM source_records r WHERE r.experience_id = place AND r.source_id = 1) THEN 'dispersed'
    WHEN EXISTS (
      SELECT 1
        FROM measured a JOIN measured b ON a.reach + b.reach >= 999.999
       WHERE a.reach >= 499.9995
         AND NOT ST_DWithin(a.point, b.point, 1000)) THEN 'dispersed'
    ELSE 'container' END
$$;
COMMENT ON FUNCTION whole_shape_of(INTEGER) IS 'The shape a place takes as it becomes a whole (ADR-0210): dispersed with a World Heritage record or parts more than 1 km apart, else container.';

COMMIT;
