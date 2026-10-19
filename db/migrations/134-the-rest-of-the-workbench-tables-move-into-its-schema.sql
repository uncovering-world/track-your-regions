-- 134-the-rest-of-the-workbench-tables-move-into-its-schema.sql
--
-- Twelve workbench-tier tables that migration 131 left in `public` move into
-- the `workbench` schema (ADR-0124, #1710), so a dump of the serving tables
-- alone leaves no workbench table behind in `public`:
--
-- - the live Wikidata caches: wikidata_query_cache, wikidata_geoshapes,
--   wikidata_cache_policy;
-- - the catalogue-coverage survey (ADR-0081): coverage_kinds,
--   coverage_regions, coverage_expectations, coverage_expectation_kinds,
--   coverage_judgements;
-- - the world-view import's map candidates, region_map_images;
-- - the import's AI extraction: ai_settings, ai_usage_log, ai_learned_rules.
--
-- import_runs stays in `public`, re-tiered serving: region_import_state, which
-- the region tree reads, references it, and a serving table cannot reference
-- one a deployment of the serving tables leaves behind.
--
-- The database's search path is already `public, workbench` (migration 131),
-- so every reader and the coverage loader keep naming them bare. A key from a
-- moved table into a serving one (coverage_kinds to experience_kinds, the
-- caches to experience_sources, region_map_images to regions) holds while the
-- two tiers share a database; the split decides what replaces it (#1693).
--
-- `ALTER TABLE ... SET SCHEMA` moves a table's indexes, constraints and owned
-- sequence with it and keeps its foreign keys. A world-view import, a coverage
-- load or a source run writes these tables, so none may run while this file is
-- applied, and the backend and the dump worker restart straight after it.
--
-- Re-runnable: a table already in `workbench` is left alone. An empty one that
-- db/init/01-schema.sql made there, beside the table still in `public`, is
-- dropped before the real one moves in; one holding rows stops the migration.

\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS workbench;

DO $$
DECLARE
  -- Referenced before referencing, as in 131: a key follows the table it names.
  tables TEXT[] := ARRAY[
    'wikidata_cache_policy', 'wikidata_query_cache', 'wikidata_geoshapes',
    'coverage_kinds', 'coverage_regions', 'coverage_expectations', 'coverage_expectation_kinds',
    'coverage_judgements',
    'region_map_images',
    'ai_settings', 'ai_usage_log', 'ai_learned_rules'
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

COMMIT;
