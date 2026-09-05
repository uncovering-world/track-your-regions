-- 044: An object has a type, not a category (#814, Epic #815)
--
-- `experiences.category` was the type within a kind -- cultural / natural / mixed
-- for World Heritage, monument / sculpture for public art -- carrying the word
-- the rest of the code uses for the kind and its source (`category_id`,
-- `experience_categories`). ADR-0045 fixes the vocabulary: a traveller browses
-- by *kind*, a *source* fills a kind, and a *type* is a distinction inside a
-- kind whose members are still browsed together. The column takes the product's
-- word, and everything that names the field by name follows it in the same
-- transaction -- a curator's claim, a stored proposal, a curator's answer to a
-- held or a conflicting proposal, the curation log's record -- so each of them
-- keeps its identity under the new name.
--
-- Two vocabularies end here as well. Every museum row carried the literal
-- `art`, which said nothing the kind does not -- an art museum and an
-- archaeology museum are two kinds, not two types (ADR-0045 decision 1) -- so
-- a museum's type is NULL. And every public-art row stored its type twice,
-- `category` and `metadata.type`, so a run proposing a change proposed it
-- twice and a curator answered twice: on the development catalogue 124 of
-- 1,685 public-art proposals carried both, and the two never disagreed. The
-- key goes, from the rows and from the stored proposals, so the next run does
-- not propose its removal as a change.
--
-- Re-runnable: every statement is guarded on the state it changes, and a
-- database where the column is already `type` is left as it is.
--
-- Order: apply this before the next re-application of 01-schema.sql. That file
-- now comments and indexes `experiences.type`, which does not exist on a
-- database still holding `category`, so re-applying it first fails partway.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'experiences' AND column_name = 'category'
  ) THEN
    ALTER TABLE experiences RENAME COLUMN category TO type;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_experiences_category') THEN
    ALTER INDEX idx_experiences_category RENAME TO idx_experiences_type;
  END IF;
END $$;

COMMENT ON COLUMN experiences.type IS
  'The type within the kind, where a kind has types a traveller still browses together '
  '(ADR-0045): ''cultural''/''natural''/''mixed'' for World Heritage, ''monument''/''sculpture'' '
  'for public art. NULL for a museum: an art museum and an archaeology museum are two kinds, '
  'not two types. One vocabulary per kind, not one shared enum (#814).';

-- A museum has no type: the literal `art` said nothing the kind does not, and
-- neither would any other value a hand may have put there.
UPDATE experiences e
   SET type = NULL
  FROM experience_categories c
 WHERE c.id = e.category_id
   AND c.name = 'Top Art Museums'
   AND e.type IS NOT NULL;

-- Public art stored its type twice; the column is the type.
UPDATE experiences e
   SET metadata = e.metadata - 'type'
  FROM experience_categories c
 WHERE c.id = e.category_id
   AND c.name = 'Public Art & Monuments'
   AND e.metadata ? 'type';

-- A curator's claim on the field keeps its meaning under the new name.
UPDATE experiences
   SET curated_fields = (
     SELECT jsonb_agg(CASE WHEN f = '"category"'::jsonb THEN '"type"'::jsonb ELSE f END)
       FROM jsonb_array_elements(curated_fields) AS f
   )
 WHERE curated_fields @> '["category"]'::jsonb;

-- A stored proposal names the field it is about; the name follows the column,
-- and the duplicate `metadata.type` entry goes with the key it proposed.
UPDATE experience_sync_changes
   SET changed_fields = (
     SELECT COALESCE(jsonb_agg(
              CASE WHEN f->>'field' = 'category' THEN f || '{"field": "type"}'::jsonb ELSE f END
            ), '[]'::jsonb)
       FROM jsonb_array_elements(changed_fields) AS f
      WHERE f->>'field' IS DISTINCT FROM 'metadata.type'
   )
 WHERE jsonb_typeof(changed_fields) = 'array'
   AND (changed_fields @> '[{"field": "category"}]'::jsonb
        OR changed_fields @> '[{"field": "metadata.type"}]'::jsonb);

-- A curator's answer is stored by field name as well (ADR-0037, ADR-0038),
-- and the queue matches it against the proposal entry rewritten above
-- (`d.field = f->>'field'`): an answer left under the old name would make an
-- answered row ask its question again and the panel count it as waiting. The
-- guard on an existing `type` row keeps the unique keys whole on a database
-- that somehow holds both spellings for one object.
UPDATE experience_held_decisions d
   SET field = 'type'
 WHERE d.field = 'category'
   AND NOT EXISTS (
     SELECT 1 FROM experience_held_decisions t
      WHERE t.experience_id = d.experience_id
        AND t.part_kind IS NOT DISTINCT FROM d.part_kind
        AND t.part_ref IS NOT DISTINCT FROM d.part_ref
        AND t.part_name IS NOT DISTINCT FROM d.part_name
        AND t.field = 'type'
   );

UPDATE experience_conflict_decisions d
   SET field = 'type'
 WHERE d.field = 'category'
   AND NOT EXISTS (
     SELECT 1 FROM experience_conflict_decisions t
      WHERE t.experience_id = d.experience_id AND t.field = 'type'
   );

-- The answers given to the duplicate `metadata.type` rows answered a proposal
-- entry that no longer exists; the same object's answer on `type` is the one
-- that stands, and the curation log keeps the record of the click.
DELETE FROM experience_held_decisions WHERE field = 'metadata.type';

-- The curation log's details name the field in three shapes, and only those
-- are rewritten -- a value that happens to spell "category" (a name, a note)
-- is somebody's words and stays: an edit's details are keyed by column, which
-- is how the queue finds who claimed a field (`details ? '<column>'`); a
-- publication lists the fields it applied by name; a refusal or an acceptance
-- lists objects naming the field beside the value answered about.
-- `"metadata.type"` is a different string and stays, as the record of what a
-- publication applied at the time.
DO $$
DECLARE
  r RECORD;
  d JSONB;
  k TEXT;
BEGIN
  FOR r IN SELECT id, details FROM experience_curation_log
            WHERE details::text LIKE '%"category"%' LOOP
    d := r.details;
    IF d ? 'category' THEN
      d := (d - 'category') || jsonb_build_object('type', d->'category');
    END IF;
    FOREACH k IN ARRAY ARRAY['fields', 'appliedFields', 'claimedFieldsSkipped', 'declinedFields'] LOOP
      IF d ? k AND jsonb_typeof(d->k) = 'array' THEN
        d := jsonb_set(d, ARRAY[k], (
          SELECT COALESCE(jsonb_agg(
                   CASE WHEN e = '"category"'::jsonb THEN '"type"'::jsonb
                        WHEN jsonb_typeof(e) = 'object' AND e->>'field' = 'category'
                          THEN e || '{"field": "type"}'::jsonb
                        ELSE e END), '[]'::jsonb)
            FROM jsonb_array_elements(d->k) AS e));
      END IF;
    END LOOP;
    IF d IS DISTINCT FROM r.details THEN
      UPDATE experience_curation_log SET details = d WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

COMMIT;
