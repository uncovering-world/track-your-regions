-- 096-a-visit-to-a-component-is-a-visit-to-its-part.sql
--
-- A traveller's visit to a component of a serial site is a visit to the part
-- place the component became (ADR-0100 decision 5, #1425): recorded on the
-- part as a place visit, which a merge with another kind's place reconciles
-- as it reconciles any two places' visits, and counted on the site as one of
-- its parts visited. part_site_components() now moves a parted component's
-- visits onto its part, and this migration moves the visits the components
-- parted by migration 094 still hold on their points. On the development
-- catalogue on 2026-10-13 that is 2 visits by one traveller.
--
-- 01-schema.sql declares the same function for a fresh database.
-- Re-runnable: the function is replaced, and a moved visit is gone from the
-- point.

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
-- placements, regions, claims and candidates follow it. A traveller's visit
-- to the component becomes a visit to the part (ADR-0100 decision 5), the
-- record a merge reconciles with another kind's visits to the same place.
-- Its name and coordinate are the point's; the rest of its content stays on
-- the point until the part's card reads the place. A part with no kind of
-- its own has no regions of its own: lists find it through its site. Answers
-- how many points it parted.
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

    INSERT INTO user_visited_experiences (user_id, experience_id, visited_at, notes)
    SELECT uvl.user_id, part, uvl.visited_at, uvl.notes
      FROM user_visited_locations uvl WHERE uvl.location_id = component.id
    ON CONFLICT (user_id, experience_id) DO NOTHING;
    DELETE FROM user_visited_locations WHERE location_id = component.id;

    parted := parted + 1;
  END LOOP;
  RETURN parted;
END;
$$ LANGUAGE plpgsql;

INSERT INTO user_visited_experiences (user_id, experience_id, visited_at, notes)
SELECT uvl.user_id, el.experience_id, uvl.visited_at, uvl.notes
  FROM user_visited_locations uvl
  JOIN experience_locations el ON el.id = uvl.location_id
 WHERE EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = el.experience_id)
ON CONFLICT (user_id, experience_id) DO NOTHING;

DELETE FROM user_visited_locations uvl
 USING experience_locations el
 WHERE el.id = uvl.location_id
   AND EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = el.experience_id);

COMMIT;
