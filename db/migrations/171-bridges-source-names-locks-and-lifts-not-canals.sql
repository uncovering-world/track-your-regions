-- 171-bridges-source-names-locks-and-lifts-not-canals.sql
--
-- Bridges & engineering marvels no longer offers a canal as one point (#1947):
-- a canal waits for a model of long objects (#1948), and a canal's locks, flights,
-- boat lifts and inclined planes are the kind's instead. The source's description,
-- which a reader is served as the source's own words (`source_description`), named
-- canals; it names locks and lifts now. db/init/01-schema.sql seeds the same text.
--
-- Re-runnable: it sets the one row's description.

\set ON_ERROR_STOP on

BEGIN;

UPDATE experience_sources
   SET description = 'Bridges, aqueducts, dams, tunnels and a canal''s locks and lifts a traveller goes to or through, worldwide, sourced from Wikidata'
 WHERE id = 8;

COMMIT;
