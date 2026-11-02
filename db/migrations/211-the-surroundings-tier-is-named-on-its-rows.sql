-- 211-the-surroundings-tier-is-named-on-its-rows.sql
--
-- The tier ADR-0171 built, a place measured against what lies within 50 km of
-- it by the world tier's own sources, is the surroundings tier (ADR-0178). The
-- regional tier is the one that reads sources native to a region, and none is
-- adopted yet. The runs now write the surroundings tier's name (#2287): the
-- tier a membership records is facts.tier = 'surroundings', and the sentences
-- the cut writes for a curator say "the surroundings tier". What the runs
-- wrote before carries the old name, and a curator reading "In the regional
-- tier by its readers" on a card takes a church measured against its
-- neighbours for one a native register listed.
--
-- This file renames what is stored:
--
-- - the tier fact on a membership the cut admitted;
-- - the note the cut wrote on it ("In the regional tier by …", "Stays in the
--   regional tier by …"), kept in facts.admissionNote;
-- - the reasons the cut and Archaeology's two conditions of the tier wrote on
--   a refusal, in the admission reason, a curator's pin on it and the
--   question a run put about the pin. A pin's reason is compared with the
--   run's reason word by word, so a pin left with the old name would be asked
--   about again by the first run that writes the new one;
-- - the tier a run recorded as changed (metadata.tier) on its changeset, so
--   the run history names one tier by one name.
--
-- Each sentence is matched by the words the cut writes around the tier's
-- name, never by the word "regional" alone: a museum's name (Sverdlovsk
-- Regional Natural History Museum) is not a tier.
--
-- A run of the code before #2287 writes the old name again. Re-runnable: every
-- statement touches only rows that still hold the old name, so applying the
-- file again after such a run renames what it wrote.

\set ON_ERROR_STOP on

BEGIN;

UPDATE experience_kind_memberships
   SET facts = jsonb_set(facts, '{tier}', '"surroundings"')
 WHERE facts->>'tier' = 'regional';

UPDATE experience_kind_memberships
   SET facts = jsonb_set(facts, '{admissionNote}', to_jsonb(
         regexp_replace(facts->>'admissionNote', '^(In|Stays in) the regional tier ', '\1 the surroundings tier ')))
 WHERE facts->>'admissionNote' ~ '^(In|Stays in) the regional tier ';

UPDATE experience_kind_memberships
   SET admission_reason = regexp_replace(admission_reason,
         'the regional tier( asks for|''s cut: | only while a Wikivoyage edition| admits is one the map shows| a part is the whole''s visit)',
         'the surroundings tier\1', 'g')
 WHERE admission_reason ~ 'the regional tier( asks for|''s cut: | only while a Wikivoyage edition| admits is one the map shows| a part is the whole''s visit)';

UPDATE experience_kind_memberships
   SET admission_pin_reason = regexp_replace(admission_pin_reason,
         'the regional tier( asks for|''s cut: | only while a Wikivoyage edition| admits is one the map shows| a part is the whole''s visit)',
         'the surroundings tier\1', 'g')
 WHERE admission_pin_reason ~ 'the regional tier( asks for|''s cut: | only while a Wikivoyage edition| admits is one the map shows| a part is the whole''s visit)';

UPDATE experience_kind_memberships
   SET admission_question_reason = regexp_replace(admission_question_reason,
         'the regional tier( asks for|''s cut: | only while a Wikivoyage edition| admits is one the map shows| a part is the whole''s visit)',
         'the surroundings tier\1', 'g')
 WHERE admission_question_reason ~ 'the regional tier( asks for|''s cut: | only while a Wikivoyage edition| admits is one the map shows| a part is the whole''s visit)';

UPDATE experience_sync_changes c
   SET changed_fields = (
         SELECT jsonb_agg(
                  CASE WHEN f.field->>'field' = 'metadata.tier'
                       THEN f.field || jsonb_strip_nulls(jsonb_build_object(
                              'new', CASE WHEN f.field->>'new' = 'regional' THEN 'surroundings' END,
                              'old', CASE WHEN f.field->>'old' = 'regional' THEN 'surroundings' END))
                       ELSE f.field END
                  ORDER BY f.at)
           FROM jsonb_array_elements(c.changed_fields) WITH ORDINALITY AS f(field, at))
 WHERE c.changed_fields @> '[{"field": "metadata.tier", "new": "regional"}]'
    OR c.changed_fields @> '[{"field": "metadata.tier", "old": "regional"}]';

COMMENT ON COLUMN experience_kind_memberships.facts IS 'The kind''s own facts about the place (year, creators, wikidataClasses, artworkCount, admissionNote, the tier that admitted the row where it is the surroundings one, a World Heritage Site''s dateInscribed, inDanger, dangerList, criteria, areaHectares, ...), written by the source''s run every pass; one a reader is shown (the inscription year, the danger flag and its listing) waits behind the gate on a held place. No other kind''s run writes them, and a refused membership keeps its own (ADR-0153, ADR-0154, ADR-0171, ADR-0178, #1775, #2068, #2178).';

COMMIT;
