-- 064-regions-bump-their-tile-version.sql
--
-- A write to regions that changes what a tile draws bumps its world view's
-- tile_version, at commit, once per transaction (ADR-0075, #688). The bump
-- used to be made by three writers of the table and left out by the rest:
-- a drawn boundary, a reset, a hull save, a create, a delete, a reparent and
-- a rename all kept the old shapes in Martin's cache at unchanged URLs.
--
-- Nothing to backfill: a database that missed bumps before this file serves
-- stale tiles only until its next write, or until Martin restarts.
-- Re-runnable: the function is CREATE OR REPLACE and each trigger is dropped
-- if present before it is created.

\set ON_ERROR_STOP on

BEGIN;
-- A write that changes what a tile draws changes the URL that tile is fetched
-- from (ADR-0075, #688). Martin caches a tile by its URL, and the web puts the
-- world view's tile_version on every one as _v, so a region written without a
-- bump is drawn as it was, from the cache, at cache speed. The tile functions
-- read a region's name, color, parent, world view, uses_hull, is_leaf and
-- every geometry rung, and whether it has a child; so the bump belongs to the
-- table, where no writer can leave it out, as ADR-0035 and ADR-0068 settled
-- for the invalidations.
--
-- The triggers are deferred to the commit. The world_views row is then locked
-- last and held only until the commit, so two transactions that write regions
-- of one world view never wait on each other for it while each holds a region
-- the other needs. They bump once per transaction per world view: the ids
-- already bumped are kept in a transaction-local setting. A constraint trigger
-- cannot be created OR REPLACE, so each is dropped first.
CREATE OR REPLACE FUNCTION bump_region_tile_version()
RETURNS TRIGGER AS $$
DECLARE
    bumped text := COALESCE(current_setting('tyr.tile_version_bumped', true), '');
    world_view integer;
BEGIN
    FOREACH world_view IN ARRAY ARRAY[
        CASE WHEN TG_OP <> 'INSERT' THEN OLD.world_view_id END,
        CASE WHEN TG_OP <> 'DELETE' THEN NEW.world_view_id END
    ] LOOP
        CONTINUE WHEN world_view IS NULL OR position(',' || world_view || ',' IN bumped) > 0;
        UPDATE world_views SET tile_version = COALESCE(tile_version, 0) + 1 WHERE id = world_view;
        bumped := CASE WHEN bumped = '' THEN ',' ELSE bumped END || world_view || ',';
        PERFORM set_config('tyr.tile_version_bumped', bumped, true);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A region that appears or goes changes its own tiles and its parent's
-- has_subregions.
DROP TRIGGER IF EXISTS trg_regions_tile_version_rows ON regions;
CREATE CONSTRAINT TRIGGER trg_regions_tile_version_rows
    AFTER INSERT OR DELETE ON regions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION bump_region_tile_version();

-- A statement that sets a geometry column is taken to change it. Comparing
-- the old and new value would detoast both, and a root region's outline is
-- tens of megabytes; the writes that set one unchanged (the focus refresh's
-- hull_geom = hull_geom) bump once more than they need to.
DROP TRIGGER IF EXISTS trg_regions_tile_version_geometry ON regions;
CREATE CONSTRAINT TRIGGER trg_regions_tile_version_geometry
    AFTER UPDATE OF geom, hull_geom, geom_3857, hull_geom_3857,
        geom_simplified_low, geom_simplified_medium, geom_simplified_coarse, geom_overview,
        geom_simplified_low_real, geom_simplified_medium_real
    ON regions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION bump_region_tile_version();

-- The drawn attributes are compared, so a form saved unchanged, or a
-- find-or-create that lands on its conflict arm, busts no URL.
DROP TRIGGER IF EXISTS trg_regions_tile_version_attributes ON regions;
CREATE CONSTRAINT TRIGGER trg_regions_tile_version_attributes
    AFTER UPDATE OF name, color, parent_region_id, world_view_id, uses_hull, is_leaf ON regions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (OLD.name IS DISTINCT FROM NEW.name
        OR OLD.color IS DISTINCT FROM NEW.color
        OR OLD.parent_region_id IS DISTINCT FROM NEW.parent_region_id
        OR OLD.world_view_id IS DISTINCT FROM NEW.world_view_id
        OR OLD.uses_hull IS DISTINCT FROM NEW.uses_hull
        OR OLD.is_leaf IS DISTINCT FROM NEW.is_leaf)
    EXECUTE FUNCTION bump_region_tile_version();
COMMIT;
