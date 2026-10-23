-- 156-the-catalogue-accepts-an-exact-component-candidate.sql
--
-- An exact component candidate that nothing contradicts is accepted by the
-- catalogue, with no curator named (#1839, ADR-0141): the point's own name
-- within 50 m, the point's only exact candidate, for an item proposed for no
-- other point of the site, with no register disagreeing and no curator's
-- answer. The acceptance is written to the site's curation history as
-- 'component_items_answered' with no curator, as a catalogue merge is
-- ('merged', ADR-0086), so the history's curator check admits that action too.
--
-- The candidates already held are accepted by the next "Find component items"
-- pass from the admin panel, not here: an acceptance gives the point the
-- item's picture and description, read from Wikidata and Commons, which a
-- migration cannot read. On the development catalogue on 2026-10-23 that pass
-- has 151 such candidates to accept.
--
-- Re-runnable: the column is added if missing, the constraint dropped and
-- added again.

\set ON_ERROR_STOP on

BEGIN;

-- The proposal says so itself: answered_by is null for the catalogue and for a
-- curator since deleted alike, and the figures about curators' answers (AI
-- Settings' agreement with Jev) leave the catalogue's out.
ALTER TABLE experience_component_item_proposals
    ADD COLUMN IF NOT EXISTS answered_by_catalogue BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN experience_component_item_proposals.answered_by_catalogue IS 'Whether the catalogue accepted this candidate by its rule rather than a curator (#1839, ADR-0141): the point''s own name within 50 m, nothing contradicting it. answered_by is null then, as it is for a curator since deleted, so the figures about curators'' answers read this instead.';

ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_curator_check;
ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_curator_check
    CHECK (curator_id IS NOT NULL OR action IN ('merged', 'component_items_answered'));

COMMIT;
