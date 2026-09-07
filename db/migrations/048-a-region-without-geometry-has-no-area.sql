-- 048-a-region-without-geometry-has-no-area.sql
--
-- A region's stored area goes with the geometry it measures (#763).
--
-- update_region_metadata() computed geom_area_km2 only when NEW.geom held a
-- shape and did nothing otherwise, so a write that clears a region's geometry
-- -- ancestor invalidation (ADR-0035), which nulls every derived parent of a
-- region whose outline has just been written, or a member edit, which nulls the
-- region itself -- left the area of the outline that is no longer there. On the
-- development database that is Europe of the Administrative world view: geom
-- NULL since its children were recomputed, geom_area_km2 still 4,095,971 km2.
-- Catalogue Checks then read two worlds: parent-short-of-its-children, which
-- reads the stored area, reported Europe at 41 % of its children, while
-- region-without-geometry reported it holding nothing at all.
--
-- The trigger now clears the area when the geometry is cleared or empty, and
-- this file does two things: it installs that function, so a database holding
-- data is not left with the old one until 01-schema.sql is next re-applied and
-- the next invalidation writes the same stale row again; and it clears the
-- area on every row whose geometry is already gone. The area alone is written,
-- not the geometry, so no geometry trigger fires and the walk of ADR-0035 is
-- not set off. uses_hull is left as it is: the trigger preserves it on every
-- UPDATE on purpose, since a curator may have set it by hand and invalidation
-- nulls a geometry only to have it recomputed.
--
-- The rows repaired are still #667's, waiting on #459 for their geometry --
-- a NULL area is the truthful reading of a region with nothing on the map, not
-- the repair of the map. Order-independent with 01-schema.sql, which carries
-- the same function (CREATE OR REPLACE, no constraint), and re-running it
-- finds nothing to clear.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION update_region_metadata()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.geom IS NULL OR ST_IsEmpty(NEW.geom) THEN
        NEW.geom_area_km2 := NULL;
        RETURN NEW;
    END IF;

    -- NOTE: anchor_point is computed by update_region_focus_data() which handles
    -- antimeridian-crossing and full-globe regions correctly. Do NOT set it here.
    NEW.geom_area_km2 := ST_Area(NEW.geom::geography) / 1000000;

    -- Auto-detect uses_hull ONLY on INSERT (new region).
    -- On UPDATE, always preserve the existing value — invalidateRegionGeometry()
    -- clears geom to NULL before recompute, so NULL→non-NULL on UPDATE is NOT
    -- a "first time" scenario. The user may have manually set uses_hull=false.
    IF TG_OP = 'INSERT' THEN
        NEW.uses_hull := should_use_hull(NEW.geom, NEW.parent_region_id, NEW.id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The rows the old function left behind. The geometry is not touched, so the
-- geometry triggers stay quiet: this is the area column alone.
CREATE TEMP TABLE cleared_area ON COMMIT DROP AS
SELECT r.id, r.world_view_id, r.name, r.geom_area_km2
  FROM regions r
 WHERE (r.geom IS NULL OR ST_IsEmpty(r.geom))
   AND r.geom_area_km2 IS NOT NULL;

UPDATE regions r
   SET geom_area_km2 = NULL
  FROM cleared_area c
 WHERE r.id = c.id;

\echo 'Regions whose stale area was cleared:'
SELECT world_view_id, id, name, round(geom_area_km2::numeric) AS stale_km2
  FROM cleared_area
 ORDER BY world_view_id, id;

COMMIT;
