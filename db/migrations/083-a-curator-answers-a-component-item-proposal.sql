-- 083-a-curator-answers-a-component-item-proposal.sql
--
-- A curator answers a proposed Wikidata item for a World Heritage component
-- on the review queue's component-items card (#1272): accepted records the
-- item on the point as the curator's choice, refused keeps the candidate from
-- coming back. The card shows where the candidate stands beside the point, so
-- a proposal now carries the item's coordinate -- the one nearest the point --
-- which the finder records with the distance; a proposal from an earlier pass
-- carries none and is shown without a map. The answer is one act of the
-- curation log, component_items_answered, naming every candidate it took and
-- turned down. A candidate is open only while its item is recorded on no
-- point, which the queue asks of every open proposal: an index on the point's
-- item answers it.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: the column and the index are added if absent and the
-- constraint is dropped before it is added.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_component_item_proposals ADD COLUMN IF NOT EXISTS item_location GEOMETRY(Point, 4326);
COMMENT ON COLUMN experience_component_item_proposals.item_location IS 'The coordinate of the item nearest the point, as the finder read it, so the card can show the candidate beside the point; null on a proposal recorded before it was kept.';

CREATE INDEX IF NOT EXISTS idx_experience_locations_wikidata_item
    ON experience_locations(wikidata_item) WHERE wikidata_item IS NOT NULL;

-- The claim on a point's item is a screen's write now.
COMMENT ON COLUMN experience_locations.wikidata_item IS 'The Wikidata item this point is, where one is known: for a World Heritage component, the item whose World Heritage Site ID (P757, any rank but a deprecated-only statement) equals external_ref, recorded by every run; null where no item or more than one carries the reference. A claim on it (''wikidata_item'' in curated_fields) is written when a curator accepts a proposed item on the review queue (#1272), and is never overridden by a run (#1269).';
COMMENT ON COLUMN experience_locations.curated_fields IS 'Column names a curator has claimed on this point: name, location, image_url and description (#1270), and wikidata_item, written when a curator confirms a proposed item on the review queue (#1272) and respected by every run. Never external_ref or ordinal - those are the source''s handle on the row and its place in the source''s list, and a claim on them would break the pairing that decides whether a point moved or was replaced.';

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check
    CHECK (action IN ('created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region', 'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'declined_source', 'declined_held', 'missing_dismissed', 'admission_confirmed', 'admission_overridden', 'published', 'location_marked_former', 'location_marked_lost', 'location_state_restored', 'location_missing_dismissed', 'location_edited', 'work_edited', 'arrival_refused', 'contents_refused', 'contents_unrefused', 'merged', 'merge_undone', 'views_chosen', 'component_items_answered'));

COMMIT;
