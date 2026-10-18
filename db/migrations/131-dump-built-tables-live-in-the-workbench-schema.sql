-- 131-dump-built-tables-live-in-the-workbench-schema.sql
--
-- The tables built from public dumps move into a schema of their own,
-- `workbench` (ADR-0124, #1694). They are the Wikidata subset, readership,
-- English Wikipedia's structure, the redirects readership folds, and the dump
-- builds' ledger with each build record.
--
-- On the development database on 2026-10-18 they held about 103 GB of its
-- 112 GB, and no reader or curator route reads them. A deployment of the
-- serving tables alone (#585) then leaves one schema behind instead of
-- picking tables out of `public`.
--
-- The database's search path becomes `public, workbench`, so every reader
-- keeps naming them bare. What creates a table there, the dump builds' `_next`
-- copies and staging tables, names the schema. A copy a cut build left behind
-- moves with its table, so the next build of the file still resumes from it
-- (ADR-0107).
--
-- `ALTER TABLE ... SET SCHEMA` moves a table's indexes, constraints and owned
-- sequence with it, and keeps the foreign keys. It rewrites no row, so it
-- holds each table's lock for a moment.
--
-- A dump build writes these tables, so none may run while this file is
-- applied. The search path applies to sessions that connect after it, so
-- restart the backend and the dump worker straight after.
--
-- Re-runnable: a table already in `workbench` is left alone. An empty one
-- that db/init/01-schema.sql made there, beside the table still in `public`,
-- is dropped before the real one moves in.

\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS workbench;

DO $$
DECLARE
  -- The ledger first: the build records reference it, and a foreign key
  -- follows the table it names wherever that moves.
  tables TEXT[] := ARRAY[
    'dump_builds',
    'wikidata_subset_builds', 'wikidata_entities', 'wikidata_claims', 'wikidata_labels',
    'wikidata_sitelinks', 'wikidata_class_closure',
    'enwiki_structure_builds', 'enwiki_pages', 'enwiki_page_items', 'enwiki_categories',
    'enwiki_category_links',
    'readership_month_files', 'readership_months', 'readership_staging',
    'wikipedia_redirect_builds', 'wikipedia_redirects',
    -- What a build in progress keeps: the copies it fills, the record a cut
    -- build resumes from, the redirect pages it stages.
    'wikidata_entities_next', 'wikidata_claims_next', 'wikidata_labels_next',
    'wikidata_sitelinks_next', 'wikidata_class_closure_next',
    'wikidata_build_resume_next', 'wikidata_build_pieces_next',
    'enwiki_pages_next', 'enwiki_page_items_next', 'enwiki_categories_next',
    'enwiki_category_links_next',
    'wikipedia_redirects_next', 'wikipedia_redirect_pages_stage', 'wikipedia_redirect_targets_stage'
  ];
  t TEXT;
  rows_there BOOLEAN;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
    IF to_regclass(format('workbench.%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM workbench.%I)', t) INTO rows_there;
      IF rows_there THEN
        RAISE EXCEPTION 'workbench.% and public.% both hold rows; resolve by hand before moving', t, t;
      END IF;
      EXECUTE format('DROP TABLE workbench.%I CASCADE', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA workbench', t);
  END LOOP;
END
$$;

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = public, workbench', current_database());
END
$$;

COMMIT;
