-- 032-antimeridian-focus-data.sql
--
-- Recompute focus_bbox and anchor_point for the regions the antimeridian fix
-- in update_region_focus_data() reaches (#666).
--
-- Before the fix, a region whose geometry overshot +180 by 1e-13 degrees -- some
-- 11 nanometres -- was measured as spanning every longitude on Earth: the map framed
-- the whole globe at zoom 1 with the region cut in two against the edges, and
-- the anchor point sat in the wrong ocean. On the dev database that was the
-- Far Eastern Federal District (anchor in the northern North Sea) and Fiji
-- (anchor in the open South Atlantic), and through the children aggregation it
-- pushed Russia's and Melanesia's eastern edge out to -180.
--
-- ORDER: this file must run AFTER re-applying db/init/01-schema.sql, because it
-- re-fires the trigger and needs the fixed function to be the one that answers.
-- The guard below refuses to run otherwise rather than rewriting the same wrong
-- boxes back in place.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/032-antimeridian-focus-data.sql

\set ON_ERROR_STOP on

BEGIN;

-- Guard: the whole contract this repair depends on, not one term standing for it.
-- The function has to snap before measuring, refuse a shifted box that is itself
-- near-global, and refuse to aggregate a child whose box covers the world. Any of
-- them missing and this migration is not a repair -- it rewrites stored focus data
-- with incomplete logic, which looks like one.
DO $guard$
DECLARE
  fn text := pg_get_functiondef('update_region_focus_data()'::regprocedure);
BEGIN
  IF fn NOT LIKE '%ST_SnapToGrid%'
     OR fn NOT LIKE '%shift_span <= near_global_deg%'
     OR fn NOT LIKE '%child_covers_globe%' THEN
    RAISE EXCEPTION
      'update_region_focus_data() predates the antimeridian fix (#666). Re-apply db/init/01-schema.sql first.';
  END IF;
END;
$guard$;

DO $recompute$
DECLARE
  max_depth integer;
  lvl integer;
BEGIN
  -- The rows the fix can move, and only those. The new measurement differs
  -- from the old one in two places: the snapped shift, which changes nothing
  -- unless the geometry leaves [-180, 180]; and the near-global guards, which
  -- apply only inside the branch a span wider than 350 degrees enters. Every
  -- parent whose box comes from its children is in that branch by definition,
  -- so this set is closed under ancestry and needs no separate walk upwards.
  CREATE TEMP TABLE affected_focus_regions ON COMMIT DROP AS
  WITH RECURSIVE region_depth AS (
    SELECT id, 0 AS depth FROM regions WHERE parent_region_id IS NULL
    UNION ALL
    SELECT r.id, d.depth + 1
    FROM regions r JOIN region_depth d ON r.parent_region_id = d.id
  )
  SELECT d.id, d.depth
  FROM region_depth d
  JOIN regions r ON r.id = d.id
  CROSS JOIN LATERAL (SELECT COALESCE(r.hull_geom, r.geom) AS g) e
  WHERE e.g IS NOT NULL
    AND (ST_XMax(e.g) - ST_XMin(e.g) > 350
         OR ST_XMax(e.g) > 180
         OR ST_XMin(e.g) < -180);

  SELECT COALESCE(MAX(depth), -1) INTO max_depth FROM affected_focus_regions;

  -- Deepest first: a parent in the near-global branch reads its children's
  -- stored boxes, so a top-down pass would aggregate the old ones.
  --
  -- Touching hull_geom rather than geom is deliberate. It is the narrowest
  -- write that fires trigger_update_region_focus_data (BEFORE UPDATE OF geom,
  -- hull_geom) without firing trigger_region_metadata (UPDATE OF geom), which
  -- would recompute areas nothing here changed. The 3857 mirror trigger fires
  -- on any update but guards each branch on IS DISTINCT FROM, so writing a
  -- column its own value leaves it untouched.
  FOR lvl IN REVERSE max_depth..0 LOOP
    UPDATE regions SET hull_geom = hull_geom
    WHERE id IN (SELECT id FROM affected_focus_regions WHERE depth = lvl);
  END LOOP;

  RAISE NOTICE 'Recomputed focus data for % region(s)', (SELECT count(*) FROM affected_focus_regions);
END;
$recompute$;

-- What a database holding GADM-derived rows should show afterwards: no region
-- claims a global longitude window unless its geometry really wraps the world.
-- On the dev database this leaves 2 rows, both named Antarctica, and moves 5:
-- the Far Eastern Federal District, Fiji, Russia, Melanesia and Antarctica's
-- continent row (which becomes global instead of claiming a 347-degree window
-- with a gap over Queen Maud Land).
SELECT r.id, r.name,
       round(r.focus_bbox[1]::numeric, 4) AS west,
       round(r.focus_bbox[3]::numeric, 4) AS east,
       round(ST_X(r.anchor_point)::numeric, 4) AS anchor_lng,
       round(ST_Y(r.anchor_point)::numeric, 4) AS anchor_lat
FROM regions r
WHERE r.focus_bbox IS NOT NULL
  AND r.focus_bbox[1] <= r.focus_bbox[3]
  AND r.focus_bbox[3] - r.focus_bbox[1] > 350
ORDER BY r.id;

COMMIT;
