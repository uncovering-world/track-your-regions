-- 195-the-tier-that-admitted-a-row-is-its-kinds-fact.sql
--
-- A place kind's regional tier, read from Wikidata by measuring a place
-- against what lies within 50 km of it (ADR-0171, #2178), marks the rows it
-- admits on their membership: `facts.tier = 'regional'`, beside the curator's
-- note with the numbers. A row the world tier admits carries no such key —
-- the Iconic badge marks it (ADR-0045 decision 5). The tier is the kind's own
-- fact (ADR-0153): no other kind's run writes it, and a refused membership
-- keeps it. The check that keeps a kind's facts off the place therefore names
-- the key too. Nothing to move: no row holds it yet.
--
-- Order-independent with 01-schema.sql, which declares the same check.
-- Re-runnable: the check is replaced.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_metadata_holds_no_kind_fact_check;
ALTER TABLE experiences ADD CONSTRAINT experiences_metadata_holds_no_kind_fact_check
    CHECK (NOT (metadata ?| ARRAY['year', 'creators', 'wikidataArtwork', 'wikidataClasses', 'artworkCount',
                                  'totalArtworkSitelinks', 'archaeologyNature', 'wikipediaCategories', 'admissionNote',
                                  'museumReadershipNote', 'worshipReadershipNote', 'publicArtReadershipNote',
                                  'dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary',
                                  'areaHectares', 'tier']));

COMMENT ON COLUMN experience_kind_memberships.facts IS 'The kind''s own facts about the place (year, creators, wikidataClasses, artworkCount, admissionNote, the tier that admitted the row where it is the regional one, a World Heritage Site''s dateInscribed, inDanger, dangerList, criteria, areaHectares, ...), written by the source''s run every pass; one a reader is shown (the inscription year, the danger flag and its listing) waits behind the gate on a held place. No other kind''s run writes them, and a refused membership keeps its own (ADR-0153, ADR-0154, ADR-0171, #1775, #2068, #2178).';

COMMIT;
