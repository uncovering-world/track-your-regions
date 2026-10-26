-- 178-a-kind-keeps-its-own-facts.sql
--
-- A field belongs to the place or to one kind, by what it means (ADR-0153,
-- #1775). A monument's year and makers, the classes a kind's rule read, the
-- counts a run makes of a venue's works and the question a run asks a curator
-- are one kind's facts, and lived on the place: every other kind's run of it
-- wrote over them, and they stood after the kind that wrote them refused the
-- place. Charminar kept Monuments & memorials' 1591 under Places of worship.
--
-- Each such fact moves onto the membership of every source that writes it,
-- in a new `facts` column, and leaves the place; a check keeps it off the
-- place from then on. The readership notes three runs kept under keys of
-- their own become the one `admissionNote` Archaeology already uses. A value
-- held by a place no writing source holds a membership of has no owner left
-- and is dropped with the rest; so is a Wikidata blank node among a
-- monument's makers, which names nobody. UNESCO's facts about an inscription
-- stay on the place until their own slice.
--
-- Re-runnable: what was moved is no longer on the place, and the check is
-- replaced.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS facts JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The key on the place, the key on the membership, and the sources whose runs
-- write it (`kindFacts.ts`, and each run's record).
CREATE TEMP TABLE kind_fact_moves (key TEXT, target TEXT, sources INTEGER[]) ON COMMIT DROP;
INSERT INTO kind_fact_moves VALUES
    ('year', 'year', '{3,6,7,8,9}'),
    ('creators', 'creators', '{3,6,7,8,9}'),
    ('wikidataArtwork', 'wikidataArtwork', '{3,6,7,8,9}'),
    ('wikidataClasses', 'wikidataClasses', '{3,4,5,6,7,8,9}'),
    ('artworkCount', 'artworkCount', '{2,4,5}'),
    ('totalArtworkSitelinks', 'totalArtworkSitelinks', '{2,4,5}'),
    ('archaeologyNature', 'archaeologyNature', '{5}'),
    ('wikipediaCategories', 'wikipediaCategories', '{5}'),
    ('admissionNote', 'admissionNote', '{5}'),
    ('museumReadershipNote', 'admissionNote', '{2}'),
    ('worshipReadershipNote', 'admissionNote', '{4}'),
    ('publicArtReadershipNote', 'admissionNote', '{3}');

WITH copied AS (
    SELECT m.id,
           jsonb_object_agg(mv.target, CASE
               WHEN mv.key = 'creators' AND jsonb_typeof(e.metadata -> 'creators') = 'array' THEN (
                   SELECT COALESCE(jsonb_agg(c.maker ORDER BY c.n), '[]'::jsonb)
                     FROM jsonb_array_elements(e.metadata -> 'creators') WITH ORDINALITY AS c(maker, n)
                    WHERE c.maker::text NOT LIKE '%/.well-known/genid/%')
               ELSE e.metadata -> mv.key
           END) AS facts
      FROM experience_kind_memberships m
      JOIN experiences e ON e.id = m.experience_id
      JOIN kind_fact_moves mv ON m.source_id = ANY(mv.sources)
     WHERE e.metadata ? mv.key AND jsonb_typeof(e.metadata -> mv.key) <> 'null'
     GROUP BY m.id
)
UPDATE experience_kind_memberships m
   SET facts = m.facts || copied.facts
  FROM copied
 WHERE copied.id = m.id;

-- Lemnian Athena's `type` and `creator` were written once, by a run that
-- writes neither any more; nothing reads them.
UPDATE experiences
   SET metadata = metadata - ARRAY(SELECT key FROM kind_fact_moves) - 'type' - 'creator'
 WHERE metadata ?| (ARRAY(SELECT key FROM kind_fact_moves) || ARRAY['type', 'creator']);

ALTER TABLE experiences DROP CONSTRAINT IF EXISTS experiences_metadata_holds_no_kind_fact_check;
ALTER TABLE experiences ADD CONSTRAINT experiences_metadata_holds_no_kind_fact_check
    CHECK (NOT (metadata ?| ARRAY['year', 'creators', 'wikidataArtwork', 'wikidataClasses', 'artworkCount',
                                  'totalArtworkSitelinks', 'archaeologyNature', 'wikipediaCategories', 'admissionNote',
                                  'museumReadershipNote', 'worshipReadershipNote', 'publicArtReadershipNote']));

SELECT key, count(*) AS memberships
  FROM experience_kind_memberships, jsonb_object_keys(facts) AS key
 GROUP BY key ORDER BY key;

COMMIT;
