-- 181: a virtual kind holds how the World Heritage list knows a part (ADR-0156, #1426)
--
-- A part of a serial World Heritage site (ADR-0100) held no membership, so
-- how the list knows it -- its reference, later its Wikidata item and the
-- list's view of it -- was spread over its point, its relation and a trigger.
-- A kind may now be virtual (`experience_kinds.is_virtual`): it records how a
-- source knows a place and offers none. Kind and source 10, World Heritage
-- components, is the first. Every part gets one membership in it, keyed by its
-- relation (`component:<experience_parts.id>`): the list's own reference is
-- not unique (Western Tien-Shan renumbers, Phong Nha-Ke Bang and Hin Nam No
-- share 951ter-001). The membership carries nothing else yet; the item, the
-- view and the part's own fields follow in the next slices of #1426.
--
-- Nothing a reader, a curator or an admin sees changes: every predicate in
-- backend/src/db/membership.ts that offers a place or names its kind leaves a
-- virtual kind out (`realKindSql`), and so do the three functions replaced
-- here that read a place's memberships -- the listing a place derives from
-- them, the pairing marks, and the part following its point. A part's record
-- is its relation's: a trigger on experience_parts writes it with the
-- relation, moves it when a merge or its undo moves the relation, and drops it
-- with the relation (component_record_follows_relation).
--
-- `01-schema.sql` declares the same column, rows and functions for a fresh
-- database.
--
-- Re-runnable: the column and the seeds are guarded, the functions replaced,
-- and a part that holds its membership already is skipped.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kinds ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN experience_kinds.is_virtual IS 'The kind records how a source knows a place and offers none (ADR-0156): no reader, curator or admin surface lists, counts or offers a place by it.';

INSERT INTO experience_kinds (id, name, display_priority, is_virtual) VALUES
    (10, 'World Heritage components', 10, TRUE)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_kinds_id_seq', GREATEST((SELECT MAX(id) FROM experience_kinds), 1));

INSERT INTO experience_sources (id, name, description, api_endpoint, api_config, display_priority, requires_curation, kind_id)
VALUES (
    10,
    'World Heritage components',
    'The components of serial World Heritage sites, as the World Heritage list knows each part, written by the UNESCO run',
    NULL,
    '{}'::jsonb,
    10,
    false,
    (SELECT id FROM experience_kinds WHERE name = 'World Heritage components')
)
ON CONFLICT (name) DO NOTHING;
SELECT setval('experience_sources_id_seq', GREATEST((SELECT MAX(id) FROM experience_sources), 1));

CREATE OR REPLACE FUNCTION recompute_place_listing(place_id INTEGER) RETURNS void AS $$
BEGIN
    UPDATE experiences e
       SET missing_since = d.missing_since,
           source_membership = d.source_membership
      FROM (SELECT CASE WHEN bool_and(m.missing_since IS NOT NULL) THEN max(m.missing_since) END AS missing_since,
                   CASE WHEN bool_and(m.source_membership = 'former') THEN 'former' ELSE 'present' END AS source_membership
              FROM experience_kind_memberships m
             WHERE m.experience_id = place_id
               AND m.kind_id NOT IN (SELECT k.id FROM experience_kinds k WHERE k.is_virtual)) d
     WHERE e.id = place_id
       AND (e.missing_since IS DISTINCT FROM d.missing_since
            OR e.source_membership IS DISTINCT FROM d.source_membership);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mark_pairing_due() RETURNS TRIGGER AS $$
DECLARE
  ids INTEGER[];
  row_kind INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'experiences' THEN
    ids := ARRAY[CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.id END,
                 CASE WHEN TG_OP = 'UPDATE' THEN NEW.merged_into_id END];
  ELSIF TG_TABLE_NAME = 'experience_parts' THEN
    ids := CASE WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.whole_id, OLD.part_id] ELSE ARRAY[NEW.whole_id, NEW.part_id] END;
  ELSIF TG_TABLE_NAME = 'experience_separations' THEN
    ids := ARRAY[NEW.original_id, NEW.separated_id];
  ELSE
    -- A membership of a virtual kind changes nothing the pairing reads
    -- (ADR-0156): the part it records was marked when it was parted. Its own
    -- IF, since an AND would not keep the other tables' rows from being asked
    -- for a kind_id they do not have.
    IF TG_TABLE_NAME = 'experience_kind_memberships' THEN
      IF TG_OP = 'DELETE' THEN
        row_kind := OLD.kind_id;
      ELSE
        row_kind := NEW.kind_id;
      END IF;
      IF row_kind IN (SELECT k.id FROM experience_kinds k WHERE k.is_virtual) THEN
        RETURN NULL;
      END IF;
    END IF;
    -- experience_kind_memberships and experience_locations: the row's place, and
    -- the place it left where it moved.
    ids := ARRAY[CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.experience_id END,
                 CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.experience_id END];
  END IF;
  -- DO UPDATE, not DO NOTHING: it locks a mark that is already there, so a
  -- drain deleting it waits for this transaction to commit and then pairs the
  -- place as this transaction left it.
  INSERT INTO experience_pairing_due (experience_id)
  SELECT DISTINCT i FROM unnest(ids) AS i
   WHERE i IS NOT NULL AND EXISTS (SELECT 1 FROM experiences e WHERE e.id = i)
  ON CONFLICT (experience_id) DO UPDATE SET marked_at = NOW();
  RETURN NULL;
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

CREATE OR REPLACE FUNCTION refresh_component_record(place INTEGER) RETURNS void AS $$
DECLARE
  owner INTEGER;
BEGIN
  SELECT min(p.id) INTO owner FROM experience_parts p WHERE p.part_id = place AND p.reason = 'component';
  IF owner IS NULL THEN
    DELETE FROM experience_kind_memberships WHERE experience_id = place AND kind_id = 10;
  ELSE
    UPDATE experience_kind_memberships SET external_id = 'component:' || owner, updated_at = NOW()
     WHERE experience_id = place AND kind_id = 10 AND external_id <> 'component:' || owner;
    INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id)
    VALUES (place, 10, 10, 'component:' || owner)
    ON CONFLICT (experience_id, kind_id) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION component_record_follows_relation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The record itself moves with the relation, so a merge's undo, which
    -- moves both back, finds the row it moved.
    UPDATE experience_kind_memberships SET experience_id = NEW.part_id, updated_at = NOW()
     WHERE kind_id = 10 AND external_id = 'component:' || NEW.id AND experience_id = OLD.part_id
       AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships held
                        WHERE held.experience_id = NEW.part_id AND held.kind_id = 10);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM refresh_component_record(OLD.part_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM refresh_component_record(NEW.part_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_component_record_follows_relation ON experience_parts;
CREATE TRIGGER trg_component_record_follows_relation
  AFTER INSERT OR DELETE ON experience_parts
  FOR EACH ROW EXECUTE FUNCTION component_record_follows_relation();
DROP TRIGGER IF EXISTS trg_component_record_follows_relation_move ON experience_parts;
CREATE TRIGGER trg_component_record_follows_relation_move
  AFTER UPDATE OF part_id ON experience_parts
  FOR EACH ROW WHEN (OLD.part_id IS DISTINCT FROM NEW.part_id)
  EXECUTE FUNCTION component_record_follows_relation();

-- Every part's membership, after the functions that read memberships leave
-- a virtual one out, so the trigger that derives a place's listing changes no
-- place and the pairing marks none.
INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id)
SELECT p.part_id, 10, 10, 'component:' || min(p.id)
  FROM experience_parts p
 WHERE p.reason = 'component'
 GROUP BY p.part_id
ON CONFLICT (experience_id, kind_id) DO NOTHING;

DO $$
DECLARE
  parts INTEGER;
  held INTEGER;
BEGIN
  SELECT count(DISTINCT part_id) INTO parts FROM experience_parts WHERE reason = 'component';
  SELECT count(*) INTO held FROM experience_kind_memberships WHERE kind_id = 10;
  IF held <> parts THEN
    RAISE EXCEPTION 'World Heritage components holds % memberships for % parts', held, parts;
  END IF;
END $$;

COMMIT;
