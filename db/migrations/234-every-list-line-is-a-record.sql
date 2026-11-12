-- 234-every-list-line-is-a-record.sql
--
-- Every line of the World Heritage list is a record of World Heritage
-- components (#2118, ADR-0200), and a point's Wikidata item is its line's
-- record's. A serial site's part already had its record in its site (ADR-0198);
-- the line a site shows as its own -- a site of one component (Kakadu's
-- 147quater-001) or a component that stands for its whole site (#1899) -- gets
-- the site's record of itself: source 10, whole_id and experience_id the site,
-- under the line's reference. It places the site in no whole and makes no part
-- (refresh_part_relation leaves a pair of one place alone). What the file does:
--
--   1. source_records.listing_ordinal, where the line comes in the list.
--   2. The registry reads a line's item off its record alone: the arm that read
--      experience_locations.wikidata_item goes, a site's record of itself is
--      read for its item as a part's is (component-item) and not for its
--      reference, which names the site by the number its World Heritage
--      membership carries already. The point trigger no longer names the item.
--      part_site_components() hands the site's record of a line it parts to
--      the new part, so the line's item and a curator's claim on it go with it.
--   3. One record of itself per World Heritage site that shows a line of its
--      own (siteLineSql in backend/src/db/partFieldsWriter.ts, the rule the
--      run follows from now on): the point the site shows, placed by the
--      site's membership or by none, standing first, then published, then by
--      ordinal. It takes the item and claim the point read (the column's;
--      for a site that is also another site's part, its part record's until
--      the site's next run), and the list's view of the line as the point
--      holds it (name, coordinate, ordinal), where the point stands.
--   4. A part's record holds its line's ordinal, read off the part's standing
--      point under its reference, where the record holds a view.
--   5. experience_locations.wikidata_item and its index go.
--   6. The registry is refreshed once for the values the new records carry.
--
-- Asserted: every site line has its record; every standing point reads the
-- item and claim it read before (pointItemSql, pointItemClaimedSql);
-- experience_parts unchanged; the registry holds what
-- place_identifiers_expected() says for every value refreshed. An item on a
-- point no record would stand for is refused before anything is written.
--
-- Triggers. The new records are written in one INSERT with the registry's
-- row trigger (trg_place_identifiers_membership_write) disabled, since it
-- would refresh every value of each site once per row, and step 6 refreshes
-- the values those rows carry once, with the function the trigger calls. The
-- other row triggers an INSERT fires do no write: the listing recompute
-- (derive_place_listing) reads records in a kind only; the pairing mark
-- (mark_pairing_due) returns for a record in a whole; the part trigger
-- (parts_follow_records) returns for a pair of one place; the scheme check
-- holds each reference to the whc-component shape. The table's deferred
-- triggers (crowding_follows_membership_*) fire on UPDATE and DELETE only, so
-- the INSERT leaves no event for the commit, and step 4's UPDATE names none of
-- their columns. Every change of shape comes before the rows.
--
-- Locks: ADD COLUMN takes source_records ACCESS EXCLUSIVE and DROP COLUMN
-- experience_locations ACCESS EXCLUSIVE, both to the commit; source_records
-- first.
--
-- Re-runnable: each step is guarded on what it changes. Before the next
-- re-application of 01-schema.sql, which refuses to run while
-- experience_locations still carries wikidata_item.

\set ON_ERROR_STOP on

BEGIN;

-- 1. The line's position in the list.
ALTER TABLE source_records ADD COLUMN IF NOT EXISTS listing_ordinal INTEGER;
COMMENT ON COLUMN source_records.listing_ordinal IS 'Where the line this record stands for comes in its source''s list, on a record of World Heritage components (ADR-0200): the ordinal the run paired the line''s point by, written with the record''s view. NULL on a record in a kind, and where the list gives the line no point.';

-- 2. The registry, the point trigger and the parting, as 01-schema.sql states them.
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
    FROM source_records rec
    JOIN experiences e ON e.id = rec.experience_id AND e.merged_into_id IS NULL
    CROSS JOIN LATERAL unnest(rec.wikidata_items) AS item
   WHERE p_scheme = 'wikidata' AND rec.source_id = 10 AND rec.whole_id IS NOT NULL
     AND rec.wikidata_items && p_values::text[] AND item = ANY(p_values)
     -- A place whose point stands: an item on a withdrawn line names nothing.
     AND EXISTS (SELECT 1 FROM experience_locations standing
                  WHERE standing.experience_id = rec.experience_id
                    AND standing.merged_into_id IS NULL AND standing.missing_since IS NULL)
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
                      WHERE other.source_id = 10 AND other.whole_id IS NOT NULL AND other.whole_id <> other.experience_id
                        AND other.external_id = rec.external_id AND other.experience_id <> rec.experience_id)
    FROM source_records rec
    JOIN experiences e ON e.id = rec.experience_id AND e.merged_into_id IS NULL
   -- A site's record of its own line (ADR-0200) names the site by its site's
   -- number, which its World Heritage membership already carries.
   WHERE p_scheme = 'whc' AND rec.source_id = 10 AND rec.whole_id IS NOT NULL AND rec.whole_id <> rec.experience_id
     AND rec.external_id = ANY(p_values)
  UNION ALL
  -- A curator's word (ADR-0143 decision 5): identifies claims whether or not a
  -- column carries the value; refers carries it without claiming; removed is
  -- applied by place_identifiers_expected(), which drops the row.
  SELECT v.experience_id, v.value::text, 'curator', v.verdict = 'identifies'
    FROM place_identifier_verdicts v
    JOIN experiences e ON e.id = v.experience_id AND e.merged_into_id IS NULL
   WHERE v.scheme = p_scheme AND v.value = ANY(p_values) AND v.verdict IN ('identifies', 'refers')
$$;
COMMENT ON FUNCTION place_identifier_claims(TEXT, TEXT[]) IS 'The live places that carry each of the values of one scheme, with the column that carries it and whether it says the value is the place (ADR-0143 decision 2). The one statement of what the registry holds.';

CREATE OR REPLACE FUNCTION place_identifier_values()
RETURNS TABLE (scheme TEXT, value TEXT)
LANGUAGE sql STABLE AS $$
  SELECT 'wikidata', external_id::text FROM source_records WHERE external_id ~ '^Q[0-9]+$'
  UNION SELECT 'wikidata', unnest(wikidata_items) FROM source_records WHERE wikidata_items IS NOT NULL
  UNION SELECT 'whc', external_id::text FROM source_records WHERE source_id = 1
  UNION SELECT 'whc', external_id::text FROM source_records
         WHERE source_id = 10 AND whole_id IS NOT NULL AND whole_id <> experience_id
  UNION SELECT scheme::text, value::text FROM place_identifier_verdicts
$$;
COMMENT ON FUNCTION place_identifier_values() IS 'Every value of each scheme a column carries (ADR-0143 decision 2).';

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
COMMENT ON FUNCTION refresh_place_identifiers_of(INTEGER[], TEXT[], TEXT[]) IS 'Refreshes every value these places hold in the registry or carry now, and the Wikidata items and World Heritage references named beside them, all their keys taken in one ordered pass (ADR-0143 decision 2).';

CREATE OR REPLACE FUNCTION place_identifiers_follow_point() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_place_identifiers_of(ARRAY[NEW.experience_id]);
  ELSE
    PERFORM refresh_place_identifiers_of(
      array_remove(ARRAY[OLD.experience_id, CASE WHEN TG_OP <> 'DELETE' THEN NEW.experience_id END], NULL));
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_place_identifiers_point_update
  AFTER UPDATE OF experience_id, merged_into_id, missing_since ON experience_locations
  FOR EACH ROW
  WHEN ((OLD.experience_id, OLD.merged_into_id IS NULL, OLD.missing_since IS NULL)
        IS DISTINCT FROM (NEW.experience_id, NEW.merged_into_id IS NULL, NEW.missing_since IS NULL))
  EXECUTE FUNCTION place_identifiers_follow_point();

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
    -- A line the site's record of itself stood for (ADR-0200) moves with its
    -- point, its item, a curator's claim on it and its view with it.
    UPDATE source_records SET experience_id = part, updated_at = NOW()
     WHERE source_id = 10 AND whole_id = site AND experience_id = site
       AND lower(external_id) = lower(component.external_ref);
    IF NOT FOUND THEN
      INSERT INTO source_records (experience_id, whole_id, source_id, external_id)
      VALUES (part, site, 10, component.external_ref);
    END IF;

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

-- What the points carried on the column, the item and claim every reader
-- read for each point (pointItemSql and pointItemClaimedSql as they stood:
-- a part's point off its record, any other point off the column), and the
-- relations, before the rows. Re-run, the readers read the records already.
CREATE TEMP TABLE point_items_before (point_id INTEGER, place_id INTEGER, item TEXT, claimed BOOLEAN) ON COMMIT DROP;
CREATE TEMP TABLE point_reads_before (point_id INTEGER, item TEXT, claimed BOOLEAN) ON COMMIT DROP;
DO $$
DECLARE
    on_point TEXT := 'rec.item';
    claimed_on_point TEXT := 'COALESCE(rec.claimed, false)';
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'experience_locations' AND column_name = 'wikidata_item') THEN
        EXECUTE $q$INSERT INTO point_items_before
                   SELECT id, experience_id, wikidata_item, curated_fields ? 'wikidata_item'
                     FROM experience_locations
                    WHERE wikidata_item IS NOT NULL OR curated_fields ? 'wikidata_item'$q$;
        on_point := 'el.wikidata_item::text';
        claimed_on_point := $q$COALESCE(el.curated_fields ? 'wikidata_item', false)$q$;
    END IF;
    EXECUTE format($q$
      INSERT INTO point_reads_before
      SELECT el.id,
             CASE WHEN of_part.yes THEN rec.item ELSE %s END,
             CASE WHEN of_part.yes THEN COALESCE(rec.claimed, false) ELSE %s END
        FROM experience_locations el
        CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM experience_parts pop
                                            WHERE pop.part_id = el.experience_id AND pop.reason = 'component')
                                   AS yes) of_part
        LEFT JOIN LATERAL (
               SELECT r.wikidata_items[1] AS item, r.curated_fields ? 'wikidata_items' AS claimed
                 FROM source_records r
                WHERE r.experience_id = el.experience_id AND r.source_id = 10 AND r.whole_id IS NOT NULL
                  AND (r.whole_id <> r.experience_id OR lower(r.external_id) = lower(el.external_ref))
                ORDER BY (lower(r.external_id) = lower(el.external_ref)) IS TRUE DESC, r.whole_id
                LIMIT 1) rec ON true
       WHERE el.merged_into_id IS NULL$q$, on_point, claimed_on_point);
END $$;
CREATE TEMP TABLE parts_before ON COMMIT DROP AS SELECT whole_id, part_id, reason::text AS reason FROM experience_parts;

-- 3. Each site's record of its own line.
CREATE TEMP TABLE site_lines (site_id INTEGER, point_id INTEGER, external_ref TEXT, standing BOOLEAN,
                              item TEXT, claimed BOOLEAN) ON COMMIT DROP;
INSERT INTO site_lines (site_id, point_id, external_ref, standing)
SELECT DISTINCT ON (site.experience_id) site.experience_id, el.id, el.external_ref, el.missing_since IS NULL
  FROM source_records site
  JOIN experiences e ON e.id = site.experience_id AND e.merged_into_id IS NULL
  JOIN experience_locations el ON el.experience_id = site.experience_id AND el.merged_into_id IS NULL
 WHERE site.source_id = 1 AND site.kind_id IS NOT NULL
   AND source_id_fits_scheme('whc-component', el.external_ref)
   AND (NOT EXISTS (SELECT 1 FROM experience_location_placements any_pl WHERE any_pl.location_id = el.id)
        OR EXISTS (SELECT 1 FROM experience_location_placements own_pl
                    WHERE own_pl.location_id = el.id AND own_pl.membership_id = site.id))
 ORDER BY site.experience_id, el.missing_since IS NULL DESC, el.curation_state <> 'pending' DESC,
          el.ordinal NULLS LAST, el.id;
-- The line's record takes the item and claim its point read: a site's own
-- point's off the column, and for a site that is also a part of another
-- (Zacatecas, part of the Camino Real de Tierra Adentro), off its part's record,
-- until the site's next run records the line's own.
UPDATE site_lines l SET item = b.item, claimed = b.claimed FROM point_reads_before b WHERE b.point_id = l.point_id;

-- An item a point carries off its site's line is one no record can hold:
-- refused rather than dropped.
DO $$
DECLARE
    stranded TEXT;
BEGIN
    SELECT string_agg(b.point_id || ' (' || b.item || ')', ', ') INTO stranded
      FROM point_items_before b
     WHERE NOT EXISTS (SELECT 1 FROM site_lines l WHERE l.point_id = b.point_id)
       AND NOT EXISTS (SELECT 1 FROM experience_locations el
                         JOIN source_records rec ON rec.experience_id = el.experience_id AND rec.source_id = 10
                                                AND rec.whole_id IS NOT NULL AND rec.whole_id <> rec.experience_id
                        WHERE el.id = b.point_id)
       AND EXISTS (SELECT 1 FROM experience_locations el WHERE el.id = b.point_id AND el.merged_into_id IS NULL);
    IF stranded IS NOT NULL THEN
        RAISE EXCEPTION 'migration 234: points whose item no list line''s record would hold: %', stranded;
    END IF;
END $$;

ALTER TABLE source_records DISABLE TRIGGER trg_place_identifiers_membership_write;
INSERT INTO source_records (experience_id, whole_id, source_id, external_id, wikidata_items, curated_fields,
                            reported_name, reported_location, listing_ordinal)
SELECT l.site_id, l.site_id, 10, l.external_ref,
       CASE WHEN l.item IS NOT NULL THEN ARRAY[l.item] END,
       CASE WHEN l.claimed THEN '["wikidata_items"]'::jsonb ELSE '[]'::jsonb END,
       CASE WHEN l.standing THEN el.name END,
       CASE WHEN l.standing THEN el.location END,
       CASE WHEN l.standing THEN el.ordinal END
  FROM site_lines l JOIN experience_locations el ON el.id = l.point_id
ON CONFLICT (source_id, whole_id, experience_id) DO NOTHING;
ALTER TABLE source_records ENABLE TRIGGER trg_place_identifiers_membership_write;

-- 4. A part's line's position, where its record holds the list's view.
UPDATE source_records rec
   SET listing_ordinal = c.ordinal
  FROM experience_locations c
 WHERE rec.source_id = 10 AND rec.whole_id IS NOT NULL AND rec.whole_id <> rec.experience_id
   AND rec.listing_ordinal IS NULL AND rec.reported_location IS NOT NULL
   AND c.experience_id = rec.experience_id AND c.merged_into_id IS NULL AND c.missing_since IS NULL
   AND c.external_ref = rec.external_id AND c.ordinal IS NOT NULL;

-- 5. The point's item column.
DROP INDEX IF EXISTS idx_experience_locations_wikidata_item;
ALTER TABLE experience_locations DROP COLUMN IF EXISTS wikidata_item;

-- 6. The registry, for the values the new records carry and the items the
-- points carried.
DO $$
BEGIN
    PERFORM refresh_place_identifiers('wikidata', ARRAY(
      SELECT item FROM point_items_before WHERE item IS NOT NULL
      UNION SELECT unnest(wikidata_items) FROM source_records
             WHERE source_id = 10 AND whole_id = experience_id AND wikidata_items IS NOT NULL));
    PERFORM refresh_place_identifiers('whc', ARRAY(
      SELECT external_id::text FROM source_records WHERE source_id = 10 AND whole_id = experience_id));
END $$;

DO $$
DECLARE
    lines_unrecorded INTEGER;
    items_lost INTEGER;
    parts_changed INTEGER;
    registry_off INTEGER;
BEGIN
    SELECT count(*) INTO lines_unrecorded FROM site_lines l
     WHERE NOT EXISTS (SELECT 1 FROM source_records rec
                        WHERE rec.source_id = 10 AND rec.whole_id = l.site_id AND rec.experience_id = l.site_id);
    -- Every point reads the item and claim it read before, off its line's
    -- record, as pointItemSql and pointItemClaimedSql read them.
    SELECT count(*) INTO items_lost
      FROM point_reads_before b
      JOIN experience_locations el ON el.id = b.point_id AND el.merged_into_id IS NULL
      LEFT JOIN LATERAL (
             SELECT rec.wikidata_items[1] AS item, rec.curated_fields ? 'wikidata_items' AS claimed
               FROM source_records rec
              WHERE rec.experience_id = el.experience_id AND rec.source_id = 10 AND rec.whole_id IS NOT NULL
                AND (rec.whole_id <> rec.experience_id OR lower(rec.external_id) = lower(el.external_ref))
              ORDER BY (lower(rec.external_id) = lower(el.external_ref)) IS TRUE DESC, rec.whole_id
              LIMIT 1) on_record ON true
     WHERE b.item IS DISTINCT FROM on_record.item OR COALESCE(b.claimed, false) IS DISTINCT FROM COALESCE(on_record.claimed, false);
    SELECT count(*) INTO parts_changed FROM (
      (SELECT whole_id, part_id, reason FROM parts_before
       EXCEPT SELECT whole_id, part_id, reason::text FROM experience_parts)
      UNION ALL
      (SELECT whole_id, part_id, reason::text FROM experience_parts
       EXCEPT SELECT whole_id, part_id, reason FROM parts_before)) d;
    WITH touched AS (
      SELECT 'wikidata'::text AS scheme, item AS value FROM point_items_before WHERE item IS NOT NULL
      UNION SELECT 'wikidata', unnest(wikidata_items) FROM source_records
             WHERE source_id = 10 AND whole_id = experience_id AND wikidata_items IS NOT NULL
      UNION SELECT 'whc', external_id::text FROM source_records WHERE source_id = 10 AND whole_id = experience_id),
    expected AS (
      SELECT t.scheme, x.* FROM (SELECT DISTINCT scheme FROM touched) t
      CROSS JOIN LATERAL place_identifiers_expected(t.scheme, ARRAY(SELECT value FROM touched WHERE touched.scheme = t.scheme)) x),
    held AS (
      SELECT pi.scheme::text, pi.experience_id, pi.value::text, pi.identifies, pi.claims_identity, pi.basis::text[]
        FROM place_identifiers pi JOIN touched t ON t.scheme = pi.scheme AND t.value = pi.value)
    SELECT count(*) INTO registry_off FROM (
      (SELECT scheme, experience_id, value, identifies, claims_identity, basis FROM expected
       EXCEPT SELECT * FROM held)
      UNION ALL
      (SELECT * FROM held
       EXCEPT SELECT scheme, experience_id, value, identifies, claims_identity, basis FROM expected)) d;
    IF lines_unrecorded > 0 OR items_lost > 0 OR parts_changed > 0 OR registry_off > 0 THEN
        RAISE EXCEPTION 'migration 234: % site lines with no record of the site in itself, % items or claims off their record, % relations changed, % registry rows out of step',
            lines_unrecorded, items_lost, parts_changed, registry_off;
    END IF;
END $$;

COMMIT;
