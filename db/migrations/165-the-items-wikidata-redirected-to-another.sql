-- 165-the-items-wikidata-redirected-to-another.sql
--
-- The items Wikidata redirected to another, kept from the dump (ADR-0143
-- decision 3, #1895). When two items are merged on Wikidata, one becomes a
-- redirect to the other; a place registered under the old item and a run
-- reading the new one would not meet. The wikidata-redirects keeper reads
-- wikidatawiki's redirect and page tables and keeps every item redirected to
-- another here, whole; a lookup of a place by its item is widened to the items
-- redirected to or from it. Two workbench tables, unlogged like the Wikipedia
-- redirects (migration 126): a reader route never reads them (ADR-0124).
--
-- Re-runnable: both tables are created if absent.

\set ON_ERROR_STOP on

BEGIN;

-- The items Wikidata redirected to another (ADR-0143 decision 3, #1895). See db/migrations/165.
CREATE UNLOGGED TABLE IF NOT EXISTS workbench.wikidata_redirect_builds (
    build_id INTEGER PRIMARY KEY REFERENCES workbench.dump_builds(id),
    dump_date DATE NOT NULL,
    kept INTEGER NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workbench.wikidata_redirect_builds IS 'Each build of the item redirects (ADR-0143 decision 3, #1895) that was swapped in: the dump build that read it, the run''s date and the redirects kept. The newest row is what wikidata_redirects holds; unlogged like it, so a crash empties the record with the table and the panel asks for a build.';

CREATE UNLOGGED TABLE IF NOT EXISTS workbench.wikidata_redirects (
    source TEXT PRIMARY KEY,
    target TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wikidata_redirects_target ON workbench.wikidata_redirects (target);
COMMENT ON TABLE workbench.wikidata_redirects IS 'An item Wikidata redirected to another (ADR-0143 decision 3, #1895): the redirect page''s item and the item it points to, from wikidatawiki''s redirect and page tables of one run. A lookup of a place by its item is widened to the items redirected to or from it (withRedirects in backend/src/db/experienceWriter.ts), so a place registered under an item Wikidata has since merged away is still found. Built whole by the wikidata-redirects keeper; read by the runs and the catalogue checks, never by a reader route.';

COMMIT;
