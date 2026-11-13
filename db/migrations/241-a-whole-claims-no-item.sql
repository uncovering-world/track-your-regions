-- 241-a-whole-claims-no-item.sql
--
-- A place made of parts claims no Wikidata item (#2119, ADR-0203). A serial
-- World Heritage site is its parts on the ground, so an item it carries names
-- the site, one of its parts or their ensemble. Until now the registry made
-- such an item the whole's when the site showed one point of its own: the
-- site's own line (ADR-0200) counted as that point. Three merges onto a whole
-- came of it, Baalbek, the Mausoleum of the First Qin Emperor and the Rideau
-- Canal, and a run reading any of 22 items would have joined its record to a
-- whole. What the file does:
--
--   1. place_is_whole(), and place_identifier_claims() reading it on every
--      Wikidata arm but a curator's word, as 01-schema.sql states them.
--   2. The registry follows a place that becomes a whole or stops being one
--      (trg_whole_identifiers_part_*, statement triggers on experience_parts).
--   3. The registry is refreshed once, for the Wikidata items a whole claims:
--      one call over about 25 values, so their keys are taken once, in key
--      order, and no row trigger fires per row. Nothing else is written.
--
-- On the development catalogue on 2026-11-13 that turns 22 rows on 17 wholes
-- from identifying to referring. No single site loses its item: a site of one
-- component holds no part. The three merges stay until a curator undoes them
-- from the card; the catalogue check merge-onto-a-whole lists them.
--
-- Re-runnable: the functions are replaced and the triggers dropped first, and
-- a second refresh finds no claim of a whole left to change.

\set ON_ERROR_STOP on

BEGIN;

-- 1. The rule.
CREATE OR REPLACE FUNCTION place_is_whole(p_place INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM experience_parts made_of WHERE made_of.whole_id = p_place)
$$;
COMMENT ON FUNCTION place_is_whole(INTEGER) IS 'Whether the place is made of parts, a whole (ADR-0203): read by place_identifier_claims(), so a whole claims no Wikidata item, and followed by trg_whole_identifiers_part_* when a place becomes one or stops being one.';

CREATE OR REPLACE FUNCTION place_identifier_claims(p_scheme TEXT, p_values TEXT[])
RETURNS TABLE (experience_id INTEGER, value TEXT, basis TEXT, claims BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT m.experience_id, m.external_id::text, 'membership', NOT place_is_whole(m.experience_id)
    FROM source_records m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'wikidata' AND m.external_id = ANY(p_values) AND m.external_id ~ '^Q[0-9]+$'
  UNION ALL
  SELECT m.experience_id, item, 'site-items',
         cardinality(m.wikidata_items) = 1
           AND (SELECT count(*) FROM experience_locations one_point
                 WHERE one_point.experience_id = m.experience_id
                   AND one_point.merged_into_id IS NULL AND one_point.missing_since IS NULL) = 1
           AND NOT place_is_whole(m.experience_id)
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
         AND NOT place_is_whole(rec.experience_id)
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

-- 2. The registry follows a place becoming a whole.
CREATE OR REPLACE FUNCTION place_identifiers_follow_wholes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  changed INTEGER[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A whole all of whose parts this statement wrote was none before it.
    changed := ARRAY(SELECT DISTINCT n.whole_id FROM new_parts n
                      WHERE NOT EXISTS (SELECT 1 FROM experience_parts held
                                         WHERE held.whole_id = n.whole_id
                                           AND held.id NOT IN (SELECT again.id FROM new_parts again)));
  END IF;
  IF TG_OP = 'DELETE' THEN
    changed := ARRAY(SELECT DISTINCT o.whole_id FROM old_parts o WHERE NOT place_is_whole(o.whole_id));
  END IF;
  IF cardinality(changed) > 0 THEN
    PERFORM refresh_place_identifiers_of(changed);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_whole_identifiers_part_insert ON experience_parts;
CREATE TRIGGER trg_whole_identifiers_part_insert
  AFTER INSERT ON experience_parts
  REFERENCING NEW TABLE AS new_parts
  FOR EACH STATEMENT EXECUTE FUNCTION place_identifiers_follow_wholes();
DROP TRIGGER IF EXISTS trg_whole_identifiers_part_delete ON experience_parts;
CREATE TRIGGER trg_whole_identifiers_part_delete
  AFTER DELETE ON experience_parts
  REFERENCING OLD TABLE AS old_parts
  FOR EACH STATEMENT EXECUTE FUNCTION place_identifiers_follow_wholes();

-- 3. The items wholes claim today, refreshed once.
SELECT refresh_place_identifiers('wikidata', ARRAY(
  SELECT DISTINCT pi.value FROM place_identifiers pi
   WHERE pi.scheme = 'wikidata' AND pi.claims_identity AND place_is_whole(pi.experience_id)));

COMMIT;
