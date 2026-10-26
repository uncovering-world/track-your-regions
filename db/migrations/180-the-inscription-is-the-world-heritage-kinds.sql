-- 180-the-inscription-is-the-world-heritage-kinds.sql
--
-- UNESCO's facts about an inscription are the World Heritage kind's, not the
-- place's (ADR-0153 decision 4, #2068): the year, the danger flag and its
-- listing, the criteria, the region, whether the site is transboundary and
-- its inscribed area. On the place they outlived the membership that brought
-- them, so a delisted site would have kept its danger badge and its
-- inscription year.
--
-- Each one moves onto the place's World Heritage membership, in its `facts`,
-- as the place held it, a null listing included, since the run sends one for
-- a site in no danger and a stored value that differs from what it sends
-- would be a change to ask about. The keys then leave the place, and the
-- check that keeps a kind's facts off the place names them. UNESCO's page
-- about a site (`unescoUrl`) stays the place's (ADR-0138). The near-places
-- pairing pass reads the area off the membership from now on, so the trigger
-- that marks a place for pairing again watches it there.
--
-- Refuses to run while a curator's claim names one of the keys: a claim on a
-- key the place no longer holds would protect nothing, silently.
--
-- Re-runnable: what was moved is no longer on the place, and the check and
-- the triggers are replaced.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experiences
              WHERE curated_fields ?| ARRAY['metadata.dateInscribed', 'metadata.inDanger', 'metadata.dangerList',
                                           'metadata.criteria', 'metadata.region', 'metadata.transboundary',
                                           'metadata.areaHectares']) THEN
    RAISE EXCEPTION 'a curator claims an inscription fact on a place; settle the claim before moving the facts';
  END IF;
END $$;

WITH copied AS (
    SELECT m.id,
           jsonb_object_agg(k.key, e.metadata -> k.key) AS facts
      FROM experience_kind_memberships m
      JOIN experiences e ON e.id = m.experience_id
     CROSS JOIN unnest(ARRAY['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary',
                             'areaHectares']) AS k(key)
     WHERE m.kind_id = 1 AND e.metadata ? k.key
     GROUP BY m.id
)
UPDATE experience_kind_memberships m
   SET facts = m.facts || copied.facts
  FROM copied
 WHERE copied.id = m.id;

UPDATE experiences
   SET metadata = metadata - ARRAY['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary',
                                   'areaHectares']
 WHERE metadata ?| ARRAY['dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary',
                         'areaHectares'];

ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_metadata_holds_no_kind_fact_check;
ALTER TABLE experiences ADD CONSTRAINT experiences_metadata_holds_no_kind_fact_check
    CHECK (NOT (metadata ?| ARRAY['year', 'creators', 'wikidataArtwork', 'wikidataClasses', 'artworkCount',
                                  'totalArtworkSitelinks', 'archaeologyNature', 'wikipediaCategories', 'admissionNote',
                                  'museumReadershipNote', 'worshipReadershipNote', 'publicArtReadershipNote',
                                  'dateInscribed', 'inDanger', 'dangerList', 'criteria', 'region', 'transboundary',
                                  'areaHectares']));

DROP TRIGGER IF EXISTS pairing_due_experience_update ON experiences;
CREATE TRIGGER pairing_due_experience_update AFTER UPDATE ON experiences
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name
                     OR OLD.name_local IS DISTINCT FROM NEW.name_local
                     OR OLD.merged_into_id IS DISTINCT FROM NEW.merged_into_id)
  EXECUTE FUNCTION mark_pairing_due();

DROP TRIGGER IF EXISTS pairing_due_membership_update ON experience_kind_memberships;
CREATE TRIGGER pairing_due_membership_update AFTER UPDATE ON experience_kind_memberships
  FOR EACH ROW WHEN (OLD.experience_id IS DISTINCT FROM NEW.experience_id
                     OR OLD.reported_name IS DISTINCT FROM NEW.reported_name
                     OR OLD.kind_id IS DISTINCT FROM NEW.kind_id
                     OR OLD.admission IS DISTINCT FROM NEW.admission
                     OR OLD.curation_state IS DISTINCT FROM NEW.curation_state
                     OR OLD.facts->'areaHectares' IS DISTINCT FROM NEW.facts->'areaHectares')
  EXECUTE FUNCTION mark_pairing_due();

COMMENT ON COLUMN experience_kind_memberships.facts IS 'The kind''s own facts about the place (year, creators, wikidataClasses, artworkCount, admissionNote, a World Heritage Site''s dateInscribed, inDanger, dangerList, criteria, areaHectares, ...), written by the source''s run every pass; one a reader is shown (the inscription year, the danger flag and its listing) waits behind the gate on a held place. No other kind''s run writes them, and a refused membership keeps its own (ADR-0153, ADR-0154, #1775, #2068).';
COMMENT ON COLUMN experiences.metadata IS 'The place''s own source data (website, Wikipedia article, picture credit, UNESCO page); a kind''s facts are on its membership (ADR-0153)';

SELECT count(*) FILTER (WHERE facts ? 'dateInscribed') AS with_year,
       count(*) FILTER (WHERE facts ? 'inDanger') AS with_flag,
       count(*) FILTER (WHERE facts->'inDanger' = 'true'::jsonb) AS in_danger,
       count(*) FILTER (WHERE facts ? 'areaHectares') AS with_area
  FROM experience_kind_memberships
 WHERE kind_id = 1;

COMMIT;
