-- 199-the-catalogue-keeps-every-wikipedia-edition.sql
--
-- A place's and a work's Wikipedia link opens the English article, while the
-- item behind it links articles in about 27 editions on average (122,977 for
-- 4,468 places on the development catalogue, 2026-11-01). A reader who reads
-- another language looks for the language link by hand (#2209). The editions
-- exist only in the local Wikidata subset, which no reader route may read
-- (ADR-0124), so a serving table keeps them: one row per item and edition.
--
-- The table arrives empty. The end of the next real run of any source fills
-- it from the subset (refreshWikipediaEditions); until then every link opens
-- the English article, as it does today.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

-- Every Wikipedia edition's article about the items the catalogue's places and
-- works link (#2209): what a reader's languages choose among. Serving (ADR-0124):
-- a precomputed copy of the local Wikidata subset's sitelinks, which no reader
-- route may read, written at the end of every run by refreshWikipediaEditions().
CREATE TABLE IF NOT EXISTS wikipedia_editions (
    item TEXT NOT NULL,
    wiki TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (item, wiki)
);
CREATE INDEX IF NOT EXISTS idx_wikipedia_editions_title ON wikipedia_editions (wiki, title);
COMMENT ON TABLE wikipedia_editions IS 'Every Wikipedia edition''s article about each item whose English article a place, a part or a work links (#2209): the item (QID), the edition (enwiki, ruwiki, ...) and its title as the edition writes it. A place''s article is found by its English title (wiki = ''enwiki''), and the item''s other rows are its other languages. Replaced at the end of every real run from the local Wikidata subset (refreshWikipediaEditions, backend/src/services/sync/wikipediaEditions.ts); left as it is where the subset holds no sitelinks.';

COMMIT;
