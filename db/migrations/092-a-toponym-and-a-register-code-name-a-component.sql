-- 092-a-toponym-and-a-register-code-name-a-component.sql
--
-- The component-item finder proposes a candidate of the site's kind whose
-- label holds a place name from the component's own name as a whole word
-- (#1340): the castra of Roman Dacia are labelled "Castrul roman de la
-- Gresia" against the point "Gresia - La Biserică", which the name
-- similarity scores 0.21. Its proposals record the rule as 'toponym', which
-- the check on the basis did not allow.
--
-- A candidate's national register code (Romania's LMI, Switzerland's KGS,
-- Finland's RKY) is kept on the proposal as the card shows it, and whether
-- the code's group disagrees with the one the site's other coded candidates
-- carry: an architecture entry (LMI group II) offered for a Roman fort sorts
-- below the archaeology entries (group I).
--
-- 01-schema.sql declares the same check and columns for a fresh database.
-- Re-runnable: the check is dropped by name and added again, and the columns
-- are added only where they are missing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_component_item_proposals
    DROP CONSTRAINT IF EXISTS experience_component_item_proposals_basis_check;
ALTER TABLE experience_component_item_proposals
    ADD CONSTRAINT experience_component_item_proposals_basis_check
    CHECK (basis IN ('part_of', 'near', 'numbered', 'toponym'));

ALTER TABLE experience_component_item_proposals ADD COLUMN IF NOT EXISTS register_code TEXT;
ALTER TABLE experience_component_item_proposals
    ADD COLUMN IF NOT EXISTS register_disagrees BOOLEAN NOT NULL DEFAULT false;

COMMENT ON TABLE experience_component_item_proposals IS 'A candidate Wikidata item for a World Heritage component whose reference no item records (#1272), and what the match rests on: the item says it is part of the site (part_of), it lies near the point and is of a class the site''s resolved components are of (near), it carries the component''s number under another variant of the inscription and is named like it (numbered, #1394), or it is of the site''s kind near the point and its label holds a place name from the component''s name as a whole word (toponym, #1340); the distance, the name similarity and whether the names are the same. A curator answers it on the review queue: accepted records the item on the point as a curator''s choice; refused is kept so the candidate is never proposed again.';
COMMENT ON COLUMN experience_component_item_proposals.register_code IS 'The candidate''s national register code as the card shows it, the register named first ("LMI CJ-I-s-A-07208"); null where the item carries none the finder reads (#1340).';
COMMENT ON COLUMN experience_component_item_proposals.register_disagrees IS 'Whether the code''s group differs from the group most of the site''s coded candidates carry: an architecture entry offered for a Roman fort. Such a candidate sorts below the ones that agree (#1340).';

COMMIT;
