-- 076-a-merge-moves-one-place-into-another.sql
--
-- Two rows that are one place become one place by a merge that can be
-- undone (#1247, ADR-0046, ADR-0086). A merge is a row of experience_merges
-- recording what it moved; the folded place and any point folded into one of
-- the survivor's are marked merged_into_id and kept, never deleted.
--
-- The catalogue's own merge -- two rows sharing a Wikidata item -- names no
-- curator, so the curation log's curator may be null on a 'merged' row and on
-- no other.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent and every constraint is
-- dropped before it is added.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experiences ADD COLUMN IF NOT EXISTS merged_into_id INTEGER REFERENCES experiences(id);
CREATE INDEX IF NOT EXISTS idx_experiences_merged_into ON experiences(merged_into_id) WHERE merged_into_id IS NOT NULL;

ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS merged_into_id INTEGER REFERENCES experience_locations(id);
CREATE INDEX IF NOT EXISTS idx_experience_locations_merged_into
  ON experience_locations(merged_into_id) WHERE merged_into_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS experience_merges (
    id SERIAL PRIMARY KEY,
    survivor_id INTEGER NOT NULL REFERENCES experiences(id),
    folded_id INTEGER NOT NULL REFERENCES experiences(id),
    merged_by INTEGER REFERENCES users(id),
    reason VARCHAR(30) NOT NULL CHECK (reason IN ('equal_wikidata_item', 'curator')),
    moved JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    undone_at TIMESTAMPTZ,
    undone_by INTEGER REFERENCES users(id),
    CHECK (survivor_id <> folded_id)
);
CREATE INDEX IF NOT EXISTS idx_experience_merges_survivor ON experience_merges(survivor_id);
CREATE INDEX IF NOT EXISTS idx_experience_merges_folded ON experience_merges(folded_id);

ALTER TABLE experience_curation_log ALTER COLUMN curator_id DROP NOT NULL;
ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_curator_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_curator_check
    CHECK (curator_id IS NOT NULL OR action = 'merged');

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone'));

COMMIT;
