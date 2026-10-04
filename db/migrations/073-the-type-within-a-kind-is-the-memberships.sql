-- 073-the-type-within-a-kind-is-the-memberships.sql
--
-- The type within a kind is the membership's (#1253, ADR-0084).
--
-- experience_kind_memberships.type takes the place's type, and a curator's
-- claim on it moves from the place's curated_fields to the membership's; the
-- place's column is dropped. Until a merge (#755) a place has one membership,
-- so the place's type is that membership's.
--
-- Must run before 01-schema.sql is re-applied: the schema no longer declares
-- experiences.type. Re-runnable: the column is added if absent, the copy runs
-- only while the place still has the column, and the drop names IF EXISTS.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS type VARCHAR(100);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'experiences' AND column_name = 'type'
  ) THEN
    -- A place with two memberships would hand one kind's type to the other.
    -- None exists before #755 builds the merge; refuse rather than guess.
    IF EXISTS (
      SELECT 1 FROM experience_kind_memberships
       GROUP BY experience_id HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION 'a place has more than one membership: whose type the place''s column is cannot be told';
    END IF;
    UPDATE experience_kind_memberships m
       SET type = e.type,
           curated_fields = CASE
             WHEN COALESCE(e.curated_fields, '[]'::jsonb) ? 'type' AND NOT m.curated_fields ? 'type'
               THEN m.curated_fields || '["type"]'::jsonb
             ELSE m.curated_fields END
      FROM experiences e
     WHERE e.id = m.experience_id;
    UPDATE experiences
       SET curated_fields = curated_fields - 'type'
     WHERE curated_fields ? 'type';
  END IF;
END $$;

DROP INDEX IF EXISTS idx_experiences_type;
ALTER TABLE experiences DROP COLUMN IF EXISTS type;

COMMENT ON COLUMN experience_kind_memberships.type IS
  'The type within this membership''s kind, where the kind has types a traveller still browses together '
  '(ADR-0045): ''cultural''/''natural''/''mixed'' for World Heritage, ''monument''/''sculpture'' '
  'for public art, ''cathedral''/''church''/''chapel''/''monastery''/''mosque''/''temple''/''shrine''/''synagogue'' '
  'for a place of worship, ''site''/''museum'' for archaeology. NULL for an art museum. One vocabulary per kind (#814), '
  'and the membership''s rather than the place''s, since a place in two kinds has a type in each (ADR-0084). '
  'A curator''s claim on it is ''type'' in this row''s curated_fields.';

COMMIT;
