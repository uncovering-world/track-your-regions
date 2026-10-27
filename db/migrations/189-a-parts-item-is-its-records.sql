-- 189: a part's Wikidata item is its record's (ADR-0156 decision 2, #1426)
--
-- A serial World Heritage site's part held its component's Wikidata item on
-- its point (the Belfry of Mons: Q1850707 on point 8330). The item is how a
-- source knows the part, so it moves onto the part's record in World Heritage
-- components (`wikidata_items` of its kind 10 membership), with a curator's
-- claim on it (`wikidata_items` among the record's claims). The point is
-- cleared and says only where the part stands; a point that is no part's keeps
-- its own item.
--
-- The identifier registry reads a part's item off its record under the rule
-- its point's item had: the part's unless another live place carries the same
-- item too, which makes it an ensemble's (the chapels of Saint Thaddeus carry
-- the monastery's). `place_identifier_claims` gives the record an arm of its
-- own for that, and leaves virtual records out of the site-items arm, whose
-- rule is a World Heritage site's.
--
-- `01-schema.sql` declares the same function for a fresh database.
--
-- Re-runnable: a record that holds its item already is left, and a cleared
-- point moves nothing.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION place_identifier_claims(p_scheme TEXT, p_values TEXT[])
RETURNS TABLE (experience_id INTEGER, value TEXT, basis TEXT, claims BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT m.experience_id, m.external_id::text, 'membership', true
    FROM experience_kind_memberships m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'wikidata' AND m.external_id = ANY(p_values) AND m.external_id ~ '^Q[0-9]+$'
  UNION ALL
  SELECT m.experience_id, item, 'site-items',
         cardinality(m.wikidata_items) = 1
           AND (SELECT count(*) FROM experience_locations one_point
                 WHERE one_point.experience_id = m.experience_id
                   AND one_point.merged_into_id IS NULL AND one_point.missing_since IS NULL) = 1
    FROM experience_kind_memberships m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
    CROSS JOIN LATERAL unnest(m.wikidata_items) AS item
   WHERE p_scheme = 'wikidata' AND m.wikidata_items && p_values::text[] AND item = ANY(p_values)
     AND m.kind_id <> 10
  UNION ALL
  SELECT rec.experience_id, item, 'component-item',
         NOT EXISTS (SELECT 1 FROM experience_kind_memberships other
                       JOIN experiences other_place ON other_place.id = other.experience_id
                        AND other_place.merged_into_id IS NULL
                      WHERE other.kind_id = 10 AND other.wikidata_items @> ARRAY[item]
                        AND other.experience_id <> rec.experience_id
                        AND EXISTS (SELECT 1 FROM experience_locations other_point
                                     WHERE other_point.experience_id = other.experience_id
                                       AND other_point.merged_into_id IS NULL AND other_point.missing_since IS NULL))
           AND NOT EXISTS (SELECT 1 FROM experience_locations other
                             JOIN experiences other_place ON other_place.id = other.experience_id
                              AND other_place.merged_into_id IS NULL
                            WHERE other.wikidata_item = item AND other.experience_id <> rec.experience_id
                              AND other.merged_into_id IS NULL AND other.missing_since IS NULL)
    FROM experience_kind_memberships rec
    JOIN experiences e ON e.id = rec.experience_id AND e.merged_into_id IS NULL
    CROSS JOIN LATERAL unnest(rec.wikidata_items) AS item
   WHERE p_scheme = 'wikidata' AND rec.kind_id = 10 AND rec.wikidata_items && p_values::text[] AND item = ANY(p_values)
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
           AND NOT EXISTS (SELECT 1 FROM experience_kind_memberships other_rec
                             JOIN experiences other_place ON other_place.id = other_rec.experience_id
                              AND other_place.merged_into_id IS NULL
                            WHERE other_rec.kind_id = 10 AND other_rec.wikidata_items @> ARRAY[point.wikidata_item::text]
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
    FROM experience_kind_memberships m
    JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'whc' AND m.source_id = 1 AND m.external_id = ANY(p_values)
  UNION ALL
  SELECT prt.part_id, prt.external_ref, 'component',
         NOT EXISTS (SELECT 1 FROM experience_parts other
                       JOIN experiences other_part ON other_part.id = other.part_id
                        AND other_part.merged_into_id IS NULL
                      WHERE other.reason = 'component' AND other.external_ref = prt.external_ref
                        AND other.part_id <> prt.part_id)
    FROM experience_parts prt
    JOIN experiences e ON e.id = prt.part_id AND e.merged_into_id IS NULL
   WHERE p_scheme = 'whc' AND prt.reason = 'component' AND prt.external_ref = ANY(p_values)
  UNION ALL
  -- A curator's word (ADR-0143 decision 5): identifies claims whether or not a
  -- column carries the value; refers carries it without claiming; removed is
  -- applied by place_identifiers_expected(), which drops the row.
  SELECT v.experience_id, v.value::text, 'curator', v.verdict = 'identifies'
    FROM place_identifier_verdicts v
    JOIN experiences e ON e.id = v.experience_id AND e.merged_into_id IS NULL
   WHERE v.scheme = p_scheme AND v.value = ANY(p_values) AND v.verdict IN ('identifies', 'refers')
$$;

-- Each record's item: the one its component's point carries -- a point of the
-- part or the one a merge folded into another kind's place. A curator's choice
-- comes first (the Temple of Ephesian Artemis: Q104629988, confirmed on the
-- point Places of worship placed, over the Q43018 its folded component point
-- held), then the point under the component's reference, then a standing one;
-- a claim moves with its item.
CREATE TEMP TABLE part_items ON COMMIT DROP AS
SELECT DISTINCT ON (rec.id) rec.id AS record_id, el.wikidata_item AS item,
       COALESCE(el.curated_fields ? 'wikidata_item', false) AS claimed
  FROM experience_kind_memberships rec
  JOIN experience_parts p ON rec.external_id = 'component:' || p.id
  JOIN experience_locations el
    ON el.experience_id = rec.experience_id
    OR (el.experience_id IN (SELECT folded.id FROM experiences folded WHERE folded.merged_into_id = rec.experience_id)
        AND el.external_ref IS NOT DISTINCT FROM p.external_ref)
 WHERE rec.kind_id = 10 AND el.wikidata_item IS NOT NULL AND rec.wikidata_items IS NULL
 ORDER BY rec.id, COALESCE(el.curated_fields ? 'wikidata_item', false) DESC,
          (el.external_ref IS NOT DISTINCT FROM p.external_ref) DESC,
          (el.missing_since IS NULL AND el.merged_into_id IS NULL) DESC, el.id;

UPDATE experience_kind_memberships rec
   SET wikidata_items = ARRAY[pi.item::text],
       curated_fields = CASE WHEN pi.claimed AND NOT rec.curated_fields ? 'wikidata_items'
                             THEN rec.curated_fields || '["wikidata_items"]'::jsonb ELSE rec.curated_fields END,
       updated_at = NOW()
  FROM part_items pi
 WHERE rec.id = pi.record_id;

-- A part's point says only where the part stands: the points of every place
-- that is, or was before a merge folded it, a serial site's part.
UPDATE experience_locations el
   SET wikidata_item = NULL, curated_fields = el.curated_fields - 'wikidata_item'
  FROM experiences part
 WHERE part.id = el.experience_id
   AND (part.external_id LIKE 'part:%'
        OR EXISTS (SELECT 1 FROM experience_parts p WHERE p.part_id = part.id AND p.reason = 'component'))
   AND (el.wikidata_item IS NOT NULL OR el.curated_fields ? 'wikidata_item');

COMMENT ON COLUMN experience_kind_memberships.wikidata_items IS 'The Wikidata items a source that knows the place by another id resolves it to (#1248): for a World Heritage membership, the items its site resolves to through P757 (siteItems, ADR-0088 as narrowed by ADR-0094), leaving out an item whose every such statement is deprecated. NULL for a Wikidata source, whose external_id is the item. One item and one point make the place that item''s, for the catalogue''s merge on an equal item (sharedItemsSql). On a part''s record in World Heritage components (kind 10), its component''s item, with wikidata_items among the record''s claims where a curator chose it (ADR-0156).';
COMMENT ON COLUMN place_identifiers.basis IS 'Which columns carry the value for this place: membership (a source knows the place by it), site-items (a World Heritage site''s items), component-item (a serial site''s part''s item on its record in World Heritage components, ADR-0156), point (a standing point''s item), component (a part''s reference), curator (a curator''s word, place_identifier_verdicts).';

COMMIT;
