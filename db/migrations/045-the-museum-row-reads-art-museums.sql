-- 045: The museum row reads "Art Museums" (ADR-0045 decision 8, #818, Epic #815)
--
-- The source row was seeded as "Top Art Museums" — the works-first selection
-- rule's name (ADR-0023) — and that name is what a reader saw wherever the row
-- is shown: the group header of the map-mode list, the Discover pills and
-- counts, the chip beside an object's name on a review card, the curator scope
-- picker. ADR-0045 §8: the kind is Art Museums, and the works-first source is
-- one of its inputs. Until the kind table of ADR-0045 §4 lands the kind is its
-- source row, so the reader's name is the row's name.
--
-- Title Case like the sibling rows ("UNESCO World Heritage Sites", "Public Art
-- & Monuments"). `01-schema.sql` seeds the new name for a fresh database; its
-- `requires_curation` guard keeps the old one on purpose, since a database that
-- reaches that guard predates migration 018 and therefore this file too.
--
-- Re-runnable: a row already renamed matches nothing.
--
-- Order: apply this before the next re-application of 01-schema.sql. Its seed
-- inserts 'Art Museums' with `ON CONFLICT (name) DO NOTHING`, so a database
-- still holding 'Top Art Museums' would gain a second museum row from it. A
-- database in that state is refused loudly rather than renamed around: a
-- silent skip would record the rename as done while id 2 — the row
-- `MUSEUM_CATEGORY_ID` points at — went on reading the old name for every
-- reader. The shape 015 and 016 use for "category 2 is not what I expect".

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_categories WHERE name = 'Art Museums')
     AND EXISTS (SELECT 1 FROM experience_categories WHERE name = 'Top Art Museums') THEN
    RAISE EXCEPTION 'refusing to rename: both "Top Art Museums" and "Art Museums" exist — 01-schema.sql was re-applied before this migration, so the museum row is duplicated; remove the seeded duplicate first';
  END IF;
END $$;

UPDATE experience_categories
   SET name = 'Art Museums'
 WHERE name = 'Top Art Museums';

COMMIT;
