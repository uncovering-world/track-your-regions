-- 215-a-kinds-types-are-declared-in-the-shared-package.sql
--
-- Every kind's type vocabulary is now declared once, each type with the word
-- a reader sees for it, in the shared package (packages/shared/src/placeTypes.ts,
-- #2319), and the frontend reads it from there. The column's comment named the
-- frontend module as the list; it now names the declaration.
--
-- Re-runnable: the comment is replaced.

\set ON_ERROR_STOP on

BEGIN;

COMMENT ON COLUMN experience_kind_memberships.type IS
  'The type within this membership''s kind, where the kind has types a traveller still browses together '
  '(ADR-0045): ''cultural''/''natural''/''mixed'' for World Heritage, ''cathedral'', ''holy site'' and the rest '
  'for a place of worship, ''site''/''museum'' for archaeology; every kind''s list, each type with the word a reader sees for it, is packages/shared/src/placeTypes.ts. '
  'NULL for an art museum. One vocabulary per kind (#814), '
  'and the membership''s rather than the place''s, since a place in two kinds has a type in each (ADR-0084). '
  'A curator''s claim on it is ''type'' in this row''s curated_fields.';

COMMIT;
