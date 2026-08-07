-- 016: a category may refuse what the source still lists (ADR-0024)
--
-- The works-first museum importer decides membership by rule: a venue enters
-- *Top Art Museums* because it holds an iconic work of art, and the art test
-- refuses an archaeological site, a natural history collection, a church or a
-- stretch of painted wall. Until now a refusal had nowhere to go. The two axes
-- ADR-0020 defined are both statements about the world — `former` says the
-- source stopped listing it, `lost` says it no longer exists — and neither is
-- true of the British Museum, which is open today and which Wikidata still
-- lists. Writing either to hide it would put a false claim in the database.
--
-- So admission is a third axis, independent of the other two and, unlike them,
-- set by the machine: a refusal is not an ambiguous observation but our own
-- deterministic rule, applied to data we hold, naming the object before it says
-- no. A refused row is hidden from readers and stays in the table, because
-- `user_visited_experiences` cascades (ADR-0022) and because the refused rows
-- are the list the archaeology category will be built from.
--
-- Order: apply this before the next re-application of 01-schema.sql. That file
-- now mirrors these columns, so re-applying it first is harmless — but the
-- application code reads `admission` from the moment it deploys, and a database
-- without the column answers every read with an error.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/016-admission.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experiences
    ADD COLUMN IF NOT EXISTS admission VARCHAR(10) NOT NULL DEFAULT 'admitted',
    ADD COLUMN IF NOT EXISTS admission_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_admission_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_admission_check
            CHECK (admission IN ('admitted', 'refused'));
    END IF;
END $$;

COMMENT ON COLUMN experiences.admission IS
    'admitted or refused. Whether this category accepts the row, independent of whether the source still lists it. '
    'The machine sets this one: a refusal is our own rule applied to an object the run named, not an observation. '
    'A refused row is hidden from every read that offers somewhere to go, and from none that records a visit.';
COMMENT ON COLUMN experiences.admission_reason IS
    'Why the category refused it, stated verbatim to the curator. On the row rather than in '
    'experience_sync_changes because a changeset is keyed by the external id the run named, which is not always this row''s.';

-- Partial: 27 refused rows out of 1585 today, and every read that filters asks
-- only about the exception.
CREATE INDEX IF NOT EXISTS idx_experiences_admission ON experiences (admission)
    WHERE admission <> 'admitted';

-- Clear a mark that was never true.
--
-- Before this axis existed, the only column that could record a refusal was
-- `missing_since`, and a development run stamped it on the 27 museum rows the
-- art test turned down. That is a false claim — Wikidata goes on listing every
-- one of them — and it files them under "Gone from the source", where all three
-- curator verdicts are wrong answers. The refusals are re-recorded on
-- `admission` by the next run; this clears the wrong column.
--
-- Scoped to category 2 because that is the only place the mark could have come
-- from: the museum source is `ranked`, so bulk missing detection is refused for
-- it and nothing else in this category writes the column. UNESCO's marks are
-- real observations and are not touched. A no-op on a database that never ran
-- that build, which is every database but the one this was written on.
DO $$
DECLARE
    category_name text;
    cleared integer;
BEGIN
    -- Ids come from SERIAL and seed insertion order; nothing else pins 2 to
    -- this category. Migrations 014 and 015 guard the same ambiguity.
    SELECT name INTO category_name FROM experience_categories WHERE id = 2;
    IF category_name IS DISTINCT FROM 'Top Art Museums' THEN
        -- Skipped, not raised. This block is housekeeping and the ALTER above is
        -- not: the application reads `admission` from the moment it deploys, so
        -- an exception here would roll back the column with it and every
        -- experience read would 500. A database where category 2 is named
        -- something else is one where these marks were never written, which is
        -- precisely the case where there is nothing to clear.
        RAISE NOTICE 'skipping the mark cleanup: category 2 is not Top Art Museums (found %)', category_name;
    ELSE
        UPDATE experiences SET missing_since = NULL
         WHERE category_id = 2 AND missing_since IS NOT NULL;
        GET DIAGNOSTICS cleared = ROW_COUNT;
        RAISE NOTICE 'cleared stopgap missing marks on % museum row(s)', cleared;
    END IF;
END $$;

COMMIT;
