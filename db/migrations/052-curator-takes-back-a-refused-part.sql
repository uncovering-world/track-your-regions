-- 052-curator-takes-back-a-refused-part.sql
--
-- The way back from a curator's no to an unread point or work (#859).
-- ADR-0053 wrote that no as a mark -- refused_at on experience_locations and
-- experience_treasures -- and recorded what it left behind: "a refused part
-- has no screen yet", so the take-back is a follow-up and the mark is one
-- UPDATE when that screen exists. This is that screen's schema half.
--
-- One act joins the closed list of what the curation log may record. It is
-- named contents_unrefused after the pair the log already carries, rejected
-- and unrejected: a take-back is the same act read backwards, and a reader
-- scanning a history has to see the two as one story rather than guess that
-- "restored" (which belongs to a verdict on a point, and reads as published)
-- meant this.
--
-- The two partial indexes are what the new list is read through. Refused parts
-- are a handful among 7844 points and 1446 links today -- none at all on the
-- development catalogue, since the first live worship run's 1078 arrivals are
-- still unanswered -- and the review page asks per object whether any exist,
-- which is exactly the shape idx_experience_locations_undecided already has.
--
-- Re-runnable: the CHECK is dropped and re-added to the same list
-- 01-schema.sql declares, and both indexes are IF NOT EXISTS.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused'));

CREATE INDEX IF NOT EXISTS idx_experience_locations_refused ON experience_locations(experience_id) WHERE refused_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_experience_treasures_refused ON experience_treasures(experience_id) WHERE refused_at IS NOT NULL;

COMMIT;
