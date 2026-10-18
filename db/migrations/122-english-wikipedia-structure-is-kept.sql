-- 122-english-wikipedia-structure-is-kept.sql
--
-- English Wikipedia's structure on the dump pipeline (#1440, ADR-0121): its
-- articles and categories, each article's Wikidata item, and which category
-- each article and category is filed under, read from the enwiki SQL dumps of
-- one date (page, page_props, linktarget, categorylinks). Every table is
-- unlogged: each is rebuilt from its dump, a build writes copies beside them
-- and swaps them in whole, and the record of the build is emptied by a crash
-- with them.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_structure_builds (
    build_id INTEGER PRIMARY KEY REFERENCES dump_builds(id),
    dump_date DATE NOT NULL,
    counts JSONB NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE enwiki_structure_builds IS 'Each build of English Wikipedia''s structure that was swapped in (#1440, ADR-0121): the dump build that read it, the dump date its four tables share, and what it kept. The newest row is what the enwiki_* tables hold; unlogged like them, so a crash empties the record with the tables and the panel asks for a build.';

CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_pages (
    id INTEGER PRIMARY KEY,
    namespace SMALLINT NOT NULL CHECK (namespace IN (0, 14)),
    title TEXT NOT NULL,
    UNIQUE (namespace, title)
);
COMMENT ON TABLE enwiki_pages IS 'English Wikipedia''s articles (namespace 0) and categories (14) that are no redirect (#1440, ADR-0121), by page id, the title as the dump writes it, with underscores for spaces.';

CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_page_items (
    page INTEGER PRIMARY KEY,
    item TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enwiki_page_items_item ON enwiki_page_items (item);
COMMENT ON TABLE enwiki_page_items IS 'The Wikidata item of each article and category kept (#1440): page_props'' wikibase_item.';

CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_categories (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL UNIQUE
);
COMMENT ON TABLE enwiki_categories IS 'The categories pages are filed under that are not hidden (#1440, ADR-0121): the linktarget id the category links name and the category''s title, with underscores, without its Category: prefix. A hidden category (__HIDDENCAT__, a maintenance or tracking one) is not kept, nor any link to it.';

CREATE UNLOGGED TABLE IF NOT EXISTS enwiki_category_links (
    page INTEGER NOT NULL,
    category INTEGER NOT NULL,
    subcat BOOLEAN NOT NULL,
    PRIMARY KEY (page, category)
);
CREATE INDEX IF NOT EXISTS idx_enwiki_category_links_category ON enwiki_category_links (category, subcat);
COMMENT ON TABLE enwiki_category_links IS 'Which category each article or category is filed under (#1440, ADR-0121): the filed page''s id (an enwiki_pages row), the category''s linktarget id (an enwiki_categories row), and whether the filed page is itself a category (a subcategory), as categorymembers'' cmtype tells them.';

COMMIT;
