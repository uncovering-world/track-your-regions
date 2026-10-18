-- 124-a-part-with-a-kind-of-its-own-names-itself.sql
--
-- A component part follows its point: the trigger copies the point's name and
-- coordinate onto the part, and its reference onto the relation (ADR-0100).
-- A part that holds a kind of its own names itself (ADR-0100 decision 2,
-- #1250). Once a merge folds the Temple of Karnak into the Karnak Temple
-- Complex of Places of worship, the complex is the part. The site's run would
-- otherwise rename it "Temple of Karnak", move its anchor to the component's
-- coordinate and renumber its relation every time it writes the point.
--
-- The rule is part_follows_point, for one point: the trigger applies it on
-- every write, and the undo of a merge applies it to the points it gives a
-- part back, which the site's run may have renamed while the merge stood.
--
-- No row changes: no part holds a membership before #1250 merges one.
-- Order-independent with 01-schema.sql, which declares the same function.
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION part_follows_point(point_id INTEGER)
RETURNS VOID AS $$
  UPDATE experiences part
     SET name = COALESCE(NULLIF(el.name, ''), el.external_ref, part.name), location = el.location,
         -- Stamped as every writer of the table stamps it (ADR-0069).
         updated_at = NOW()
    FROM experience_locations el
   WHERE el.id = point_id AND part.id = el.experience_id
     AND EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = el.experience_id AND p.reason = 'component')
     AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = el.experience_id)
     AND (part.name IS DISTINCT FROM COALESCE(NULLIF(el.name, ''), el.external_ref, part.name)
          OR part.location IS DISTINCT FROM el.location);
  UPDATE experience_parts p SET external_ref = el.external_ref
    FROM experience_locations el
   WHERE el.id = point_id AND p.part_id = el.experience_id AND p.reason = 'component'
     AND p.external_ref IS DISTINCT FROM el.external_ref
     AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = el.experience_id);
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION follow_component_point()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM part_follows_point(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
