-- 194-a-place-of-worship-is-typed-a-holy-place-too.sql
--
-- Places of worship gains two types, 'sacred mountain' and 'holy site', for a
-- holy place that is no building (ADR-0161, #1978). No column changes: the
-- description of the type column stops listing one kind's words and points at
-- the one list every kind's types live in. The run writes the new types.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

COMMENT ON COLUMN experience_kind_memberships.type IS
  'The type within this membership''s kind, where the kind has types a traveller still browses together '
  '(ADR-0045): ''cultural''/''natural''/''mixed'' for World Heritage, ''cathedral'', ''holy site'' and the rest '
  'for a place of worship, ''site''/''museum'' for archaeology; every kind''s list is frontend/src/utils/experienceTypes.ts. '
  'NULL for an art museum. One vocabulary per kind (#814), '
  'and the membership''s rather than the place''s, since a place in two kinds has a type in each (ADR-0084). '
  'A curator''s claim on it is ''type'' in this row''s curated_fields.';

COMMIT;
