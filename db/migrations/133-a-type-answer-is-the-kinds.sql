-- 133-a-type-answer-is-the-kinds.sql
--
-- A curator's answer to a held row is recorded on the place, by value, so the
-- same value another kind's run proposes is answered with it (ADR-0038, #1599).
-- That is right for a fact of the place, and wrong for the type within a
-- kind, which is the membership's (ADR-0084): publishing Art Museums' type
-- wrote that membership's type and read Archaeology's proposal of the same
-- value as answered, though nothing wrote Archaeology's (#1720).
--
-- A type answer now records the source of the run it answers (`source_id`),
-- and answers only that source's runs; every other field's answer keeps a NULL
-- source and answers every run of the place (ADR-0125). The standing-answer
-- key gains the column, NULLS NOT DISTINCT as before.
--
-- The type answers recorded before carry no source. A published one is given
-- the source of the place's one membership whose type is the value it
-- published, the membership it was written to. A refused value was written to
-- no membership, so a refusal, like any other, stays the place's, as it was.
--
-- Re-runnable: the column and the key are added only where missing, and the
-- backfill touches only a type answer still without a source.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_held_decisions
  ADD COLUMN IF NOT EXISTS source_id INTEGER REFERENCES experience_sources(id) ON DELETE CASCADE;
COMMENT ON COLUMN experience_held_decisions.source_id IS 'The source whose runs a kind field answer answers (the type within the kind, ADR-0125); NULL for a fact of the place, answered for every run';

DO $$
DECLARE
  old_key TEXT;
BEGIN
  SELECT c.conname INTO old_key
    FROM pg_constraint c
   WHERE c.conrelid = 'experience_held_decisions'::regclass AND c.contype = 'u'
     AND c.conname <> 'experience_held_decisions_answer_key';
  IF old_key IS NOT NULL THEN
    EXECUTE format('ALTER TABLE experience_held_decisions DROP CONSTRAINT %I', old_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'experience_held_decisions'::regclass
                    AND conname = 'experience_held_decisions_answer_key') THEN
    ALTER TABLE experience_held_decisions ADD CONSTRAINT experience_held_decisions_answer_key
      UNIQUE NULLS NOT DISTINCT (experience_id, part_kind, part_ref, part_name, field, source_id);
  END IF;
END
$$;

DO $$
DECLARE
  given INTEGER;
BEGIN
  UPDATE experience_held_decisions d
     SET source_id = m.source_id
    FROM (SELECT experience_id, type, min(source_id) AS source_id, count(*) AS memberships
            FROM experience_kind_memberships
           WHERE type IS NOT NULL
           GROUP BY experience_id, type) m
   WHERE d.field = 'type' AND d.part_kind IS NULL AND d.source_id IS NULL AND d.answer = 'published'
     AND m.experience_id = d.experience_id AND to_jsonb(m.type) = d.value AND m.memberships = 1;
  GET DIAGNOSTICS given = ROW_COUNT;
  RAISE NOTICE 'experience_held_decisions: % type answer(s) given their source', given;
END
$$;

COMMIT;
