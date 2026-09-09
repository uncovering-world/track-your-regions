-- 051-curator-refusal-of-arrival-and-contents.sql
--
-- A curator's no to what a gated source proposed (#852, ADR-0053). Until
-- now an arrival nobody wanted stayed pending for ever, and unread points
-- and works could only be published or left waiting. Two acts join the
-- closed list of what the curation log may record, and the parts gain the
-- one column the second act writes.
--
-- The refusal of an arrival is written on the membership the way a rule's
-- refusal is (admission = 'refused', the admission pin, the reason), so it
-- needs no column of its own -- only its own name in the log, because a
-- person refusing an object is a different act from a person agreeing with
-- a rule that did.
--
-- The refusal of an unread part is a mark beside the part's state, never a
-- fourth state: every reader hides a part by the one word 'pending', spelled
-- in a dozen statements, and a new word would leak through each of them. A
-- refused part stays pending and hidden; what the mark changes is the
-- question -- the review queue and the publish stop offering it.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, and the CHECK is dropped and
-- re-added to the same list 01-schema.sql declares.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS refused_at TIMESTAMPTZ;
COMMENT ON COLUMN experience_locations.refused_at IS 'When a curator refused this unread point (ADR-0053). The row stays pending and hidden; the queue and the publish stop asking about it, placement stops counting it toward a region, and a withdrawal it was holding is released. NULL = not refused.';

ALTER TABLE experience_treasures ADD COLUMN IF NOT EXISTS refused_at TIMESTAMPTZ;
COMMENT ON COLUMN experience_treasures.refused_at IS 'When a curator refused this unread link (ADR-0053). Written together with curation_state = pending on the link itself, since a link can be unread on the work''s axis alone and readers hide by that word, never by this mark. The queue and the publish stop asking about it. NULL = not refused.';

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused'));

COMMIT;
