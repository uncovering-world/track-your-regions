-- 055-sources-are-named-as-sources.sql
--
-- The source table and its foreign keys are named as sources (#819; ADR-0045
-- decisions 3 and 8).
--
-- `experience_categories` has been the table of sources since ADR-0045 -- one
-- row per list a sync reads to fill a kind -- and a kind has been its own
-- table since migration 046. The word "category" survived on the table, on
-- every column that points at it, and on the curator scope that names one:
-- readers that mean the kind and readers that mean the source both spelled
-- `category_id`, and which of the two a reader meant was a comment beside it.
-- This file gives the source side its name; the readers that mean the kind
-- read `experience_kind_memberships.kind_id` from here on, and nothing left
-- in the schema says "category".
--
-- What is renamed, and nothing else:
--   experience_categories            -> experience_sources (with its sequence
--                                       and its constraints)
--   experiences.category_id          -> source_id  (still the arbiter of the
--                                       row's identity, UNIQUE(source_id,
--                                       external_id), until #755)
--   experience_sync_logs.category_id -> source_id
--   curator_assignments.category_id  -> source_id, and the scope that names
--                                       one is 'source', not 'category' --
--                                       the word migration 001 created it
--                                       with and `CuratorScopeType` never
--                                       stopped saying (#452)
--   wikidata_query_cache.category_id -> source_id
--   wikidata_cache_policy.category_id-> source_id
--
-- No row moves and no value changes but the scope word: a curator of the
-- UNESCO source keeps the same assignment under the new spelling.
--
-- Re-runnable: every rename is guarded on the old name still being there, and
-- the scope constraints are dropped IF EXISTS and re-created. A database
-- provisioned from migration 001, whose curator_assignments already say
-- 'source', ends in the same place. The one state it refuses is both source
-- tables at once (see the first block).
--
-- Order: BEFORE the next re-application of 01-schema.sql. That file creates
-- `experience_sources` if absent, so run ahead of this one it would create a
-- second, empty source table beside the full one; it refuses to run while
-- `experience_categories` still exists, and names this file.

\set ON_ERROR_STOP on

BEGIN;

-- The table, its sequence and its constraints. Both tables at once is the
-- state a re-application of 01-schema.sql past its guard leaves behind -- a
-- full experience_categories every row still points at, beside an empty
-- experience_sources -- and it is refused rather than skipped, since skipping
-- would record this file as applied on a database it did not rename.
DO $$
BEGIN
    IF to_regclass('experience_categories') IS NOT NULL
       AND to_regclass('experience_sources') IS NOT NULL THEN
        RAISE EXCEPTION 'migration 055: experience_categories and experience_sources both exist; drop the empty experience_sources (01-schema.sql created it ahead of this file) and run again';
    END IF;
    IF to_regclass('experience_categories') IS NOT NULL THEN
        ALTER TABLE experience_categories RENAME TO experience_sources;
        ALTER SEQUENCE experience_categories_id_seq RENAME TO experience_sources_id_seq;
        ALTER TABLE experience_sources RENAME CONSTRAINT experience_categories_pkey TO experience_sources_pkey;
        ALTER TABLE experience_sources RENAME CONSTRAINT experience_categories_name_key TO experience_sources_name_key;
        ALTER TABLE experience_sources RENAME CONSTRAINT experience_categories_kind_id_fkey TO experience_sources_kind_id_fkey;
    END IF;
END $$;

COMMENT ON TABLE experience_sources IS 'Sources: the lists a sync reads to fill a kind (ADR-0045 decision 3). One row per sync service, with its endpoint, config and gate.';

-- The place's source: the arbiter of its identity until #755.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'experiences' AND column_name = 'category_id') THEN
        ALTER TABLE experiences RENAME COLUMN category_id TO source_id;
        ALTER TABLE experiences RENAME CONSTRAINT experiences_category_id_fkey TO experiences_source_id_fkey;
        ALTER TABLE experiences RENAME CONSTRAINT experiences_category_id_external_id_key TO experiences_source_id_external_id_key;
        ALTER INDEX idx_experiences_category_id RENAME TO idx_experiences_source_id;
    END IF;
END $$;

-- The run's source.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'experience_sync_logs' AND column_name = 'category_id') THEN
        ALTER TABLE experience_sync_logs RENAME COLUMN category_id TO source_id;
        ALTER TABLE experience_sync_logs RENAME CONSTRAINT experience_sync_logs_category_id_fkey TO experience_sync_logs_source_id_fkey;
        ALTER INDEX idx_experience_sync_logs_category RENAME TO idx_experience_sync_logs_source;
    END IF;
END $$;

-- The curator scope that names a source, under the word it names.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'curator_assignments' AND column_name = 'category_id') THEN
        ALTER TABLE curator_assignments RENAME COLUMN category_id TO source_id;
        ALTER TABLE curator_assignments RENAME CONSTRAINT curator_assignments_category_id_fkey TO curator_assignments_source_id_fkey;
    END IF;
END $$;
ALTER TABLE curator_assignments DROP CONSTRAINT IF EXISTS curator_assignments_scope_type_check;
ALTER TABLE curator_assignments DROP CONSTRAINT IF EXISTS valid_scope;
UPDATE curator_assignments SET scope_type = 'source' WHERE scope_type = 'category';
ALTER TABLE curator_assignments
    ADD CONSTRAINT curator_assignments_scope_type_check CHECK (scope_type IN ('region', 'source', 'global'));
ALTER TABLE curator_assignments
    ADD CONSTRAINT valid_scope CHECK (
        (scope_type = 'global' AND region_id IS NULL AND source_id IS NULL) OR
        (scope_type = 'region' AND region_id IS NOT NULL AND source_id IS NULL) OR
        (scope_type = 'source' AND region_id IS NULL AND source_id IS NOT NULL)
    );
DROP INDEX IF EXISTS idx_unique_category_assignment;
DROP INDEX IF EXISTS idx_unique_source_assignment;
CREATE UNIQUE INDEX idx_unique_source_assignment
    ON curator_assignments(user_id, source_id) WHERE scope_type = 'source';
COMMENT ON TABLE curator_assignments IS 'Scoped curator permissions: global, per-region, or per-source';
COMMENT ON COLUMN curator_assignments.scope_type IS 'Permission scope: global (all), region (specific region + descendants), source (every place one source brought)';

-- Whose run kept a cached answer, and whose lifetime an admin set.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'wikidata_query_cache' AND column_name = 'category_id') THEN
        ALTER TABLE wikidata_query_cache RENAME COLUMN category_id TO source_id;
        ALTER TABLE wikidata_query_cache RENAME CONSTRAINT wikidata_query_cache_category_id_fkey TO wikidata_query_cache_source_id_fkey;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'wikidata_cache_policy' AND column_name = 'category_id') THEN
        ALTER TABLE wikidata_cache_policy RENAME COLUMN category_id TO source_id;
        ALTER TABLE wikidata_cache_policy RENAME CONSTRAINT wikidata_cache_policy_category_id_fkey TO wikidata_cache_policy_source_id_fkey;
    END IF;
END $$;
COMMENT ON COLUMN wikidata_query_cache.query_hash IS 'SHA-256 of the asking source''s source_id and the exact query text (ADR-0047). The query is the question, so a changed filter is a different key and misses by construction rather than by remembering to invalidate.';

-- Nothing in the schema says "category" any more.
DO $$
DECLARE
    leftover TEXT;
BEGIN
    SELECT string_agg(table_name || '.' || column_name, ', ')
      INTO leftover
      FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'category_id';
    IF leftover IS NOT NULL THEN
        RAISE EXCEPTION 'migration 055: category_id survives on %', leftover;
    END IF;
END $$;

COMMIT;
