-- 179-a-part-is-never-named-the-or-a-bare-reference.sql
--
-- A serial site's component part is named for what it is, never "The" or a
-- bare reference (#2065). The World Heritage list writes two components of the
-- Archaeological Ensemble of Tarraco as "The " (875-012, the Roman villa of
-- Centcelles, and 875-013, Els Munts) and two sections of Via Appia (1708-003,
-- 1708-004) with no name, and a part took its point's name, else its
-- reference: on the development catalogue on 2026-10-26, two parts were named
-- "The" and two "1708-003" and "1708-004".
--
-- The point keeps what the list wrote. The part is named by
-- component_part_name(): the point's name; where that names nothing
-- (names_nothing: empty, or "The"), the title of the point's English
-- Wikipedia article; else the site's name with the reference. Both writers of a
-- part's name read it, part_site_components() when it parts a component and
-- part_follows_point() after every write of the point, which now also fires
-- when the point's article changes, since the run records the article after it
-- parts the site, and after a rename of the site, whose name a part named by
-- its reference carries.
--
-- This file declares the three functions, redeclares the two writers and the
-- trigger as 01-schema.sql does, adds the site's trigger, and renames the existing parts through
-- part_follows_point(), which writes only a part whose name differs.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

-- Whether a point's name names nothing (#2065): empty, or the lone article
-- "The". The World Heritage list, which names components in English, writes two
-- components of the Archaeological Ensemble of Tarraco as "The " (875-012, the
-- Roman villa of Centcelles, and 875-013, Els Munts) and two sections of Via
-- Appia with no name at all. No other lone article is in the catalogue, and a
-- wider list would take real names for one: Die in the Drôme, Å in Lofoten
-- once accents fold. The point keeps what the list wrote, since that is the
-- list's view of it. The test is cheap, since every reader's point name asks it
-- (pointNameSql in placePoints.ts).
CREATE OR REPLACE FUNCTION names_nothing(name TEXT) RETURNS BOOLEAN AS $$
  SELECT COALESCE(lower(btrim(name)), '') IN ('', 'the')
$$ LANGUAGE sql IMMUTABLE;

-- The title of the Wikipedia article at `url` as a reader reads it:
-- "https://en.wikipedia.org/wiki/Roman_quarry_of_El_M%C3%A8dol" is "Roman
-- quarry of El Mèdol". Null for an address that is not an article's, and for
-- one whose escapes are not UTF-8.
CREATE OR REPLACE FUNCTION wikipedia_article_title(url TEXT) RETURNS TEXT AS $$
DECLARE
  path TEXT := substring(url FROM '^https?://[a-z0-9-]+\.wikipedia\.org/wiki/([^?#]+)$');
  bytes BYTEA;
BEGIN
  IF path IS NULL THEN
    RETURN NULL;
  END IF;
  -- Each run of escapes is the bytes it spells, and the text between them its own UTF-8.
  SELECT string_agg(CASE WHEN m[1] IS NOT NULL THEN decode(replace(m[1], '%', ''), 'hex')
                         ELSE convert_to(m[2], 'UTF8') END, ''::bytea ORDER BY n)
    INTO bytes
    FROM regexp_matches(path, '((?:%[0-9A-Fa-f]{2})+)|([^%]+|%)', 'g') WITH ORDINALITY AS t(m, n);
  RETURN NULLIF(btrim(regexp_replace(convert_from(bytes, 'UTF8'), '[_[:space:]]+', ' ', 'g')), '');
EXCEPTION WHEN character_not_in_repertoire THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- What a component's part is called (ADR-0100, #2065): its point's name; where
-- that names nothing (names_nothing), the title of the point's English
-- Wikipedia article ("Roman villa of Centcelles" for Tarraco's "The "); where
-- the point has none either, the site's name with the component's reference
-- ("Via Appia. Regina Viarum (1708-003)"), so a part never reads as a bare
-- reference or an article. part_site_components names a part by it and
-- part_follows_point keeps the part named by it.
CREATE OR REPLACE FUNCTION component_part_name(point_name TEXT, article_url TEXT, point_ref TEXT, site_name TEXT)
RETURNS TEXT AS $$
  SELECT CASE WHEN NOT names_nothing(point_name) THEN point_name
              ELSE COALESCE(wikipedia_article_title(article_url), site_name || ' (' || point_ref || ')',
                            point_ref, site_name) END
$$ LANGUAGE sql IMMUTABLE;

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
    SELECT el.id, el.name, el.external_ref, el.location, el.metadata->>'wikipediaUrl' AS article
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
             name = component_part_name(component.name, component.article, component.external_ref,
                                        (SELECT whole.name FROM experiences whole WHERE whole.id = site))
       WHERE id = part;
    ELSE
      INSERT INTO experiences (source_id, external_id, name, location)
      SELECT whole.source_id, 'part:' || component.id,
             component_part_name(component.name, component.article, component.external_ref, whole.name),
             component.location
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

CREATE OR REPLACE FUNCTION part_follows_point(point_id INTEGER)
RETURNS VOID AS $$
  UPDATE experiences part
     SET name = COALESCE(point.name, part.name), location = point.location,
         -- Stamped as every writer of the table stamps it (ADR-0069).
         updated_at = NOW()
    FROM (SELECT el.experience_id, el.location,
                 component_part_name(el.name, el.metadata->>'wikipediaUrl', el.external_ref,
                   (SELECT whole.name FROM experience_parts p JOIN experiences whole ON whole.id = p.whole_id
                     WHERE p.part_id = el.experience_id AND p.reason = 'component'
                     ORDER BY p.whole_id LIMIT 1)) AS name
            FROM experience_locations el WHERE el.id = point_id) point
   WHERE part.id = point.experience_id
     AND EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = point.experience_id AND p.reason = 'component')
     AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = point.experience_id)
     AND (part.name IS DISTINCT FROM COALESCE(point.name, part.name)
          OR part.location IS DISTINCT FROM point.location);
  UPDATE experience_parts p SET external_ref = el.external_ref
    FROM experience_locations el
   WHERE el.id = point_id AND p.part_id = el.experience_id AND p.reason = 'component'
     AND p.external_ref IS DISTINCT FROM el.external_ref
     AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = el.experience_id);
$$ LANGUAGE sql;

DROP TRIGGER IF EXISTS trg_follow_component_point ON experience_locations;
CREATE TRIGGER trg_follow_component_point
  AFTER UPDATE OF name, location, external_ref, metadata ON experience_locations
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.location IS DISTINCT FROM NEW.location
        OR OLD.external_ref IS DISTINCT FROM NEW.external_ref
        OR OLD.metadata->>'wikipediaUrl' IS DISTINCT FROM NEW.metadata->>'wikipediaUrl')
  EXECUTE FUNCTION follow_component_point();

-- A part named by its site's name follows the site's rename.
CREATE OR REPLACE FUNCTION follow_component_site()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM part_follows_point(el.id)
     FROM experience_parts p
     JOIN experience_locations el ON el.experience_id = p.part_id
    WHERE p.whole_id = NEW.id AND p.reason = 'component' AND names_nothing(el.name);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_follow_component_site ON experiences;
CREATE TRIGGER trg_follow_component_site
  AFTER UPDATE OF name ON experiences
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION follow_component_site();

SELECT count(*) AS points_followed FROM (
  SELECT part_follows_point(el.id)
    FROM experience_locations el
   WHERE names_nothing(el.name)
     AND EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = el.experience_id AND p.reason = 'component')
) renamed;

COMMIT;
