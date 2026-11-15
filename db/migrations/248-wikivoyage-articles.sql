-- 248-wikivoyage-articles.sql
--
-- The Wikivoyage articles that use each item (#2520). The usage build
-- (#1768) already reads every edition's page table to tell a guide's
-- article from a draft, a redirect or a heritage register's list, but kept
-- only (item, site) in workbench.wikivoyage_usage. A curator saw that a guide
-- uses Mantineia's item (Q1160195) in German and Italian Wikivoyage and could
-- not open the articles behind that yes.
--
-- wikivoyage_articles keeps, beside that usage, each guide article that uses
-- an item: its edition, its page id and its title, once per (item, edition,
-- page). It is a sibling table, not columns on wikivoyage_usage, so the usage
-- stays one row per item and edition: the travel-guide witness and the
-- distinct-edition count fame reads do not change, however many articles of
-- one edition use an item.
--
-- Serving (ADR-0124): a curator's read lists the articles, so the table lives
-- in public. It is written only by the usage build, into a _next copy
-- swapped in with wikivoyage_usage in one transaction, and is unlogged like
-- it, so a crash empties both and the panel asks for a build.
--
-- Nothing to backfill here: the titles are in the page tables the next usage
-- build reads. Until that build, the table is empty, and the curator's read
-- says the copy in place was built before the articles were kept.
--
-- Order-independent with 01-schema.sql, which declares the same table.
-- Re-runnable: the table is created where missing.

\set ON_ERROR_STOP on

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS wikivoyage_articles (
    item TEXT NOT NULL CHECK (item ~ '^Q[0-9]+$'),
    site TEXT NOT NULL,
    page_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (item, site, page_id)
);
COMMENT ON TABLE wikivoyage_articles IS 'Each guide article of a Wikivoyage edition that uses a Wikidata item (#2520): the item, the edition''s database name (dewikivoyage), the article''s page id and its title as a reader reads it (spaces, not underscores). Kept by the Wikivoyage usage build beside wikivoyage_usage, from the same page and wbc_entity_usage tables and under the same exclusions (namespace 0, no redirect, no heritage register''s list), and swapped in with it. Empty until the first usage build that keeps articles. A curator''s read lists the articles behind a guide''s yes from here; the witness and fame read wikivoyage_usage.';

COMMIT;
