-- 060-a-member-change-invalidates-its-region.sql
--
-- A write to region_members clears its region's geometry (#718, ADR-0068).
--
-- A region's outline is the union of its children and of its own members, so
-- changing what it holds makes its stored geom stale. Only the World View
-- Editor's member paths named the region afterwards; a dozen import-review
-- writers (accept and reject a match, clear members, reset a match, collapse
-- to parent, sync instances, handle as grouping, auto-resolve children, undo,
-- resolve an overlap, a coverage assignment, re-match, the geoshape cache)
-- rewrote members and named nothing, so a region computed mid-review kept an
-- outline it no longer held, and no ordinary run would ever select it again.
--
-- The triggers below clear the region in the statement that changed its
-- members, and the geom trigger (ADR-0035) carries it to the ancestors.
-- Re-runnable: every statement is CREATE OR REPLACE.

\set ON_ERROR_STOP on

BEGIN;
-- A member change is a geometry change of its region (ADR-0068). A region's
-- outline is the union of its children and of its own members, so a write to
-- region_members makes that region's stored geom stale exactly as moving a
-- child does. Nulling it here -- in the statement that changed the member --
-- lets the trigger above carry the news to the ancestors, and leaves no writer
-- to remember a call: the import review had a dozen that did not (#718).
--
-- Statement-level, with transition tables, so a bulk write (an import's match,
-- a re-match of a world view) nulls each touched region once rather than once
-- per row. A drawn boundary is not derived from its members and is left as
-- drawn; a region with no geometry yet has nothing to clear.
CREATE OR REPLACE FUNCTION invalidate_member_regions_geometry() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE regions r
    SET geom = NULL, geom_3857 = NULL, geom_simplified_low = NULL, geom_simplified_medium = NULL
    WHERE r.id IN (SELECT region_id FROM new_members)
      AND r.is_custom_boundary IS NOT TRUE AND r.geom IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE regions r
    SET geom = NULL, geom_3857 = NULL, geom_simplified_low = NULL, geom_simplified_medium = NULL
    WHERE r.id IN (SELECT region_id FROM old_members)
      AND r.is_custom_boundary IS NOT TRUE AND r.geom IS NOT NULL;
  ELSE
    -- Only what changes the union: the row's region, its division or its cut.
    -- A renamed part (custom_name) draws the same outline.
    UPDATE regions r
    SET geom = NULL, geom_3857 = NULL, geom_simplified_low = NULL, geom_simplified_medium = NULL
    WHERE r.id IN (
        SELECT o.region_id FROM old_members o JOIN new_members n ON n.id = o.id
         WHERE o.region_id IS DISTINCT FROM n.region_id
            OR o.division_id IS DISTINCT FROM n.division_id
            OR o.custom_geom IS DISTINCT FROM n.custom_geom
        UNION
        SELECT n.region_id FROM old_members o JOIN new_members n ON n.id = o.id
         WHERE o.region_id IS DISTINCT FROM n.region_id
            OR o.division_id IS DISTINCT FROM n.division_id
            OR o.custom_geom IS DISTINCT FROM n.custom_geom
      )
      AND r.is_custom_boundary IS NOT TRUE AND r.geom IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION invalidate_member_regions_geometry() IS 'Trigger function: a write to region_members marks the regions whose union it changed stale, and the geom trigger carries it to their ancestors (ADR-0068).';

-- Three triggers on one function: a statement trigger with transition tables
-- takes one event, and an UPDATE one cannot take a column list, which is why
-- the UPDATE arm compares the rows itself.
CREATE OR REPLACE TRIGGER trg_region_members_insert_invalidates_region
  AFTER INSERT ON region_members
  REFERENCING NEW TABLE AS new_members
  FOR EACH STATEMENT
  EXECUTE FUNCTION invalidate_member_regions_geometry();

CREATE OR REPLACE TRIGGER trg_region_members_delete_invalidates_region
  AFTER DELETE ON region_members
  REFERENCING OLD TABLE AS old_members
  FOR EACH STATEMENT
  EXECUTE FUNCTION invalidate_member_regions_geometry();

CREATE OR REPLACE TRIGGER trg_region_members_update_invalidates_region
  AFTER UPDATE ON region_members
  REFERENCING OLD TABLE AS old_members NEW TABLE AS new_members
  FOR EACH STATEMENT
  EXECUTE FUNCTION invalidate_member_regions_geometry();

COMMIT;
