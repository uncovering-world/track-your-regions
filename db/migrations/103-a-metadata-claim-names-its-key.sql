-- 103-a-metadata-claim-names-its-key.sql
--
-- A claim on metadata is always per key (ADR-0077 decision 3, #729):
-- 'metadata.inDanger', 'metadata.website'. The bare column name protected
-- every key while matching none of their names, so the review queue,
-- accept-source, decline-source and publishing each resolved such a
-- conflict to a claim the row did not hold, and the run kept the column
-- whole while publishing wrote over it key by key. The CHECK refuses the
-- bare name from here on.
--
-- No row is migrated: the development database held no such claim on
-- 2026-09-29 or on 2026-10-14, and nothing writes one. A
-- database that does hold one fails the ADD CONSTRAINT and says so, rather
-- than having a curator's claim rewritten into keys nobody chose.
--
-- 01-schema.sql declares the same constraint and comment for a fresh
-- database.
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiences_curated_fields_per_key_metadata_check') THEN
        ALTER TABLE experiences ADD CONSTRAINT experiences_curated_fields_per_key_metadata_check
            CHECK (NOT (curated_fields ? 'metadata'));
    END IF;
END $$;

COMMENT ON COLUMN experiences.curated_fields IS 'What a curator has claimed on this place, so every run keeps the stored value: column names (name, short_description, image_url, ...) and, for metadata, one entry per key (metadata.website, metadata.inDanger). Never the bare name metadata (ADR-0077 decision 3): a claim is in the grain the run records, so every key it protects is a key a curator can be asked about.';

COMMIT;
