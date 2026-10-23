-- 161-a-component-that-stands-for-its-site-is-not-a-part.sql
--
-- A component that stands for its whole site stays the site's own point and is
-- not parted as a place of its own (#1899). part_site_components() parted every
-- component of a serial site, so a point the list names like the site, or gives
-- the site's own reference, became a part named like its site, and a traveller
-- met the site twice: on the development catalogue on 2026-10-23, 30 such parts
-- on 22 sites, Baalbek (294) and the Wudang Mountains (705) under the site's own
-- reference, the Historic Centre of Prague and Angkor named like their sites,
-- and the W-Arly-Pendjari Complex four times.
--
-- The rule is stated once, here and in 01-schema.sql: stands_for_whole_site(),
-- which part_site_components() and the component-item finder read. This file
-- declares the two functions, redeclares part_site_components() to read the
-- rule, and folds the existing parts back into their sites:
--   - the part's point goes back to the site, keeping its id;
--   - a traveller's visit to the part goes back to its point, a tick on one
--     location rather than a visit to the whole site;
--   - the part relation goes, and the part place is marked folded into its
--     site (merged_into_id), so a link to it opens the site. It keeps its key
--     ('part:' and the point's id): should the point stop standing for the
--     site, part_site_components() revives it rather than making another.
-- A part a kind of its own holds, that a merge names, or that has parts of its
-- own is left as it is: it is more than the component.
--
-- Re-runnable: a folded part is no longer a part.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION name_match_key(name TEXT) RETURNS TEXT AS $$
  SELECT btrim(regexp_replace(lower(immutable_unaccent(regexp_replace(name, '<[^>]*>', '', 'g'))),
                              '[^[:alnum:]]+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

-- Whether a World Heritage point stands for its whole site rather than for one
-- component of it (#1899): the only standing point of a site of one, a point
-- the list gives the site's own reference (Baalbek's 294), or a point named
-- like the site, folded and no looser ("Historic Centre of Prague" of the
-- Historic Centre of Prague; "Historic Centre of Siena (Cathedral)" is a
-- component). Its item is the site's own and anything near it is a building
-- inside, so the component-item finder searches nothing for it, and it is not
-- parted as a place of its own (part_site_components).
CREATE OR REPLACE FUNCTION stands_for_whole_site(point_name TEXT, point_ref TEXT, site_name TEXT, site_ref TEXT,
                                                 standing_points INTEGER) RETURNS BOOLEAN AS $$
  SELECT standing_points <= 1
      OR (point_ref IS NOT NULL AND point_ref = site_ref)
      OR (point_name IS NOT NULL AND name_match_key(point_name) = name_match_key(site_name))
$$ LANGUAGE sql IMMUTABLE;

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
-- its own has no regions of its own: lists find it through its site. A
-- component that stands for its whole site (stands_for_whole_site) is not
-- parted: it stays the site's own point, since a part named like the site
-- would show the site twice (#1899); one that stops standing for it is
-- parted again, reviving the part migration 161 folded. Answers how many
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
       AND NOT stands_for_whole_site(el.name, el.external_ref,
             (SELECT whole.name FROM experiences whole WHERE whole.id = site),
             (SELECT m.external_id FROM experience_kind_memberships m WHERE m.id = site_membership), 2)
     ORDER BY el.id
  LOOP
    -- A part folded back into this site once its point stood for the whole
    -- site (migration 161) is revived rather than made again: it keeps the
    -- point's key, and a link to it opens it again.
    SELECT folded.id INTO part
      FROM experiences folded JOIN experiences whole ON whole.id = site
     WHERE folded.source_id = whole.source_id AND folded.external_id = 'part:' || component.id
       AND folded.merged_into_id = site;
    IF part IS NOT NULL THEN
      UPDATE experiences
         SET merged_into_id = NULL, location = component.location, updated_at = NOW(),
             name = COALESCE(NULLIF(component.name, ''), component.external_ref,
                             (SELECT whole.name FROM experiences whole WHERE whole.id = site))
       WHERE id = part;
    ELSE
      INSERT INTO experiences (source_id, external_id, name, location)
      SELECT whole.source_id, 'part:' || component.id,
             COALESCE(NULLIF(component.name, ''), component.external_ref, whole.name), component.location
        FROM experiences whole WHERE whole.id = site
      RETURNING id INTO part;
    END IF;

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


CREATE TEMP TABLE self_part ON COMMIT DROP AS
SELECT DISTINCT p.id AS relation_id, p.part_id, p.whole_id
  FROM experience_parts p
  JOIN experiences w ON w.id = p.whole_id
  JOIN experience_kind_memberships m ON m.id = p.membership_id
  JOIN experience_locations el ON el.experience_id = p.part_id AND el.merged_into_id IS NULL
                              AND el.external_ref IS NOT DISTINCT FROM p.external_ref
 WHERE p.reason = 'component'
   AND stands_for_whole_site(el.name, el.external_ref, w.name, m.external_id, 2)
   AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships k WHERE k.experience_id = p.part_id)
   AND NOT EXISTS (SELECT 1 FROM experience_merges g WHERE p.part_id IN (g.survivor_id, g.folded_id))
   AND NOT EXISTS (SELECT 1 FROM experience_parts o WHERE o.whole_id = p.part_id);

SELECT (SELECT count(*) FROM self_part) AS parts_folded,
       (SELECT count(DISTINCT whole_id) FROM self_part) AS sites,
       (SELECT count(*) FROM experience_locations el JOIN self_part s ON el.experience_id = s.part_id) AS points_moved,
       (SELECT count(*) FROM user_visited_experiences v JOIN self_part s ON v.experience_id = s.part_id) AS visits_moved;

-- A visit to the part was a tick on its point before the parting made it a
-- visit to the place: it goes back to the point, as part_site_components()
-- takes it again should it revive the part. Made a visit to the site, one
-- location's tick would mark a whole serial site visited.
INSERT INTO user_visited_locations (user_id, location_id, visited_at, notes)
SELECT v.user_id, el.id, v.visited_at, v.notes
  FROM user_visited_experiences v
  JOIN self_part s ON v.experience_id = s.part_id
  JOIN experience_locations el ON el.experience_id = s.part_id
ON CONFLICT (user_id, location_id) DO NOTHING;
DELETE FROM user_visited_experiences v USING self_part s WHERE v.experience_id = s.part_id;

UPDATE experience_locations el SET experience_id = s.whole_id
  FROM self_part s WHERE el.experience_id = s.part_id;

DELETE FROM experience_parts p USING self_part s WHERE p.id = s.relation_id;

UPDATE experiences e SET merged_into_id = s.whole_id, updated_at = NOW()
  FROM self_part s WHERE e.id = s.part_id;

COMMIT;
