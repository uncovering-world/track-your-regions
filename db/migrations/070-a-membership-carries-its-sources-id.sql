-- 070-a-membership-carries-its-sources-id.sql
--
-- A membership carries the id its source knows the place by (#1244, ADR-0084).
--
-- experience_kind_memberships.external_id, unique per source, is what a run
-- finds, admits and marks its places through from now on; the place's own
-- source_id and external_id only say which source first brought the row. Every
-- membership is filled from its place: until a merge (#755) a place's one
-- membership names the place's own source, which migration 046 checked when
-- it made the table and the catalogue check
-- membership-source-disagrees-with-row has said every day since. The NOT NULL
-- rides on a validated CHECK, 063's way, so SET NOT NULL finds the proof in
-- the catalogue rather than scanning under ACCESS EXCLUSIVE.
--
-- Must run before 01-schema.sql is re-applied: the schema declares the column
-- NOT NULL. Re-runnable: the column is added if absent, the backfill touches
-- only rows still without an id, each constraint is dropped if present before
-- it is added, and SET NOT NULL on a NOT NULL column changes nothing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

-- A membership still without an id whose source is not its place's own would
-- take an id its source never gave it. None exists before #755 builds the
-- merge; refuse rather than guess if one does.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM experience_kind_memberships m
      JOIN experiences e ON e.id = m.experience_id
     WHERE m.external_id IS NULL
       AND m.source_id <> e.source_id
  ) THEN
    RAISE EXCEPTION 'a membership names a source other than its place''s: its id cannot be read off the place';
  END IF;
END $$;

UPDATE experience_kind_memberships m
   SET external_id = e.external_id
  FROM experiences e
 WHERE e.id = m.experience_id
   AND m.external_id IS NULL;

ALTER TABLE experience_kind_memberships DROP CONSTRAINT IF EXISTS experience_kind_memberships_external_id_not_null;
ALTER TABLE experience_kind_memberships ADD CONSTRAINT experience_kind_memberships_external_id_not_null
  CHECK (external_id IS NOT NULL) NOT VALID;

COMMIT;

BEGIN;
ALTER TABLE experience_kind_memberships VALIDATE CONSTRAINT experience_kind_memberships_external_id_not_null;
ALTER TABLE experience_kind_memberships ALTER COLUMN external_id SET NOT NULL;
ALTER TABLE experience_kind_memberships DROP CONSTRAINT experience_kind_memberships_external_id_not_null;

ALTER TABLE experience_kind_memberships DROP CONSTRAINT IF EXISTS experience_kind_memberships_source_external_key;
ALTER TABLE experience_kind_memberships ADD CONSTRAINT experience_kind_memberships_source_external_key
  UNIQUE (source_id, external_id);

COMMENT ON COLUMN experience_kind_memberships.external_id IS 'The id the source knows the place by -- a World Heritage id, a Wikidata item -- unique per source (ADR-0084 decision 2). A run finds, admits and marks its places through it; the place''s own source_id and external_id only say which source first brought the row.';
COMMENT ON COLUMN experiences.external_id IS 'The id the source that first brought this row knows it by (e.g., a UNESCO id_no). Provenance only since ADR-0084: a run finds a place through its membership''s external_id, never through this.';
COMMIT;
