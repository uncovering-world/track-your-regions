-- 186: a part's picture, subtitle and article are its own row's (ADR-0156 decision 3, #1426)
--
-- A serial World Heritage site's part kept what its component's Wikidata item
-- gives it -- the picture and its credit, the one-line description and the
-- English article -- on its point, and readers fell back from the point to the
-- part row (the Belfry of Mons: point 8330 held them, part 37725 none). They
-- move onto the part row, where every place keeps its own: the picture and its
-- credit, the one-line description as the place's subtitle (#1795: the line
-- under the name, which is what Wikidata's description is), and the article.
-- A part that holds a kind of its own (Karnak) keeps the values its kind
-- brought where it has them; the component's fill only what it lacks, as a
-- field that held nothing is filled (ADR-0089), unless a curator chose the
-- point's value and the part's is unclaimed. The point is cleared, and a
-- curator's claim on one of these fields moves with its value, the
-- description's as the subtitle's. A folded part (a merge folded it into another kind's place)
-- receives its point's too, so an undo brings them back.
--
-- What an earlier run wrote on a point that is no part -- a site of one
-- component, a component standing for its whole site -- goes too, unclaimed,
-- since the run gives such a point nothing now and the site shows its own.
--
-- The held proposals and answers about a point's description are about its
-- subtitle from now on, and the part's name follows its own article
-- (component_part_name), which a trigger on the part row now reads.
--
-- `01-schema.sql` declares the same functions and triggers for a fresh
-- database.
--
-- Re-runnable: a point already cleared moves nothing, and the renames find
-- nothing left to rename.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION part_follows_point(point_id INTEGER)
RETURNS VOID AS $$
  UPDATE experiences part
     SET name = COALESCE(point.name, part.name), location = point.location,
         -- Stamped as every writer of the table stamps it (ADR-0069).
         updated_at = NOW()
    FROM (SELECT el.experience_id, el.location,
                 component_part_name(el.name,
                   (SELECT own.metadata->>'wikipediaUrl' FROM experiences own WHERE own.id = el.experience_id),
                   el.external_ref,
                   (SELECT whole.name FROM experience_parts p JOIN experiences whole ON whole.id = p.whole_id
                     WHERE p.part_id = el.experience_id AND p.reason = 'component'
                     ORDER BY p.whole_id LIMIT 1)) AS name
            FROM experience_locations el WHERE el.id = point_id) point
   WHERE part.id = point.experience_id
     AND EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = point.experience_id AND p.reason = 'component')
     AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = point.experience_id
                       AND m.kind_id NOT IN (SELECT k.id FROM experience_kinds k WHERE k.is_virtual))
     AND (part.name IS DISTINCT FROM COALESCE(point.name, part.name)
          OR part.location IS DISTINCT FROM point.location);
  UPDATE experience_parts p SET external_ref = el.external_ref
    FROM experience_locations el
   WHERE el.id = point_id AND p.part_id = el.experience_id AND p.reason = 'component'
     AND p.external_ref IS DISTINCT FROM el.external_ref
     AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = el.experience_id
                       AND m.kind_id NOT IN (SELECT k.id FROM experience_kinds k WHERE k.is_virtual));
$$ LANGUAGE sql;

DROP TRIGGER IF EXISTS trg_follow_component_point ON experience_locations;
CREATE TRIGGER trg_follow_component_point
  AFTER UPDATE OF name, location, external_ref ON experience_locations
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.location IS DISTINCT FROM NEW.location
        OR OLD.external_ref IS DISTINCT FROM NEW.external_ref)
  EXECUTE FUNCTION follow_component_point();

CREATE OR REPLACE FUNCTION follow_part_article()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM part_follows_point(el.id)
     FROM experience_locations el
    WHERE el.experience_id = NEW.id AND names_nothing(el.name)
      AND EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = NEW.id AND p.reason = 'component');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_follow_part_article ON experiences;
CREATE TRIGGER trg_follow_part_article
  AFTER UPDATE OF metadata ON experiences
  FOR EACH ROW
  WHEN (OLD.metadata->>'wikipediaUrl' IS DISTINCT FROM NEW.metadata->>'wikipediaUrl')
  EXECUTE FUNCTION follow_part_article();

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
             -- The revived part keeps its own article (ADR-0156 decision 3).
             name = component_part_name(component.name, metadata->>'wikipediaUrl', component.external_ref,
                                        (SELECT whole.name FROM experiences whole WHERE whole.id = site))
       WHERE id = part;
    ELSE
      INSERT INTO experiences (source_id, external_id, name, location)
      SELECT whole.source_id, 'part:' || component.id,
             component_part_name(component.name, NULL, component.external_ref, whole.name),
             component.location
        FROM experiences whole WHERE whole.id = site
      RETURNING id INTO part;
    END IF;

    -- The relation's trigger writes the part's record in World Heritage
    -- components (component_record_follows_relation).
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

-- The parts' points: every point of a place that is, or was before a merge
-- folded it, a serial site's part.
CREATE TEMP TABLE part_points ON COMMIT DROP AS
SELECT el.id AS point_id, el.experience_id AS part_id,
       NULLIF(el.image_url, '') AS image_url,
       CASE WHEN jsonb_typeof(el.metadata -> 'imageCredit') = 'object' THEN el.metadata -> 'imageCredit' END AS credit,
       NULLIF(el.description, '') AS subtitle,
       NULLIF(el.metadata ->> 'wikipediaUrl', '') AS article,
       el.curated_fields AS claims
  FROM experience_locations el
  JOIN experiences part ON part.id = el.experience_id
 WHERE (part.external_id LIKE 'part:%'
        OR EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = part.id AND p.reason = 'component'))
   AND (el.image_url IS NOT NULL OR el.description IS NOT NULL
        OR el.metadata ?| ARRAY['imageCredit', 'wikipediaUrl']
        OR el.curated_fields ?| ARRAY['image_url', 'description', 'metadata.wikipediaUrl']);

-- One source point per part, its standing one first, so a part of several
-- points (a moved component) takes the content a reader was shown.
CREATE TEMP TABLE part_content ON COMMIT DROP AS
SELECT DISTINCT ON (pp.part_id) pp.*
  FROM part_points pp JOIN experience_locations el ON el.id = pp.point_id
 ORDER BY pp.part_id, (el.missing_since IS NULL AND el.merged_into_id IS NULL) DESC, el.id;

-- What each part takes from its point. A value fills a field the part holds
-- nothing in. A curator's value on the point also wins over what the part
-- holds unclaimed (a kind's value a run wrote), since a curator's word
-- outranks a run's. A claim moves with the value it protects, and a claim on
-- an empty point field moves where the part holds nothing either.
CREATE TEMP TABLE part_takes ON COMMIT DROP AS
SELECT c.*,
       (c.image_url IS NOT NULL AND (NULLIF(e.image_url, '') IS NULL
          OR (c.claims ? 'image_url' AND NOT COALESCE(e.curated_fields, '[]'::jsonb) ? 'image_url'))) AS take_image,
       (c.subtitle IS NOT NULL AND (NULLIF(e.subtitle, '') IS NULL
          OR (c.claims ? 'description' AND NOT COALESCE(e.curated_fields, '[]'::jsonb) ? 'subtitle'))) AS take_subtitle,
       (c.article IS NOT NULL AND (NULLIF(e.metadata ->> 'wikipediaUrl', '') IS NULL
          OR (c.claims ? 'metadata.wikipediaUrl'
              AND NOT COALESCE(e.curated_fields, '[]'::jsonb) ? 'metadata.wikipediaUrl'))) AS take_article,
       NULLIF(e.image_url, '') IS NULL AS part_no_image,
       NULLIF(e.subtitle, '') IS NULL AS part_no_subtitle,
       NULLIF(e.metadata ->> 'wikipediaUrl', '') IS NULL AS part_no_article
  FROM part_content c JOIN experiences e ON e.id = c.part_id;

UPDATE experiences e
   SET image_url = CASE WHEN t.take_image THEN t.image_url ELSE e.image_url END,
       -- A credit is its photograph's: it goes with a picture taken, and a
       -- picture taken without one drops the part's old one.
       metadata = (CASE WHEN t.take_image AND t.credit IS NOT NULL
                        THEN COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object('imageCredit', t.credit)
                        WHEN t.take_image THEN COALESCE(e.metadata, '{}'::jsonb) - 'imageCredit'
                        ELSE COALESCE(e.metadata, '{}'::jsonb) END)
                  || CASE WHEN t.take_article THEN jsonb_build_object('wikipediaUrl', t.article) ELSE '{}'::jsonb END,
       subtitle = CASE WHEN t.take_subtitle THEN t.subtitle ELSE e.subtitle END,
       curated_fields = (SELECT COALESCE(jsonb_agg(DISTINCT claim), '[]'::jsonb)
                           FROM (SELECT jsonb_array_elements_text(COALESCE(e.curated_fields, '[]'::jsonb)) AS claim
                                 UNION
                                 SELECT CASE k WHEN 'description' THEN 'subtitle' ELSE k END
                                   FROM jsonb_array_elements_text(t.claims) AS k
                                  WHERE (k = 'image_url' AND (t.take_image OR t.part_no_image))
                                     OR (k = 'description' AND (t.take_subtitle OR t.part_no_subtitle))
                                     OR (k = 'metadata.wikipediaUrl' AND (t.take_article OR t.part_no_article))) claims),
       updated_at = NOW()
  FROM part_takes t
 WHERE e.id = t.part_id;

UPDATE experience_locations el
   SET image_url = NULL, description = NULL,
       metadata = el.metadata - 'imageCredit' - 'wikipediaUrl',
       curated_fields = el.curated_fields - 'image_url' - 'description' - 'metadata.wikipediaUrl'
  FROM part_points pp
 WHERE el.id = pp.point_id;

-- A point that is no part -- a site of one component, a component standing for
-- its whole site -- is given nothing by the run from now on, since the site
-- shows its own: what an earlier run wrote there goes, where no curator
-- claimed it.
UPDATE experience_locations el
   SET image_url = CASE WHEN el.curated_fields ? 'image_url' THEN el.image_url END,
       description = CASE WHEN el.curated_fields ? 'description' THEN el.description END,
       metadata = el.metadata
                  - CASE WHEN el.curated_fields ? 'image_url' THEN '' ELSE 'imageCredit' END
                  - CASE WHEN el.curated_fields ? 'metadata.wikipediaUrl' THEN '' ELSE 'wikipediaUrl' END
 WHERE NOT EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = el.experience_id AND p.reason = 'component')
   -- What a curator's confirmed item gave the point is the curator's, which
   -- the run never wrote over either (claimPointItem).
   AND NOT el.curated_fields ? 'wikidata_item'
   AND EXISTS (SELECT 1 FROM experience_kind_memberships m WHERE m.experience_id = el.experience_id AND m.kind_id = 1)
   AND (el.image_url IS NOT NULL OR el.description IS NOT NULL OR el.metadata ?| ARRAY['imageCredit', 'wikipediaUrl']);

-- A point's description was the line under its name all along, which a held
-- proposal and an answer call its subtitle from now on: on a part's point it
-- publishes onto the part, on any other point onto the point's own
-- description (writeHeldPointFields).
UPDATE experience_sync_changes ch
   SET contents = jsonb_set(ch.contents, '{locations,changed}', (
         SELECT jsonb_agg(jsonb_set(entry, '{fields}', (
                  SELECT jsonb_agg(CASE WHEN f ->> 'field' = 'description'
                                        THEN jsonb_set(f, '{field}', '"subtitle"') ELSE f END)
                    FROM jsonb_array_elements(entry -> 'fields') f)))
           FROM jsonb_array_elements(ch.contents -> 'locations' -> 'changed') entry))
 WHERE jsonb_typeof(ch.contents -> 'locations' -> 'changed') = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(ch.contents -> 'locations' -> 'changed') entry,
                             jsonb_array_elements(entry -> 'fields') f
                WHERE f ->> 'field' = 'description');

UPDATE experience_held_decisions SET field = 'subtitle'
 WHERE part_kind = 'locations' AND field = 'description';

DO $$
DECLARE
  left_on_points INTEGER;
BEGIN
  SELECT count(*) INTO left_on_points
    FROM experience_locations el JOIN experiences part ON part.id = el.experience_id
   WHERE (part.external_id LIKE 'part:%'
          OR EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = part.id AND p.reason = 'component'))
     AND (el.image_url IS NOT NULL OR el.description IS NOT NULL OR el.metadata ?| ARRAY['imageCredit', 'wikipediaUrl']);
  IF left_on_points > 0 THEN
    RAISE EXCEPTION '% parts'' points still hold content', left_on_points;
  END IF;
END $$;

COMMIT;
