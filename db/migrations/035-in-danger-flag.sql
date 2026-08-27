-- Give 58 danger-listed sites back the badge none of them has ever shown.
--
-- The catalogue states one fact about a World Heritage site in danger twice: as
-- the in_danger tag, and as the metadata.inDanger flag every "In Danger" surface
-- keys on. The import wrote the tag from either of UNESCO's two fields and the
-- flag from the boolean alone, and compared that boolean against the number 1
-- while the portal sends the string "True". So the tag is right on 58 of 1272
-- rows and the flag is false on all 1272, and the Ancient City of Aleppo has sat
-- in the catalogue since 2013 with nothing on its card saying so.
--
-- The reading was widened on 2026-08-21 and both writers now ask one predicate
-- (#600), so a run imports these sites correctly from here. That does not repair
-- what is stored, and on a gated source it cannot: UNESCO has requires_curation
-- set on this database, inDanger is not one of the keys a run owns outright, and
-- the hold refuses to overwrite a row a reader can already see. The 58 flips
-- would land in a curator's queue as 58 major changes to answer for -- and they
-- are not the source changing its mind, they are this catalogue misreading a
-- field for four years. A person adjudicating our own import bug 58 times is the
-- wrong ask, and until they finished, every reader would still see no badge.
--
-- So it is repaired here, the way the folded GADM rows were (034) and the false
-- withdrawals before them (026): the code stops writing it wrong, and a migration
-- puts right what the old code wrote.
--
-- Keyed on the tag rather than on UNESCO's own field, so the statement this file
-- makes is about two columns of one catalogue rather than about a vocabulary
-- somebody else owns: the tag is the half the bug left correct, and it is what
-- the standing check in Catalogue Checks compares the flag against from now on.
-- They agree on every row today -- 58 tagged, 58 with a dated listing, and 58
-- flagged "True" in whc001 itself, measured on 2026-08-27 -- and the query at the
-- end reports any row where they do not, rather than repairing something whose
-- shape nobody has seen.
--
-- Nothing else about the row is touched. dangerList is stored as the source sent
-- it ("Y 2013") and is what puts the year under the badge; the flag is the only
-- thing that was wrong.
--
-- The curator's queue is not touched either, and that is deliberate. Where a run has
-- already proposed this flag and a gate is holding it -- all 58 rows on the database this
-- was authored against -- the card stays and still reads false -> true, because a
-- changeset records what a run did and rewriting that record to match what it should
-- have done leaves nothing able to explain a verdict sitting beside it (ADR-0026, the
-- same reason 026 gives). Publishing it later writes the value this file already wrote,
-- so the two cannot disagree; and the rest of that card -- the criteria string and the
-- criterion tags, missing from every site for four years -- is a real change still
-- waiting, which is why the card is there at all.
--
-- Order: a repair of data rather than a change of shape, so 01-schema.sql carries
-- nothing from it and this may run before or after the next re-application of the
-- schema file, in either order and any number of times. A second application
-- finds nothing left to repair.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/035-in-danger-flag.sql

\set ON_ERROR_STOP on

BEGIN;

DO $repair$
DECLARE
  repaired INT;
BEGIN
  WITH fixed AS (
    UPDATE experiences e
       SET metadata = jsonb_set(COALESCE(e.metadata, '{}'::jsonb), '{inDanger}', 'true'::jsonb)
     WHERE e.tags ? 'in_danger'
       AND COALESCE(e.metadata->'inDanger', 'false'::jsonb) <> 'true'::jsonb
    RETURNING e.id
  )
  SELECT count(*) INTO repaired FROM fixed;

  RAISE NOTICE 'Flagged % site(s) the catalogue already tagged as in danger', repaired;
END;
$repair$;

-- What should be left afterwards: nothing. A row here means the two statements
-- of one fact disagree in a shape this file did not repair -- a flag set on a
-- site nothing tags, which is either a curator's hand or a source that has taken
-- the site off the list without the tag following -- and the standing assertion
-- "A site whose danger tag and whose In Danger badge disagree" watches for it from
-- the admin panel, in that direction and in this file's own.
--
-- Both sides coalesced, for a reason the repair above does not have: tags is nullable and
-- a curator's hand-made object is written with NULL, NULL ? 'in_danger' is NULL, and
-- NULL <> FALSE is neither true nor false -- so an uncoalesced test would drop the very
-- row it is looking for. The UPDATE needs no such guard: an untagged row is not one this
-- file repairs.
SELECT e.id,
       e.name,
       COALESCE(e.tags ? 'in_danger', FALSE) AS tagged,
       e.metadata->'inDanger' AS flag,
       e.metadata->>'dangerList' AS listing
  FROM experiences e
 WHERE COALESCE(e.tags ? 'in_danger', FALSE)
       <> COALESCE(e.metadata->'inDanger' = 'true'::jsonb, FALSE)
 ORDER BY e.id;

COMMIT;
