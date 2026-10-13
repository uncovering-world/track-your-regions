-- 094-a-serial-sites-components-become-its-parts.sql
--
-- A serial World Heritage site's components become places, part of the site
-- (ADR-0100, #1424). part_site_components() is the one statement of which
-- points are components and how each becomes a part; this migration declares
-- it and applies it to every site with a World Heritage membership, and the
-- World Heritage run calls it after it writes a site's points. On the
-- development catalogue on 2026-10-13 that is 5,680 points of 484 sites; the
-- 17 other places with more than one point (Altamira's cave, two coordinates
-- two sources hold) are not components and are left as they are.
--
-- 01-schema.sql declares the same function for a fresh database.
-- Re-runnable: the function is replaced, and a site already parted has no
-- component of its own left to part.

\set ON_ERROR_STOP on

BEGIN;

-- A serial site's components are places, part of the site (ADR-0100): the one
-- statement of which of a site's points are its components and how each
-- becomes a part. Called by migration 094 over every World Heritage site and
-- by the World Heritage run after it writes a site's points
-- (writeExperienceLocations, under the site's lock). `site_membership` is the site's
-- World Heritage membership. A component is a point of the site's own that
-- this membership places, or that no membership places (a row from before
-- placements); another source's point on the place (an Archaeology dig the
-- same row holds) is not one. A site whose components are parts already gets
-- every new one parted; one of a single component stays one place (ADR-0088).
-- Each part is a place of one point: the point keeps its id, so its
-- placements, regions, visits, claims and candidates follow it. Its name and
-- coordinate are the point's; the rest of its content stays on the point
-- until the part's card reads the place. A part with no kind of its own has
-- no regions of its own: lists find it through its site. Answers how many
-- points it parted.
CREATE OR REPLACE FUNCTION part_site_components(site INTEGER, site_membership INTEGER)
RETURNS INTEGER AS $$
DECLARE
  parted INTEGER := 0;
  component RECORD;
  part INTEGER;
BEGIN
  -- Serial by its standing components: a point the source withdrew, a lost
  -- one, a refused one, or an arrival that replaces a moved one is no second
  -- component (the Pilgrimage Church of Wies, moved once, is one place).
  IF NOT EXISTS (SELECT 1 FROM experience_parts WHERE whole_id = site AND reason = 'component')
     AND (SELECT count(*) FROM experience_locations el
           WHERE el.experience_id = site AND el.merged_into_id IS NULL
             AND el.missing_since IS NULL AND el.existence <> 'lost' AND el.refused_at IS NULL
             AND el.withdrawal_deferred_for_location_id IS NULL
             AND (EXISTS (SELECT 1 FROM experience_location_placements pl
                           WHERE pl.location_id = el.id AND pl.membership_id = site_membership)
                  OR NOT EXISTS (SELECT 1 FROM experience_location_placements pl
                                  WHERE pl.location_id = el.id))) < 2
  THEN
    RETURN 0;
  END IF;

  FOR component IN
    SELECT el.id, el.name, el.external_ref, el.location
      FROM experience_locations el
     WHERE el.experience_id = site AND el.merged_into_id IS NULL
       AND (EXISTS (SELECT 1 FROM experience_location_placements pl
                     WHERE pl.location_id = el.id AND pl.membership_id = site_membership)
            OR NOT EXISTS (SELECT 1 FROM experience_location_placements pl
                            WHERE pl.location_id = el.id))
     ORDER BY el.id
  LOOP
    INSERT INTO experiences (source_id, external_id, name, location)
    SELECT whole.source_id, 'part:' || component.id,
           COALESCE(NULLIF(component.name, ''), component.external_ref, whole.name), component.location
      FROM experiences whole WHERE whole.id = site
    RETURNING id INTO part;

    INSERT INTO experience_parts (whole_id, part_id, reason, membership_id, external_ref)
    VALUES (site, part, 'component', site_membership, component.external_ref);

    UPDATE experience_locations SET experience_id = part WHERE id = component.id;

    parted := parted + 1;
  END LOOP;
  RETURN parted;
END;
$$ LANGUAGE plpgsql;

-- A component part's name, coordinate and reference are its point's
-- (ADR-0100): whoever renames, moves or renumbers the point - the run, a
-- curator, a publish - the part and its relation follow, so the two never
-- disagree. The name falls back as part_site_components names a part.
CREATE OR REPLACE FUNCTION follow_component_point()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE experiences part
     SET name = COALESCE(NULLIF(NEW.name, ''), NEW.external_ref, part.name), location = NEW.location,
         -- Stamped as every writer of the table stamps it (ADR-0069).
         updated_at = NOW()
   WHERE part.id = NEW.experience_id
     AND EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = NEW.experience_id AND p.reason = 'component');
  UPDATE experience_parts SET external_ref = NEW.external_ref
   WHERE part_id = NEW.experience_id AND reason = 'component'
     AND external_ref IS DISTINCT FROM NEW.external_ref;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_follow_component_point ON experience_locations;
CREATE TRIGGER trg_follow_component_point
  AFTER UPDATE OF name, location, external_ref ON experience_locations
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.location IS DISTINCT FROM NEW.location
        OR OLD.external_ref IS DISTINCT FROM NEW.external_ref)
  EXECUTE FUNCTION follow_component_point();

SELECT count(*) AS sites, sum(part_site_components(m.experience_id, m.id)) AS parted
  FROM experience_kind_memberships m
 WHERE m.source_id = (SELECT id FROM experience_sources WHERE name = 'UNESCO World Heritage Sites');

COMMIT;
