-- 230-memberships-are-named-source-records.sql
--
-- The table of a place's memberships is named source_records (#2118, Epic
-- #2115): a row is one source's record of a place. Today every row places the
-- place in a kind, as before; the slices after this one give the table its
-- records of a place in a whole, which is why the name is the source's record
-- and not the kind's membership.
--
-- What is renamed, and nothing else:
--   experience_kind_memberships        -> source_records, with its sequence
--   experience_kind_memberships_<x>    -> source_records_<x>, every constraint
--                                         and index named after the table
--   idx_experience_kind_memberships_<x> -> idx_source_records_<x>
--   every function whose body names the table, rewritten under the new name:
--   the listing, crowding, pairing, identifier and component triggers, the
--   curation-move guard (which tells the table by TG_TABLE_NAME) and the tile
--   function, so the dev stack keeps working before 01-schema.sql is
--   re-applied.
-- No row moves and no value changes. Triggers keep their names, which never
-- named the table; foreign keys of other tables point at the table by oid and
-- follow it.
--
-- Re-runnable: the renames are guarded on the old names still being there,
-- and a function no longer naming the old table is left alone. The one state
-- it refuses is both tables at once, which a re-application of 01-schema.sql
-- past its guard would leave behind.
--
-- Order: BEFORE the next re-application of 01-schema.sql, which creates
-- source_records if absent and refuses to run while
-- experience_kind_memberships still exists.

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    rel RECORD;
    fn RECORD;
BEGIN
    IF to_regclass('experience_kind_memberships') IS NOT NULL
       AND to_regclass('source_records') IS NOT NULL THEN
        RAISE EXCEPTION 'migration 230: experience_kind_memberships and source_records both exist; drop the empty source_records (01-schema.sql created it ahead of this file) and run again';
    END IF;

    IF to_regclass('experience_kind_memberships') IS NOT NULL THEN
        ALTER TABLE experience_kind_memberships RENAME TO source_records;
    END IF;
    IF to_regclass('experience_kind_memberships_id_seq') IS NOT NULL THEN
        ALTER SEQUENCE experience_kind_memberships_id_seq RENAME TO source_records_id_seq;
    END IF;

    -- Constraints first: renaming a unique or primary key constraint renames
    -- its index with it.
    FOR rel IN
        SELECT c.conname
          FROM pg_constraint c
         WHERE c.conrelid = 'source_records'::regclass
           AND c.conname LIKE 'experience\_kind\_memberships\_%'
    LOOP
        EXECUTE format('ALTER TABLE source_records RENAME CONSTRAINT %I TO %I',
                       rel.conname, 'source_records' || substr(rel.conname, length('experience_kind_memberships') + 1));
    END LOOP;

    FOR rel IN
        SELECT i.relname
          FROM pg_index x
          JOIN pg_class i ON i.oid = x.indexrelid
         WHERE x.indrelid = 'source_records'::regclass
           AND (i.relname LIKE 'experience\_kind\_memberships\_%' OR i.relname LIKE 'idx\_experience\_kind\_memberships\_%')
    LOOP
        EXECUTE format('ALTER INDEX %I RENAME TO %I',
                       rel.relname, replace(rel.relname, 'experience_kind_memberships', 'source_records'));
    END LOOP;

    -- A function body is stored as text, so one naming the table would fail
    -- at its next call until 01-schema.sql is re-applied. Each is rewritten
    -- from its own definition under the new name.
    FOR fn IN
        SELECT p.oid
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public', 'workbench')
           AND p.prokind = 'f'
           AND p.prosrc LIKE '%experience\_kind\_memberships%'
    LOOP
        EXECUTE replace(pg_get_functiondef(fn.oid), 'experience_kind_memberships', 'source_records');
    END LOOP;
END $$;

-- Nothing in the schema names the old table any more.
DO $$
DECLARE
    leftover TEXT;
BEGIN
    SELECT string_agg(name, ', ') INTO leftover FROM (
        SELECT conname::text AS name FROM pg_constraint WHERE conname LIKE '%experience\_kind\_memberships%'
        UNION ALL
        SELECT relname::text FROM pg_class WHERE relname LIKE '%experience\_kind\_memberships%'
        UNION ALL
        SELECT p.proname::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public', 'workbench') AND p.prosrc LIKE '%experience\_kind\_memberships%'
    ) named;
    IF leftover IS NOT NULL THEN
        RAISE EXCEPTION 'migration 230: still named after experience_kind_memberships: %', leftover;
    END IF;
END $$;

COMMIT;
