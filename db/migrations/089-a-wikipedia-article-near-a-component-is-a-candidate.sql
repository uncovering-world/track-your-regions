-- 089-a-wikipedia-article-near-a-component-is-a-candidate.sql
--
-- The component-item finder asks Wikipedia for the articles near a point no
-- other rule found anything for, in the site's countries' editions and English,
-- and proposes the item of one named like the component (#1339): Aalto's
-- Villa Mairea, 12 m from its point. Its proposals record the rule as
-- 'wikipedia', which the check on the basis did not allow. The table comment
-- names the fourth rule.
--
-- 01-schema.sql declares the same check for a fresh database.
-- Re-runnable: the check is dropped by name and added again.
BEGIN;

ALTER TABLE experience_component_item_proposals
    DROP CONSTRAINT IF EXISTS experience_component_item_proposals_basis_check;
ALTER TABLE experience_component_item_proposals
    ADD CONSTRAINT experience_component_item_proposals_basis_check
    CHECK (basis IN ('part_of', 'near', 'numbered', 'wikipedia'));

COMMENT ON TABLE experience_component_item_proposals IS 'A candidate Wikidata item for a World Heritage component whose reference no item records (#1272), and what the match rests on: the item says it is part of the site (part_of), it lies near the point and is of a class the site''s resolved components are of (near), it carries the component''s number under another variant of the inscription and is named like it (numbered, #1394), or a Wikipedia article near a point no other rule found anything for is about it and named like the component (wikipedia, #1339); the distance, the name similarity and whether the names are the same. A curator answers it on the review queue: accepted records the item on the point as a curator''s choice; refused is kept so the candidate is never proposed again.';

COMMIT;
