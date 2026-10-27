-- 184-wikivoyage-pages-from-the-dump.sql
--
-- English Wikivoyage's articles, kept from its dump (#2089): what the
-- world-view extraction reads a region's page from. It read the pages
-- through the live Action API, and two runs a few days apart read
-- different text, so the same tree could not be built twice. A build reads
-- the run's pages-articles file and the same run's page_props table, and
-- keeps every page of namespace 0, an article with its wikitext or a
-- redirect with its target, and the Wikidata item its page properties name,
-- swapped in whole like every table kept from a dump.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS workbench.wikivoyage_pages_builds (
    build_id INTEGER PRIMARY KEY REFERENCES workbench.dump_builds(id),
    dump_date DATE NOT NULL,
    articles INTEGER NOT NULL,
    redirects INTEGER NOT NULL,
    items INTEGER NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workbench.wikivoyage_pages_builds IS 'Each build of English Wikivoyage''s pages (#2089) that was swapped in: the dump build that read it, the dump date of the run, and how many articles, redirects and pages with a Wikidata item it kept. The newest row is what wikivoyage_pages holds and the date a world-view extraction records; unlogged like it, so a crash empties the record with the table and the panel asks for a build.';

CREATE UNLOGGED TABLE IF NOT EXISTS workbench.wikivoyage_pages (
    title TEXT PRIMARY KEY,
    page_id INTEGER NOT NULL,
    redirect_to TEXT,
    wikitext TEXT NOT NULL,
    wikidata_id TEXT CHECK (wikidata_id ~ '^Q[0-9]+$')
);
COMMENT ON TABLE workbench.wikivoyage_pages IS 'A page of English Wikivoyage''s namespace 0 (#2089), from the run''s pages-articles dump: its title as the wiki writes it, its page id, the title it redirects to (null for an article, the target''s section dropped), its wikitext, and the Wikidata item its page properties name. The world-view extraction reads a region''s page, its Regions section and whether a linked page exists from here, so two extractions of one copy build the same tree.';

COMMIT;
