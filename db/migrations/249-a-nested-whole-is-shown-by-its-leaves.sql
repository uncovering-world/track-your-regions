-- 249-a-nested-whole-is-shown-by-its-leaves.sql
--
-- A nested whole is shown and placed by its leaves (#2121, #2534, ADR-0211).
-- A whole showed its own points and its direct parts' points, so a whole
-- whose part is a whole itself showed that part's own point, where it holds
-- one, and none of the places inside it: Fujisan, once a curator nests the
-- Oshino Hakkai ponds under an Oshino Hakkai of their own, would be pinned
-- and placed by the springs' own point and not by the eight ponds its count
-- counts (ADR-0206).
-- place_shown_points() now reads a whole's leaves (whole_leaves) where it
-- read its direct parts, and place_regions_reach() walks up to every whole
-- above a change (place_ancestors) where it walked one level: a pond's point
-- published, moved or withdrawn rewrites Fujisan's rows in the same
-- statement. The readers' arms (PLACE_POINT_ARMS) read the same table.
--
-- Nothing changes for a whole none of whose parts is a whole, whose leaves
-- are its direct parts: on the development catalogue (2026-11-15) no part is
-- a whole, so the refresh below is expected to write no row. It refreshes
-- every whole once all the same, writing only what differs, so a database
-- holding a nested whole is placed by its leaves.
--
-- whole_leaves and place_ancestors() come from 247, which this follows.
-- Two transactions: the functions, short, then the refresh. Order-independent
-- with 01-schema.sql, which declares the same. Re-runnable: the functions are
-- replaced, and a second refresh writes nothing.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

-- The points the places `places` show, each once per place, with whether a
-- reader may see it: a place's own points and its leaves' points (whole_leaves,
-- the places at the bottom of its parts at any depth), the two arms every
-- reader of a place's points reads (PLACE_POINT_ARMS in
-- backend/src/db/placePoints.ts), so a region never lists a place whose
-- points a reader is not shown. A nested whole is shown by its leaves
-- (ADR-0211): Fujisan by the Oshino Hakkai ponds once a curator nests them,
-- and the nested whole's own point by the nested whole alone, as its count
-- counts its leaves (ADR-0206). The points placement places:
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
    SELECT wl.whole_id, wl.leaf_id FROM whole_leaves wl WHERE wl.whole_id = ANY(places))
  SELECT DISTINCT made_of.place_id, el.id, el.curation_state <> 'pending'
    FROM made_of JOIN experience_locations el ON el.experience_id = made_of.member_id
   WHERE el.missing_since IS NULL AND el.existence <> 'lost' AND el.merged_into_id IS NULL
     AND el.refused_at IS NULL
$$;
COMMENT ON FUNCTION place_shown_points(INTEGER[]) IS 'The points these places show, their own and their leaves'' (whole_leaves), as readers show them (PLACE_POINT_ARMS), each with whether a reader may see it (ADR-0197, ADR-0211): what place_regions_expected() places a place by.';

-- The places a change of `places` reaches: themselves and every whole above
-- them, at any depth (place_ancestors), whose rows their points give
-- (place_shown_points: a whole shows its leaves', ADR-0211); NULL names every
-- place. What a refresh rewrites, and what its keys are taken for: the keys
-- refresh_whole_leaves() takes for the same change.
CREATE OR REPLACE FUNCTION place_regions_reach(places INTEGER[]) RETURNS INTEGER[]
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN places IS NULL THEN places_with_regions() ELSE ARRAY(
    SELECT p FROM unnest(places) AS p WHERE p IS NOT NULL
    UNION
    SELECT place_ancestors(places)) END
$$;
COMMENT ON FUNCTION place_regions_reach(INTEGER[]) IS 'These places and every whole above them; NULL names every place (ADR-0197, ADR-0211): what refresh_place_regions() rewrites and lock_place_regions() locks.';

COMMENT ON FUNCTION place_ancestors(INTEGER[]) IS 'The wholes above these places at any depth, the places themselves left out (ADR-0206): cycle-safe, eight levels at most. What refresh_whole_leaves() and refresh_place_regions() lock and rewrite above a change (ADR-0211).';
COMMENT ON FUNCTION refresh_place_regions(INTEGER[], INTEGER) IS 'Rewrites the automatic experience_regions rows of these places and of every whole above them, as place_regions_expected() makes them (ADR-0197, ADR-0211); NULL names every place. Called by placement and by the triggers that follow a point''s state and a part relation.';

COMMIT;

-- Every whole's rows, as its leaves place it. Only what differs is written.
BEGIN;

SELECT refresh_place_regions(ARRAY(SELECT whole_id FROM experience_parts UNION SELECT whole_id FROM whole_leaves))
  AS rows_written;

COMMIT;
