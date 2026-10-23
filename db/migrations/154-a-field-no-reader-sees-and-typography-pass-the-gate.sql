-- 154-a-field-no-reader-sees-and-typography-pass-the-gate.sql
--
-- A rewrite of a field no reader is shown, and a text rewritten only in its
-- typesetting, pass the curation gate (#1834, ADR-0139). The runs before it
-- held both kinds: on the development catalogue on 2026-10-23, 63 open held
-- cards held nothing but local names, areas, years and makers of a place, and
-- 6 nothing but a typographic rewrite (Gondwana's `Australia’s`, Pergamon's
-- `Maltepe Tumulus\t`). This file writes what those cards hold, as the run
-- would now, and closes them.
--
-- A card is closed when every field it holds, the place's and its points',
-- passes by the rule the run now applies:
--   - `unseen`: a field `@tyr/shared/readerFields` marks as shown to no reader,
--     the Wikidata item excepted (ADR-0129 decision 2). The list below is that
--     declaration on 2026-10-23;
--   - `typography`: a name, subtitle or description, or a point's name, whose
--     two values fold to the same text (`foldTypography`, `@tyr/shared/labels`,
--     spelled here as `typographyFoldSql` spells it).
-- And when the place still holds what the card proposed to replace, no curator
-- claims a field it holds, and no curator answered one of them: a curator's
-- claim and answer stand (ADR-0029). A card that also holds anything else keeps
-- its pointer; the source's next run files its passing fields as passed.
--
-- The change record is brought to what the run now files: each field written
-- here is no longer held, and carries its class (`passedTheGate`), so a value
-- written while its field was unseen can be found again once a surface shows
-- it (ADR-0139 decision 3). A record left holding nothing is an update.
--
-- Re-runnable: a closed card has no pointer, and a written field is not held.

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.fold(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(
           regexp_replace(regexp_replace(regexp_replace(normalize(value, NFC),
             '(‘|’|‚|‛|ʼ|′)', '''', 'g'),
             '(“|”|„|‟|″|«|»)', '"', 'g'),
             '(‐|‑|‒|–|—|―|−)', '-', 'g'),
           '((\s| | | | | | | | | | | | | | | | | |　|﻿)|\\[tn])+$', ''),
         '(\s| | | | | | | | | | | | | | | | | |　|﻿)+', ' ', 'g'), ' ')
$$;

-- The two strings differ, the new one ends in no literal escape, and they
-- fold to the same text.
CREATE FUNCTION pg_temp.typography(old jsonb, new jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(old) = 'string' AND jsonb_typeof(new) = 'string'
     AND old <> new AND (new #>> '{}') !~ '\\[tn]\s*$'
     AND pg_temp.fold(old #>> '{}') = pg_temp.fold(new #>> '{}')
$$;

-- The class a held field of a place passes as, or null. A metadata key the
-- record lacks (no 'new' on the entry) is a removal the held row does not
-- take, and stays a question; a local name the record lacks goes, since the
-- run writes the map whole.
CREATE FUNCTION pg_temp.place_pass(field text, old jsonb, new jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN field LIKE 'metadata.%' AND new IS NULL THEN NULL
    WHEN field LIKE 'nameLocal.%' OR field = ANY (ARRAY[
      'tags', 'countryCodes', 'countryNames',
      'metadata.criteria', 'metadata.region', 'metadata.transboundary', 'metadata.areaHectares',
      'metadata.year', 'metadata.creators', 'metadata.creator', 'metadata.type'])
      THEN 'unseen'
    WHEN field IN ('name', 'subtitle', 'description') AND pg_temp.typography(old, new)
      THEN 'typography'
  END
$$;

-- What the place holds now under a field's name, null and absent alike.
CREATE FUNCTION pg_temp.held_now(e experiences, field text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(CASE
    WHEN field = 'name' THEN to_jsonb(e.name)
    WHEN field = 'subtitle' THEN to_jsonb(e.subtitle)
    WHEN field = 'description' THEN to_jsonb(e.description)
    WHEN field = 'tags' THEN to_jsonb(e.tags)
    WHEN field = 'countryCodes' THEN to_jsonb(e.country_codes)
    WHEN field = 'countryNames' THEN to_jsonb(e.country_names)
    WHEN field LIKE 'nameLocal.%' THEN e.name_local -> substr(field, length('nameLocal.') + 1)
    WHEN field LIKE 'metadata.%' THEN e.metadata -> substr(field, length('metadata.') + 1)
  END, 'null'::jsonb)
$$;

-- The claim that would keep a field of a place.
CREATE FUNCTION pg_temp.claim_of(field text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN field LIKE 'nameLocal.%' THEN 'name_local'
    WHEN field = 'countryCodes' THEN 'country_codes'
    WHEN field = 'countryNames' THEN 'country_names'
    ELSE field
  END
$$;

-- The open held cards, each a membership's pointer at its run's record.
CREATE TEMP TABLE card ON COMMIT DROP AS
SELECT m.id AS membership_id, ch.id AS change_id, e.id AS experience_id
  FROM experience_kind_memberships m
  JOIN experience_sync_changes ch ON ch.experience_id = m.experience_id
                                 AND ch.sync_log_id = m.pending_change_sync_log_id
  JOIN experiences e ON e.id = m.experience_id;

-- The place's held fields of those cards, with what each passes as.
CREATE TEMP TABLE place_field ON COMMIT DROP AS
SELECT c.change_id, c.experience_id, f->>'field' AS field, f->'old' AS old, f->'new' AS new,
       pg_temp.place_pass(f->>'field', f->'old', f->'new') AS pass,
       pg_temp.held_now(e, f->>'field') = COALESCE(f->'old', 'null'::jsonb) AS stands,
       e.curated_fields ? pg_temp.claim_of(f->>'field') AS claimed,
       EXISTS (SELECT 1 FROM experience_held_decisions d
                WHERE d.experience_id = c.experience_id AND d.part_kind IS NULL
                  AND d.field = f->>'field') AS answered
  FROM card c
  JOIN experience_sync_changes ch ON ch.id = c.change_id
  JOIN experiences e ON e.id = c.experience_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(ch.changed_fields) = 'array' THEN ch.changed_fields ELSE '[]'::jsonb END) AS f
 WHERE COALESCE((f->>'held')::boolean, false);

-- The points' and the works' held fields of those cards. Only a point's name
-- passes, by its typesetting. A point is the one the card's membership places
-- under the reference the record names: a serial site's component point sits
-- on the component's part place, not on the site (ADR-0100).
CREATE TEMP TABLE part_field ON COMMIT DROP AS
SELECT c.change_id, c.experience_id, k.kind, item->'item'->>'ref' AS ref, f->>'field' AS field,
       f->'old' AS old, f->'new' AS new,
       CASE WHEN k.kind = 'locations' AND f->>'field' = 'name' AND pg_temp.typography(f->'old', f->'new')
            THEN 'typography' END AS pass,
       (SELECT array_agg(el.id) FROM experience_locations el
          JOIN experience_location_placements pl ON pl.location_id = el.id AND pl.membership_id = c.membership_id
         WHERE el.external_ref = item->'item'->>'ref' AND el.merged_into_id IS NULL
           AND to_jsonb(el.name) = f->'old' AND NOT el.curated_fields ? 'name') AS point_ids,
       EXISTS (SELECT 1 FROM experience_held_decisions d
                WHERE d.experience_id = c.experience_id AND d.part_kind = k.kind
                  AND d.part_ref IS NOT DISTINCT FROM item->'item'->>'ref'
                  AND d.field = f->>'field') AS answered
  FROM card c
  JOIN experience_sync_changes ch ON ch.id = c.change_id
  CROSS JOIN (VALUES ('locations'), ('treasures')) AS k(kind)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ch.contents -> k.kind -> 'changed', '[]'::jsonb)) AS item
  CROSS JOIN LATERAL jsonb_array_elements(item -> 'fields') AS f
 WHERE COALESCE((f->>'held')::boolean, false);

-- The cards every held field of which passes and can be written.
CREATE TEMP TABLE closing ON COMMIT DROP AS
SELECT c.* FROM card c
 WHERE (EXISTS (SELECT 1 FROM place_field p WHERE p.change_id = c.change_id)
        OR EXISTS (SELECT 1 FROM part_field p WHERE p.change_id = c.change_id))
   AND NOT EXISTS (SELECT 1 FROM place_field p WHERE p.change_id = c.change_id
                    AND (p.pass IS NULL OR NOT p.stands OR p.claimed OR p.answered))
   AND NOT EXISTS (SELECT 1 FROM part_field p WHERE p.change_id = c.change_id
                    AND (p.pass IS NULL OR cardinality(p.point_ids) IS DISTINCT FROM 1 OR p.answered));

SELECT (SELECT count(*) FROM closing) AS cards_closed,
       (SELECT count(*) FROM place_field p JOIN closing c USING (change_id)) AS place_fields_written,
       (SELECT count(*) FROM part_field p JOIN closing c USING (change_id)) AS point_names_written;

-- The place's columns, then its maps one key at a time.
UPDATE experiences e SET name = p.new #>> '{}', updated_at = NOW()
  FROM place_field p JOIN closing c USING (change_id)
 WHERE e.id = p.experience_id AND p.field = 'name';
UPDATE experiences e SET subtitle = p.new #>> '{}', updated_at = NOW()
  FROM place_field p JOIN closing c USING (change_id)
 WHERE e.id = p.experience_id AND p.field = 'subtitle';
UPDATE experiences e SET description = p.new #>> '{}', updated_at = NOW()
  FROM place_field p JOIN closing c USING (change_id)
 WHERE e.id = p.experience_id AND p.field = 'description';
UPDATE experiences e
   SET country_codes = ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(p.new, 'null'::jsonb), '[]'::jsonb))),
       updated_at = NOW()
  FROM place_field p JOIN closing c USING (change_id)
 WHERE e.id = p.experience_id AND p.field = 'countryCodes';
UPDATE experiences e
   SET country_names = ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(p.new, 'null'::jsonb), '[]'::jsonb))),
       updated_at = NOW()
  FROM place_field p JOIN closing c USING (change_id)
 WHERE e.id = p.experience_id AND p.field = 'countryNames';

-- A map takes every key of the card at once: a key the run proposed to remove
-- goes, and the others take their new values.
UPDATE experiences e
   SET name_local = NULLIF((COALESCE(e.name_local, '{}'::jsonb) - k.removed) || k.added, '{}'::jsonb),
       updated_at = NOW()
  FROM (SELECT p.experience_id,
               COALESCE(array_agg(substr(p.field, length('nameLocal.') + 1))
                          FILTER (WHERE p.new IS NULL OR p.new = 'null'::jsonb), '{}') AS removed,
               COALESCE(jsonb_object_agg(substr(p.field, length('nameLocal.') + 1), p.new)
                          FILTER (WHERE p.new IS NOT NULL AND p.new <> 'null'::jsonb), '{}'::jsonb) AS added
          FROM place_field p JOIN closing c USING (change_id)
         WHERE p.field LIKE 'nameLocal.%'
         GROUP BY p.experience_id) k
 WHERE e.id = k.experience_id;

-- A metadata key is merged as the run merges it, a null included.
UPDATE experiences e
   SET metadata = COALESCE(e.metadata, '{}'::jsonb) || k.added,
       updated_at = NOW()
  FROM (SELECT p.experience_id,
               jsonb_object_agg(substr(p.field, length('metadata.') + 1), p.new) AS added
          FROM place_field p JOIN closing c USING (change_id)
         WHERE p.field LIKE 'metadata.%'
         GROUP BY p.experience_id) k
 WHERE e.id = k.experience_id;

-- A component's part place took its point's name when it was parted
-- (part_site_components()), and a run renames the point alone: the part place
-- named as the point was is renamed with it, unless a curator claims its name.
UPDATE experiences e SET name = p.new #>> '{}', updated_at = NOW()
  FROM part_field p JOIN closing c USING (change_id), experience_locations el
 WHERE el.id = p.point_ids[1] AND e.id = el.experience_id AND e.id <> p.experience_id
   AND EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.part_id = e.id)
   AND to_jsonb(e.name) = p.old AND NOT e.curated_fields ? 'name';

UPDATE experience_locations el SET name = p.new #>> '{}'
  FROM part_field p JOIN closing c USING (change_id)
 WHERE el.id = p.point_ids[1] AND p.kind = 'locations' AND p.field = 'name';

-- The record, as the run now files it.
UPDATE experience_sync_changes ch
   SET changed_fields = (
         SELECT jsonb_agg(CASE
                  WHEN COALESCE((f->>'held')::boolean, false)
                    THEN f || jsonb_build_object(
                           'held', false,
                           'passedTheGate', pg_temp.place_pass(f->>'field', f->'old', f->'new'))
                  ELSE f END ORDER BY n)
           FROM jsonb_array_elements(ch.changed_fields) WITH ORDINALITY AS t(f, n))
  FROM closing c
 WHERE ch.id = c.change_id AND jsonb_typeof(ch.changed_fields) = 'array'
   AND jsonb_array_length(ch.changed_fields) > 0;

UPDATE experience_sync_changes ch
   SET contents = jsonb_set(ch.contents, '{locations,changed}', (
         SELECT jsonb_agg(item || jsonb_build_object('fields', (
                  SELECT jsonb_agg(CASE
                           WHEN COALESCE((f->>'held')::boolean, false)
                             THEN f || jsonb_build_object('held', false, 'passedTheGate', 'typography')
                           ELSE f END ORDER BY fn)
                    FROM jsonb_array_elements(item -> 'fields') WITH ORDINALITY AS g(f, fn))) ORDER BY n)
           FROM jsonb_array_elements(ch.contents -> 'locations' -> 'changed') WITH ORDINALITY AS t(item, n)))
  FROM closing c
 WHERE ch.id = c.change_id
   AND jsonb_typeof(ch.contents -> 'locations' -> 'changed') = 'array'
   AND jsonb_array_length(ch.contents -> 'locations' -> 'changed') > 0;

UPDATE experience_sync_changes ch SET change_type = 'updated'
  FROM closing c
 WHERE ch.id = c.change_id AND ch.change_type = 'held';

UPDATE experience_kind_memberships m
   SET pending_change_sync_log_id = NULL, updated_at = NOW()
  FROM closing c
 WHERE m.id = c.membership_id;

COMMIT;
