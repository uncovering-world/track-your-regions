-- 233-part-of-follows-the-records.sql
--
-- "Part of" is derived from the records that claim it (#2118, ADR-0198
-- decision 5). A (whole, part) pair of experience_parts stands while a record
-- in the whole claims it, and a curator's record decides alone where there is
-- one; one trigger on source_records writes it (parts_follow_records), and no
-- other writer is left. The relation's own copies of what its record holds go:
-- the component's reference (external_ref, now the record's external_id) and
-- the site's membership (membership_id, now read as the whole's World Heritage
-- membership). part_site_components() writes a part's record, not its
-- relation, and the registry reads a component's reference off its record.
--
-- What it writes: no row of the catalogue. On the development catalogue every
-- relation is a component's, each with its record under the same reference
-- and its site's World Heritage membership, so the derived relations are the
-- ones the table holds; the file asserts each of those premises before and
-- after, and refuses a database where one fails rather than rewrite the
-- relations. Old merges named the relations they moved (moved.parts), and
-- their undo now moves records: a merge that moved a relation as its whole is
-- refused, and a merge that moved a part is given the id of that part's
-- record in its memberships where it lacks it -- 174 merges of 2026-10-18 to
-- 23 on the development catalogue, recorded before the parts had records
-- (migration 181) -- so its undo moves the record, and the relation with it,
-- back. That is the one row it writes, in experience_merges, which carries no
-- trigger.
--
-- Order: every change of shape first, the old triggers before the columns
-- their WHEN and UPDATE OF lists name; then the merges' records.
-- Re-runnable: each step is guarded on what it changes.
-- Before the next re-application of 01-schema.sql, which refuses to run while
-- experience_parts still carries external_ref or membership_id.

\set ON_ERROR_STOP on

BEGIN;

-- The relations the records derive are the ones the table holds, and each
-- component's relation names its record's reference: nothing is lost with
-- the columns.
DO $$
DECLARE
    only_in_table INTEGER;
    only_derived INTEGER;
    refs_differ INTEGER := 0;
    memberships_differ INTEGER := 0;
BEGIN
    WITH derived AS (
      SELECT rec.whole_id, rec.experience_id AS part_id,
             CASE WHEN bool_or(s.id_scheme = 'whc-component') THEN 'component'
                  WHEN bool_or(s.id_scheme = 'wikidata-statement') THEN 'wikidata_part_of' ELSE 'curator' END AS reason
        FROM source_records rec JOIN experience_sources s ON s.id = rec.source_id
       WHERE rec.whole_id IS NOT NULL AND rec.whole_id <> rec.experience_id
       GROUP BY 1, 2
      HAVING NOT (bool_or(s.id_scheme = 'curator') AND NOT bool_or(s.id_scheme = 'curator' AND rec.admission = 'admitted')))
    SELECT (SELECT count(*) FROM (SELECT whole_id, part_id, reason::text FROM experience_parts
                                  EXCEPT SELECT whole_id, part_id, reason FROM derived) a),
           (SELECT count(*) FROM (SELECT whole_id, part_id, reason FROM derived
                                  EXCEPT SELECT whole_id, part_id, reason::text FROM experience_parts) b)
      INTO only_in_table, only_derived;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'experience_parts' AND column_name = 'external_ref') THEN
        EXECUTE $q$SELECT count(*) FROM experience_parts p
                     JOIN source_records r ON r.source_id = 10 AND r.whole_id = p.whole_id AND r.experience_id = p.part_id
                    WHERE r.external_id IS DISTINCT FROM p.external_ref$q$ INTO refs_differ;
    END IF;
    -- The readers that named the relation's membership read the whole's World
    -- Heritage membership instead (siteMembershipSql): the same row.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'experience_parts' AND column_name = 'membership_id') THEN
        EXECUTE $q$SELECT count(*) FROM experience_parts p
                    WHERE p.reason = 'component'
                      AND p.membership_id IS DISTINCT FROM (SELECT w.id FROM source_records w
                                                             WHERE w.experience_id = p.whole_id AND w.source_id = 1)$q$
           INTO memberships_differ;
    END IF;
    IF only_in_table > 0 OR only_derived > 0 OR refs_differ > 0 OR memberships_differ > 0 THEN
        RAISE EXCEPTION 'migration 233: % relations no record claims, % claims with no relation, % references and % memberships that differ from what the record and the whole give',
            only_in_table, only_derived, refs_differ, memberships_differ;
    END IF;
END $$;

-- Merges recorded before this file named the relations they moved
-- (moved.parts), and their undo now moves the records in the folded whole
-- (moved.wholeRecords) and the place's own records (moved.memberships). A
-- merge that moved a part is undone whole by the second; one whose folded
-- place was a whole of a relation it moved would leave that whole's parts
-- on the survivor when undone, so a database holding one is refused.
DO $$
DECLARE
    whole_side INTEGER;
BEGIN
    SELECT count(*) INTO whole_side
      FROM experience_merges m
      CROSS JOIN LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(m.moved->'parts') = 'array' THEN m.moved->'parts' ELSE '[]'::jsonb END) AS rel(id)
      JOIN experience_parts p ON p.id = rel.id::int
     WHERE m.undone_at IS NULL AND p.whole_id IN (m.survivor_id, m.folded_id);
    IF whole_side > 0 THEN
        RAISE EXCEPTION 'migration 233: % relations an old merge moved as the whole, which its undo would no longer move back', whole_side;
    END IF;
END $$;

-- The triggers that kept a record following its relation, and the
-- registry's following of the relation's reference, go first: their WHEN and
-- UPDATE OF lists name the columns that go next.
DROP TRIGGER IF EXISTS trg_component_record_follows_relation ON experience_parts;
DROP TRIGGER IF EXISTS trg_component_record_follows_relation_move ON experience_parts;
DROP TRIGGER IF EXISTS trg_place_identifiers_part_write ON experience_parts;
DROP TRIGGER IF EXISTS trg_place_identifiers_part_update ON experience_parts;
DROP FUNCTION IF EXISTS component_record_follows_relation();
DROP FUNCTION IF EXISTS refresh_component_record(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS place_identifiers_follow_part();

DROP INDEX IF EXISTS idx_experience_parts_external_ref;
ALTER TABLE experience_parts DROP COLUMN IF EXISTS external_ref;
ALTER TABLE experience_parts DROP COLUMN IF EXISTS membership_id;
COMMENT ON TABLE experience_parts IS 'A place that is part of another (ADR-0046 decision 6, ADR-0100), derived from the source records that claim it (ADR-0198 decision 5) by parts_follow_records(), its one writer: a pair stands while a record in the whole claims it, and a curator''s record decides alone where there is one. reason names the strongest claim: a component of a serial World Heritage site (component), a Wikidata part-of statement (wikidata_part_of), or a curator alone (curator).';

-- The registry reads a component's reference off its record.
CREATE OR REPLACE FUNCTION place_identifier_claims(p_scheme TEXT, p_values TEXT[])
RETURNS TABLE (experience_id INTEGER, value TEXT, basis TEXT, claims BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT m.experience_id, m.external_id::text, 'membership', true
    FROM source_records m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'wikidata' AND m.external_id = ANY(p_values) AND m.external_id ~ '^Q[0-9]+$'
  UNION ALL
  SELECT m.experience_id, item, 'site-items',
         cardinality(m.wikidata_items) = 1
           AND (SELECT count(*) FROM experience_locations one_point
                 WHERE one_point.experience_id = m.experience_id
                   AND one_point.merged_into_id IS NULL AND one_point.missing_since IS NULL) = 1
    FROM source_records m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
    CROSS JOIN LATERAL unnest(m.wikidata_items) AS item
   WHERE p_scheme = 'wikidata' AND m.wikidata_items && p_values::text[] AND item = ANY(p_values)
     AND m.kind_id IS NOT NULL
  UNION ALL
  SELECT rec.experience_id, item, 'component-item',
         NOT EXISTS (SELECT 1 FROM source_records other
                       JOIN experiences other_place ON other_place.id = other.experience_id
                        AND other_place.merged_into_id IS NULL
                      WHERE other.source_id = 10 AND other.whole_id IS NOT NULL AND other.wikidata_items @> ARRAY[item]
                        AND other.experience_id <> rec.experience_id
                        AND EXISTS (SELECT 1 FROM experience_locations other_point
                                     WHERE other_point.experience_id = other.experience_id
                                       AND other_point.merged_into_id IS NULL AND other_point.missing_since IS NULL))
           AND NOT EXISTS (SELECT 1 FROM experience_locations other
                             JOIN experiences other_place ON other_place.id = other.experience_id
                              AND other_place.merged_into_id IS NULL
                            WHERE other.wikidata_item = item AND other.experience_id <> rec.experience_id
                              AND other.merged_into_id IS NULL AND other.missing_since IS NULL)
    FROM source_records rec
    JOIN experiences e ON e.id = rec.experience_id AND e.merged_into_id IS NULL
    CROSS JOIN LATERAL unnest(rec.wikidata_items) AS item
   WHERE p_scheme = 'wikidata' AND rec.source_id = 10 AND rec.whole_id IS NOT NULL
     AND rec.wikidata_items && p_values::text[] AND item = ANY(p_values)
     -- A part whose point stands, as a point's item counted only a standing point.
     AND EXISTS (SELECT 1 FROM experience_locations standing
                  WHERE standing.experience_id = rec.experience_id
                    AND standing.merged_into_id IS NULL AND standing.missing_since IS NULL)
  UNION ALL
  SELECT point.experience_id, point.wikidata_item::text, 'point',
         NOT EXISTS (SELECT 1 FROM experience_locations other
                       JOIN experiences other_place ON other_place.id = other.experience_id
                        AND other_place.merged_into_id IS NULL
                      WHERE other.wikidata_item = point.wikidata_item
                        AND other.experience_id <> point.experience_id
                        AND other.merged_into_id IS NULL AND other.missing_since IS NULL)
           AND NOT EXISTS (SELECT 1 FROM source_records other_rec
                             JOIN experiences other_place ON other_place.id = other_rec.experience_id
                              AND other_place.merged_into_id IS NULL
                            WHERE other_rec.source_id = 10 AND other_rec.whole_id IS NOT NULL
                              AND other_rec.wikidata_items @> ARRAY[point.wikidata_item::text]
                              AND other_rec.experience_id <> point.experience_id
                              AND EXISTS (SELECT 1 FROM experience_locations other_point
                                           WHERE other_point.experience_id = other_rec.experience_id
                                             AND other_point.merged_into_id IS NULL AND other_point.missing_since IS NULL))
    FROM experience_locations point
    JOIN experiences e ON e.id = point.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'wikidata' AND point.wikidata_item = ANY(p_values)
     AND point.merged_into_id IS NULL AND point.missing_since IS NULL
  UNION ALL
  SELECT m.experience_id, m.external_id::text, 'membership', true
    FROM source_records m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'whc' AND m.source_id = 1 AND m.external_id = ANY(p_values)
  UNION ALL
  SELECT rec.experience_id, rec.external_id::text, 'component',
         NOT EXISTS (SELECT 1 FROM source_records other
                       JOIN experiences other_part ON other_part.id = other.experience_id
                        AND other_part.merged_into_id IS NULL
                      WHERE other.source_id = 10 AND other.whole_id IS NOT NULL
                        AND other.external_id = rec.external_id AND other.experience_id <> rec.experience_id)
    FROM source_records rec
    JOIN experiences e ON e.id = rec.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'whc' AND rec.source_id = 10 AND rec.whole_id IS NOT NULL AND rec.external_id = ANY(p_values)
  UNION ALL
  -- A curator's word (ADR-0143 decision 5): identifies claims whether or not a
  -- column carries the value; refers carries it without claiming; removed is
  -- applied by place_identifiers_expected(), which drops the row.
  SELECT v.experience_id, v.value::text, 'curator', v.verdict = 'identifies'
    FROM place_identifier_verdicts v
    JOIN experiences e ON e.id = v.experience_id AND e.merged_into_id IS NULL
   WHERE v.scheme = p_scheme AND v.value = ANY(p_values) AND v.verdict IN ('identifies', 'refers')
$$;

CREATE OR REPLACE FUNCTION place_identifier_values()
RETURNS TABLE (scheme TEXT, value TEXT)
LANGUAGE sql STABLE AS $$
  SELECT 'wikidata', external_id::text FROM source_records WHERE external_id ~ '^Q[0-9]+$'
  UNION SELECT 'wikidata', unnest(wikidata_items) FROM source_records WHERE wikidata_items IS NOT NULL
  UNION SELECT 'wikidata', wikidata_item::text FROM experience_locations WHERE wikidata_item IS NOT NULL
  UNION SELECT 'whc', external_id::text FROM source_records WHERE source_id = 1
  UNION SELECT 'whc', external_id::text FROM source_records WHERE source_id = 10 AND whole_id IS NOT NULL
  UNION SELECT scheme::text, value::text FROM place_identifier_verdicts
$$;

CREATE OR REPLACE FUNCTION refresh_place_identifiers_of(
  p_places INTEGER[], p_items TEXT[] DEFAULT NULL, p_refs TEXT[] DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  items TEXT[];
  refs TEXT[];
  osms TEXT[];
BEGIN
  SELECT array_agg(DISTINCT v) INTO items FROM (
    SELECT unnest(p_items) AS v
    UNION ALL
    SELECT value FROM place_identifiers WHERE scheme = 'wikidata' AND experience_id = ANY(p_places)
    UNION ALL
    SELECT external_id FROM source_records
     WHERE experience_id = ANY(p_places) AND external_id ~ '^Q[0-9]+$'
    UNION ALL
    SELECT unnest(wikidata_items) FROM source_records
     WHERE experience_id = ANY(p_places) AND wikidata_items IS NOT NULL
    UNION ALL
    SELECT wikidata_item FROM experience_locations
     WHERE experience_id = ANY(p_places) AND wikidata_item IS NOT NULL
    UNION ALL
    SELECT value FROM place_identifier_verdicts WHERE scheme = 'wikidata' AND experience_id = ANY(p_places)) carried
   WHERE v IS NOT NULL;
  SELECT array_agg(DISTINCT v) INTO refs FROM (
    SELECT unnest(p_refs) AS v
    UNION ALL
    SELECT value FROM place_identifiers WHERE scheme = 'whc' AND experience_id = ANY(p_places)
    UNION ALL
    SELECT external_id FROM source_records WHERE experience_id = ANY(p_places) AND source_id = 1
    UNION ALL
    SELECT external_id FROM source_records
     WHERE experience_id = ANY(p_places) AND source_id = 10 AND whole_id IS NOT NULL
    UNION ALL
    SELECT value FROM place_identifier_verdicts WHERE scheme = 'whc' AND experience_id = ANY(p_places)) carried
   WHERE v IS NOT NULL;
  -- An OpenStreetMap object is carried by a curator's word alone until a run records one.
  SELECT array_agg(DISTINCT v) INTO osms FROM (
    SELECT value AS v FROM place_identifiers WHERE scheme = 'osm' AND experience_id = ANY(p_places)
    UNION ALL
    SELECT value FROM place_identifier_verdicts WHERE scheme = 'osm' AND experience_id = ANY(p_places)) carried
   WHERE v IS NOT NULL;
  PERFORM lock_place_identifier_keys(ARRAY(
    SELECT place_identifier_lock_key('wikidata', v) FROM unnest(items) AS v
    UNION SELECT place_identifier_lock_key('whc', v) FROM unnest(refs) AS v
    UNION SELECT place_identifier_lock_key('osm', v) FROM unnest(osms) AS v));
  PERFORM refresh_place_identifiers('wikidata', items);
  PERFORM refresh_place_identifiers('whc', refs);
  PERFORM refresh_place_identifiers('osm', osms);
END;
$$;

CREATE OR REPLACE FUNCTION place_identifiers_follow_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A value the old row carried and its place no longer holds is left only on
  -- other places; naming the old values reaches them.
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_place_identifiers_of(ARRAY[NEW.experience_id]);
  ELSE
    PERFORM refresh_place_identifiers_of(
      array_remove(ARRAY[OLD.experience_id, CASE WHEN TG_OP <> 'DELETE' THEN NEW.experience_id END], NULL),
      OLD.wikidata_items || CASE WHEN OLD.external_id ~ '^Q[0-9]+$' THEN OLD.external_id::text END,
      -- A World Heritage reference: a site's number, or a component's on its
      -- record in a whole (ADR-0198).
      CASE WHEN OLD.source_id = 1 OR (OLD.source_id = 10 AND OLD.whole_id IS NOT NULL)
           THEN ARRAY[OLD.external_id::text] END);
  END IF;
  RETURN NULL;
END;
$$;

-- A part is made by its record.
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
    SELECT el.id, el.name, el.external_ref, el.location, el.missing_since, el.withdrawal_deferred_for_location_id
      FROM experience_locations el
     WHERE el.experience_id = site AND el.merged_into_id IS NULL
       AND (EXISTS (SELECT 1 FROM experience_location_placements pl
                     WHERE pl.location_id = el.id AND pl.membership_id = site_membership)
            OR NOT EXISTS (SELECT 1 FROM experience_location_placements pl
                            WHERE pl.location_id = el.id))
       AND NOT stands_for_whole_site(el.name, el.external_ref,
             (SELECT whole.name FROM experiences whole WHERE whole.id = site),
             (SELECT m.external_id FROM source_records m WHERE m.id = site_membership), 2)
     ORDER BY el.id
  LOOP
    -- A component that moved is the part it moved from (#2182): its point
    -- arrives as a new point, the withdrawal of the one it replaces held for
    -- it under a gate or applied at once without one, and the arrival goes on
    -- that part rather than making a second place of the same reserve or
    -- hillside. Found by its name, which carries the component across a new
    -- number as well as a new spot (Western Tien-Shan's Boraldaitau area,
    -- 1490-005 to 1490-003 and 85 km): the part's point this one replaces,
    -- else one the list dropped, of the same name, on a part with no other
    -- point standing. A name that names nothing finds none.
    part := NULL;
    IF component.missing_since IS NULL AND NOT names_nothing(component.name) THEN
      SELECT p.part_id INTO part
        FROM experience_parts p
        JOIN experience_locations old ON old.experience_id = p.part_id AND old.merged_into_id IS NULL
       WHERE p.whole_id = site AND p.reason = 'component'
         AND name_match_key(old.name) = name_match_key(component.name)
         AND (old.id = component.withdrawal_deferred_for_location_id OR old.missing_since IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM experience_locations standing
                          WHERE standing.experience_id = p.part_id AND standing.merged_into_id IS NULL
                            AND standing.missing_since IS NULL AND standing.id <> old.id)
       ORDER BY old.id = component.withdrawal_deferred_for_location_id DESC,
                whc_ref_bare(old.external_ref) IS NOT DISTINCT FROM whc_ref_bare(component.external_ref) DESC,
                old.missing_since DESC NULLS FIRST, p.id
       LIMIT 1;
    END IF;
    IF part IS NOT NULL THEN
      UPDATE experience_locations SET experience_id = part WHERE id = component.id;
      CONTINUE;
    END IF;
    -- A part is a line the list names, under its reference (ADR-0198): a point
    -- the list gives no reference (a site's one main point, before a list of
    -- components) is no component and stays the site's own.
    IF component.external_ref IS NULL THEN
      CONTINUE;
    END IF;

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

    -- The part's record of World Heritage components in its site, under the
    -- component's reference; the relation follows it (parts_follow_records).
    INSERT INTO source_records (experience_id, whole_id, source_id, external_id)
    VALUES (part, site, 10, component.external_ref);

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

-- "Part of" follows the records.
CREATE OR REPLACE FUNCTION refresh_part_relation(p_whole INTEGER, p_part INTEGER) RETURNS void AS $$
DECLARE
  claim RECORD;
  wanted TEXT;
  held TEXT;
BEGIN
  IF p_whole IS NULL OR p_part IS NULL OR p_whole = p_part THEN
    RETURN;
  END IF;
  SELECT count(*) AS records,
         bool_or(s.id_scheme = 'curator') AS curated,
         bool_or(s.id_scheme = 'curator' AND rec.admission = 'admitted') AS curator_in,
         bool_or(s.id_scheme = 'whc-component') AS component,
         bool_or(s.id_scheme = 'wikidata-statement') AS statement
    INTO claim
    FROM source_records rec JOIN experience_sources s ON s.id = rec.source_id
   WHERE rec.whole_id = p_whole AND rec.experience_id = p_part;
  IF claim.records > 0 AND NOT (claim.curated AND NOT claim.curator_in) THEN
    wanted := CASE WHEN claim.component THEN 'component'
                   WHEN claim.statement THEN 'wikidata_part_of'
                   ELSE 'curator' END;
  END IF;
  SELECT p.reason INTO held FROM experience_parts p WHERE p.whole_id = p_whole AND p.part_id = p_part;
  IF wanted IS NULL AND held IS NOT NULL THEN
    DELETE FROM experience_parts WHERE whole_id = p_whole AND part_id = p_part;
  ELSIF wanted IS NOT NULL AND held IS NULL THEN
    INSERT INTO experience_parts (whole_id, part_id, reason) VALUES (p_whole, p_part, wanted);
  ELSIF wanted IS DISTINCT FROM held THEN
    UPDATE experience_parts SET reason = wanted WHERE whole_id = p_whole AND part_id = p_part;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION parts_follow_records() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM refresh_part_relation(OLD.whole_id, OLD.experience_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM refresh_part_relation(NEW.whole_id, NEW.experience_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Only a record in a whole is followed, so a run's writes of its memberships
-- pay a WHEN and no call.
DROP TRIGGER IF EXISTS trg_parts_follow_records_insert ON source_records;
CREATE TRIGGER trg_parts_follow_records_insert
  AFTER INSERT ON source_records
  FOR EACH ROW WHEN (NEW.whole_id IS NOT NULL)
  EXECUTE FUNCTION parts_follow_records();
DROP TRIGGER IF EXISTS trg_parts_follow_records_delete ON source_records;
CREATE TRIGGER trg_parts_follow_records_delete
  AFTER DELETE ON source_records
  FOR EACH ROW WHEN (OLD.whole_id IS NOT NULL)
  EXECUTE FUNCTION parts_follow_records();
DROP TRIGGER IF EXISTS trg_parts_follow_records_update ON source_records;
CREATE TRIGGER trg_parts_follow_records_update
  AFTER UPDATE OF experience_id, whole_id, source_id, admission ON source_records
  FOR EACH ROW WHEN ((OLD.whole_id IS NOT NULL OR NEW.whole_id IS NOT NULL)
                     AND (OLD.experience_id, OLD.whole_id, OLD.source_id, OLD.admission)
                         IS DISTINCT FROM (NEW.experience_id, NEW.whole_id, NEW.source_id, NEW.admission))
  EXECUTE FUNCTION parts_follow_records();

-- Every old merge that moved a part names that part's record among its
-- memberships, so its undo (moveMemberships) moves the record back and the
-- relation follows. The merges recorded before parts had records lack it.
WITH missing AS (
    SELECT m.id AS merge_id, jsonb_agg(DISTINCT r.id) AS ids
      FROM experience_merges m
      CROSS JOIN LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(m.moved->'parts') = 'array' THEN m.moved->'parts' ELSE '[]'::jsonb END) AS rel(id)
      JOIN experience_parts p ON p.id = rel.id::int AND p.part_id = m.survivor_id
      JOIN source_records r ON r.source_id = 10 AND r.whole_id = p.whole_id AND r.experience_id = m.survivor_id
     WHERE m.undone_at IS NULL
       AND NOT COALESCE(m.moved->'memberships', '[]'::jsonb) @> to_jsonb(r.id)
     GROUP BY m.id
)
UPDATE experience_merges m
   SET moved = jsonb_set(m.moved, '{memberships}', COALESCE(m.moved->'memberships', '[]'::jsonb) || missing.ids)
  FROM missing
 WHERE m.id = missing.merge_id;

-- And every relation a standing old merge moved that still stands on its
-- survivor is now undone by it: a part whose record the merge names among its
-- memberships. The same relations the repair above selects; one deleted since
-- (a curator's removal, a dropped component) has nothing to move back, and
-- one a later merge moved on is that merge's to undo.
DO $$
DECLARE
    undone_by_nothing INTEGER;
BEGIN
    SELECT count(*) INTO undone_by_nothing
      FROM experience_merges m
      CROSS JOIN LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(m.moved->'parts') = 'array' THEN m.moved->'parts' ELSE '[]'::jsonb END) AS rel(id)
      JOIN experience_parts p ON p.id = rel.id::int AND p.part_id = m.survivor_id
     WHERE m.undone_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM source_records r
                        WHERE r.source_id = 10 AND r.whole_id = p.whole_id AND r.experience_id = m.survivor_id
                          AND COALESCE(m.moved->'memberships', '[]'::jsonb) @> to_jsonb(r.id));
    IF undone_by_nothing > 0 THEN
        RAISE EXCEPTION 'migration 233: % relations an old merge moved that its undo would not move back', undone_by_nothing;
    END IF;
END $$;

-- The relations the records derive are still the ones the table holds.
DO $$
DECLARE
    differing INTEGER;
BEGIN
    WITH derived AS (
      SELECT rec.whole_id, rec.experience_id AS part_id,
             CASE WHEN bool_or(s.id_scheme = 'whc-component') THEN 'component'
                  WHEN bool_or(s.id_scheme = 'wikidata-statement') THEN 'wikidata_part_of' ELSE 'curator' END AS reason
        FROM source_records rec JOIN experience_sources s ON s.id = rec.source_id
       WHERE rec.whole_id IS NOT NULL AND rec.whole_id <> rec.experience_id
       GROUP BY 1, 2
      HAVING NOT (bool_or(s.id_scheme = 'curator') AND NOT bool_or(s.id_scheme = 'curator' AND rec.admission = 'admitted')))
    SELECT count(*) INTO differing FROM (
        (SELECT whole_id, part_id, reason::text FROM experience_parts EXCEPT SELECT whole_id, part_id, reason FROM derived)
        UNION ALL
        (SELECT whole_id, part_id, reason FROM derived EXCEPT SELECT whole_id, part_id, reason::text FROM experience_parts)) d;
    IF differing > 0 THEN
        RAISE EXCEPTION 'migration 233: % relations differ from what the records derive', differing;
    END IF;
END $$;

COMMIT;
