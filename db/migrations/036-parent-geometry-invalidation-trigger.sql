-- 036-parent-geometry-invalidation-trigger.sql
--
-- Move ancestor geometry invalidation into the database, so that no writer of
-- regions.geom can bypass it (#680).
--
-- A region's outline is the union of its children and of its own member
-- divisions, so a write to regions.geom leaves every derived ancestor covering
-- a smaller world than it contains. #667 established that the writer nulls
-- those ancestors and the next world-view run rebuilds them bottom-up; #679
-- enforced it by hand at each writer and its review found seven writers beyond
-- the one the issue described, one round at a time. A write that skipped the
-- call consumed the NULL its own convergence depended on -- the parent kept a
-- stale outline with nothing NULL beneath it, fell outside every later run's
-- closure, and every run went on reporting Complete. That is how North America
-- came to draw 18.3 % of the countries under it.
--
-- After this file the obligation runs inside the writing statement instead: it
-- cannot be forgotten by a new writer, and it cannot fail separately from the
-- write it belongs to. ADR-0035 records the decision.
--
-- Repairs nothing. The rows that are already stale stay stale -- four of them
-- on the Administrative world view, blocked on the continent-scale unions that
-- exceed statement_timeout (#667, #459). The closing report below names them so
-- the file says what it has not done; Catalogue Checks reports the same two
-- assertions (parent-short-of-its-children, region-without-geometry) on every
-- run of the admin panel.
--
-- Runs before or after the next re-application of 01-schema.sql, which carries
-- the same three objects: CREATE OR REPLACE on all of them, no constraint, no
-- data touched. Re-running it is inert for the same reason.

\set ON_ERROR_STOP on

BEGIN;

-- Nulls the derived parent of a region whose geometry has just been written.
-- One level per firing: nulling the parent is itself a geometry write, so this
-- fires again for the grandparent, and the walk ends where the recursive CTE it
-- replaces ended -- at a hand-drawn boundary (which is never derived from what
-- is under it) and at an ancestor that is already NULL. That second guard is
-- also what makes a cycle in parent_region_id terminate, where the CTE would
-- not.
--
-- Four columns, because clearing geom does not clear its own derivatives:
-- trg_regions_geom_3857 recomputes those only from a geometry that is there.
-- The two cheap rungs follow on their own, since that trigger sees
-- geom_simplified_low go to NULL and clears geom_overview and
-- geom_simplified_coarse with it.
CREATE OR REPLACE FUNCTION invalidate_parent_region_geometry() RETURNS TRIGGER AS $$
BEGIN
  UPDATE regions
  SET geom = NULL,
      geom_3857 = NULL,
      geom_simplified_low = NULL,
      geom_simplified_medium = NULL
  WHERE id = NEW.parent_region_id
    AND is_custom_boundary IS NOT TRUE
    AND geom IS NOT NULL;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION invalidate_parent_region_geometry() IS 'Trigger function: a write to regions.geom marks the derived ancestors above it stale, one level per firing (ADR-0035).';

-- IS DISTINCT FROM on geometry is exact equality in PostGIS, not a bounding-box
-- test: a collinear redraw of the same outline reads as a change and an
-- identical geometry does not. So a write that changes nothing invalidates
-- nothing.
CREATE OR REPLACE TRIGGER trg_regions_geom_invalidates_parent
  AFTER UPDATE OF geom ON regions
  FOR EACH ROW
  WHEN (OLD.geom IS DISTINCT FROM NEW.geom)
  EXECUTE FUNCTION invalidate_parent_region_geometry();

-- A region born with a drawn shape has geometry from the moment it exists, so
-- it never seeds the run's closure and neither does its parent. Its own arm,
-- because OLD is not available in an INSERT trigger's WHEN clause -- and an
-- unconditional one would call the function for every row of an import to do
-- nothing.
CREATE OR REPLACE TRIGGER trg_regions_geom_insert_invalidates_parent
  AFTER INSERT ON regions
  FOR EACH ROW
  WHEN (NEW.geom IS NOT NULL)
  EXECUTE FUNCTION invalidate_parent_region_geometry();

COMMIT;

-- What this file has not repaired: parents still short of what they contain,
-- and derived regions still holding no geometry at all. Both are #667's rows,
-- waiting on #459.
\echo 'Parents short of their children (>10 %), and regions with no geometry:'

WITH kid AS (
  SELECT parent_region_id AS pid, sum(geom_area_km2) AS kids_km2
  FROM regions
  WHERE parent_region_id IS NOT NULL AND geom_area_km2 IS NOT NULL
  GROUP BY parent_region_id
)
SELECT p.world_view_id, p.id, p.name,
       round(p.geom_area_km2::numeric, 0) AS own_km2,
       round(k.kids_km2::numeric, 0) AS kids_km2
FROM regions p
JOIN kid k ON k.pid = p.id
WHERE p.is_custom_boundary IS NOT TRUE
  AND p.geom_area_km2 IS NOT NULL
  AND p.geom_area_km2 < k.kids_km2 * 0.9
ORDER BY k.kids_km2 - p.geom_area_km2 DESC;

SELECT world_view_id, id, name
FROM regions
WHERE geom IS NULL AND is_custom_boundary IS NOT TRUE
ORDER BY world_view_id, id;
