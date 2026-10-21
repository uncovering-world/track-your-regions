-- 140-a-place-has-a-subtitle-and-a-description.sql
--
-- A place's two text columns are named after what they hold (#1795).
-- `experiences.description` held Wikidata's one-line description, written by
-- the Art Museums, Public Art, Places of worship and Archaeology runs, and
-- becomes `subtitle`. `experiences.short_description` held UNESCO's paragraph
-- (and a curator's text), and becomes `description`. A source's view of the
-- line, `experience_kind_memberships.reported_description`, becomes
-- `reported_subtitle`. What a run writes and what a reader sees do not change
-- here.
--
-- The names are also stored as data, in three spellings, and each is moved in
-- the same transaction, one CASE per value, so the two renames never collide:
--   - the run's and the review queue's camelCase (`changed_fields[].field`,
--     held and conflict decisions, the curation log's `fields` and a
--     publication's `claimedFieldsSkipped`): `description`
--     becomes `subtitle`, `shortDescription` becomes `description`;
--   - the column names (`curated_fields`, the keys of an `edited` log row):
--     `description` becomes `subtitle`, `short_description` becomes
--     `description`;
--   - the view word of a choice between two sources' views
--     (`experience_view_choices`, `experience_view_suggestions` and their
--     CHECKs): `description` becomes `subtitle`.
-- A point's or a work's own `description` is another field and is left
-- alone: the `contents` column of a change, a held decision with a
-- `part_kind`, and the `parts` of a log row.
--
-- On the development catalogue on 2026-10-21: 2137 change rows naming
-- `description` and 284 naming `shortDescription`, 8 held decisions, 1
-- conflict decision, 1 claim (Aksum's paragraph) and 14 log rows.
--
-- Re-runnable: everything runs once, while `short_description` still exists.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'experiences' AND column_name = 'short_description'
  ) THEN
    RAISE NOTICE 'experiences.short_description is gone: already migrated';
    RETURN;
  END IF;

  ALTER TABLE experiences RENAME COLUMN description TO subtitle;
  ALTER TABLE experiences RENAME COLUMN short_description TO description;
  ALTER TABLE experience_kind_memberships RENAME COLUMN reported_description TO reported_subtitle;
  COMMENT ON COLUMN experience_kind_memberships.reported_subtitle IS
    'The subtitle this membership''s source last reported for the place (its view, #1246, #1795).';
  COMMENT ON COLUMN experiences.curated_fields IS
    'What a curator has claimed on this place, so every run keeps the stored value: column names (name, subtitle, description, image_url, ...) and, for metadata, one entry per key (metadata.website, metadata.inDanger). Never the bare name metadata (ADR-0077 decision 3): a claim is in the grain the run records, so every key it protects is a key a curator can be asked about.';

  -- The claims, by column name.
  UPDATE experiences e
     SET curated_fields = (
           SELECT jsonb_agg(CASE c.v WHEN 'description' THEN 'subtitle'
                                     WHEN 'short_description' THEN 'description'
                                     ELSE c.v END ORDER BY c.ord)
             FROM jsonb_array_elements_text(e.curated_fields) WITH ORDINALITY AS c(v, ord))
   WHERE e.curated_fields ?| ARRAY['description', 'short_description'];

  -- What each run changed and held, by camelCase field.
  UPDATE experience_sync_changes c
     SET changed_fields = (
           SELECT jsonb_agg(CASE f.v->>'field'
                              WHEN 'description' THEN jsonb_set(f.v, '{field}', '"subtitle"')
                              WHEN 'shortDescription' THEN jsonb_set(f.v, '{field}', '"description"')
                              ELSE f.v END ORDER BY f.ord)
             FROM jsonb_array_elements(c.changed_fields) WITH ORDINALITY AS f(v, ord))
   WHERE jsonb_typeof(c.changed_fields) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.changed_fields) f
                  WHERE f->>'field' IN ('description', 'shortDescription'));

  -- Two statements each, in this order: both tables are unique per place and
  -- field, checked row by row, so a place holding a decision on both fields
  -- would collide inside one swapping UPDATE. `subtitle` is held by no row yet.
  UPDATE experience_held_decisions SET field = 'subtitle'
   WHERE part_kind IS NULL AND field = 'description';
  UPDATE experience_held_decisions SET field = 'description'
   WHERE part_kind IS NULL AND field = 'shortDescription';

  UPDATE experience_conflict_decisions SET field = 'subtitle' WHERE field = 'description';
  UPDATE experience_conflict_decisions SET field = 'description' WHERE field = 'shortDescription';

  -- The choices between two sources' views, by view word.
  ALTER TABLE experience_view_choices DROP CONSTRAINT IF EXISTS experience_view_choices_field_check;
  ALTER TABLE experience_view_suggestions DROP CONSTRAINT IF EXISTS experience_view_suggestions_field_check;
  UPDATE experience_view_choices SET field = 'subtitle' WHERE field = 'description';
  UPDATE experience_view_suggestions SET field = 'subtitle' WHERE field = 'description';
  ALTER TABLE experience_view_choices ADD CONSTRAINT experience_view_choices_field_check
    CHECK (field IN ('name', 'subtitle', 'imageUrl', 'location'));
  ALTER TABLE experience_view_suggestions ADD CONSTRAINT experience_view_suggestions_field_check
    CHECK (field IN ('name', 'subtitle', 'imageUrl', 'location'));

  -- The curation log: an edit is keyed by column, an answer names its fields
  -- in camelCase, a view choice by view word. A part's fields stay as they are.
  UPDATE experience_curation_log l
     SET details = (
           SELECT jsonb_object_agg(CASE k.key WHEN 'description' THEN 'subtitle'
                                              WHEN 'short_description' THEN 'description'
                                              ELSE k.key END, k.value)
             FROM jsonb_each(l.details) AS k)
   WHERE l.action = 'edited' AND jsonb_typeof(l.details) = 'object'
     AND l.details ?| ARRAY['description', 'short_description'];

  UPDATE experience_curation_log l
     SET details = jsonb_set(l.details, '{fields}', (
           SELECT jsonb_agg(CASE
                              WHEN jsonb_typeof(f.v) = 'string' AND f.v #>> '{}' = 'description' THEN '"subtitle"'::jsonb
                              WHEN jsonb_typeof(f.v) = 'string' AND f.v #>> '{}' = 'shortDescription' THEN '"description"'::jsonb
                              WHEN f.v->>'field' = 'description' THEN jsonb_set(f.v, '{field}', '"subtitle"')
                              WHEN f.v->>'field' = 'shortDescription' THEN jsonb_set(f.v, '{field}', '"description"')
                              ELSE f.v END ORDER BY f.ord)
             FROM jsonb_array_elements(l.details->'fields') WITH ORDINALITY AS f(v, ord)))
   WHERE jsonb_typeof(l.details->'fields') = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.details->'fields') f
                  WHERE f #>> '{}' IN ('description', 'shortDescription')
                     OR f->>'field' IN ('description', 'shortDescription'));

  -- A publication names the claimed fields it left as the curator wrote them,
  -- in camelCase, beside its `fields`. A part's own list stays as it is.
  UPDATE experience_curation_log l
     SET details = jsonb_set(l.details, '{claimedFieldsSkipped}', (
           SELECT jsonb_agg(CASE f.v WHEN 'description' THEN 'subtitle'
                                     WHEN 'shortDescription' THEN 'description'
                                     ELSE f.v END ORDER BY f.ord)
             FROM jsonb_array_elements_text(l.details->'claimedFieldsSkipped') WITH ORDINALITY AS f(v, ord)))
   WHERE l.action = 'published' AND jsonb_typeof(l.details->'claimedFieldsSkipped') = 'array'
     AND l.details->'claimedFieldsSkipped' ?| ARRAY['description', 'shortDescription'];

  UPDATE experience_curation_log l
     SET details = jsonb_set(l.details, '{choices}', (
           SELECT jsonb_agg(CASE WHEN c.v->>'field' = 'description' THEN jsonb_set(c.v, '{field}', '"subtitle"')
                                 ELSE c.v END ORDER BY c.ord)
             FROM jsonb_array_elements(l.details->'choices') WITH ORDINALITY AS c(v, ord)))
   WHERE l.action = 'views_chosen' AND jsonb_typeof(l.details->'choices') = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(l.details->'choices') c WHERE c->>'field' = 'description');
END $$;

COMMIT;
