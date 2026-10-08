-- 077-a-curator-chooses-between-two-sources-views.sql
--
-- Two data sources that describe one place differently -- a World Heritage
-- id and a Wikidata item on one merged place -- ask a curator which source's
-- name, description, picture or coordinate the place shows (#1246). A choice
-- is a row of experience_view_choices, recording the views of the field as
-- they stood when it was made, so the question comes back only when one of
-- the sources sends something different. A source's view of a place now
-- carries the credit of its picture, which the card shows beside it, filled
-- here from the place where the view's picture is the place's own.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent and every constraint is
-- dropped before it is added.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS reported_image_credit JSONB;

-- A view recorded before this column has no credit; where its picture is the
-- one the place shows, the place's credit is that picture's. Any other view
-- gets its credit from its source's next run.
UPDATE experience_kind_memberships m
   SET reported_image_credit = e.metadata->'imageCredit'
  FROM experiences e
 WHERE e.id = m.experience_id
   AND m.reported_image_credit IS NULL
   AND m.reported_image_url = e.image_url
   AND e.metadata ? 'imageCredit';

CREATE TABLE IF NOT EXISTS experience_view_choices (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    field VARCHAR(20) NOT NULL CHECK (field IN ('name', 'description', 'imageUrl', 'location')),
    chosen_membership_id INTEGER REFERENCES experience_kind_memberships(id) ON DELETE SET NULL,
    views JSONB NOT NULL,
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (experience_id, field)
);

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen'));

COMMIT;
