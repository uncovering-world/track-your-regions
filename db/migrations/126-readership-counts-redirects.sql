-- 126-readership-counts-redirects.sql
--
-- Readership counts an article's redirects under the article (#1650, ADR-0055
-- decision 2). Readers keep arriving through a renamed article's old titles,
-- and Wanderer Above the Sea of Fog is read 3,738 times a year under its title
-- and 388,094 under its redirect Wanderer above the Sea of Fog, one capital
-- letter apart. The redirects of the
-- Wikipedia editions a door counts are read from each edition's redirect and
-- page tables into wikipedia_redirects, swapped in whole like every table
-- kept from a dump, and a month records the redirects' dump date it was
-- folded with.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS wikipedia_redirect_builds (
    build_id INTEGER PRIMARY KEY REFERENCES dump_builds(id),
    dump_date DATE NOT NULL,
    editions JSONB NOT NULL,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE wikipedia_redirect_builds IS 'Each build of the redirects readership folds (#1650, ADR-0055 decision 2) that was swapped in: the dump build that read it, the dump date every edition''s tables share, and the redirects kept per edition by its sitelink site code. The newest row is what wikipedia_redirects holds; unlogged like it, so a crash empties the record with the table and the panel asks for a build.';

CREATE UNLOGGED TABLE IF NOT EXISTS wikipedia_redirects (
    site TEXT NOT NULL,
    title TEXT NOT NULL,
    target TEXT NOT NULL,
    PRIMARY KEY (site, title)
);
COMMENT ON TABLE wikipedia_redirects IS 'An article''s redirects in the Wikipedia editions a door counts (#1650, ADR-0055 decision 2: over 15 million views a year): a redirect in namespace 0 by its title, and the title of the article it points to, both with spaces as Wikidata''s sitelinks write them. Kept only where the target is a sitelink of the local subset and the redirect is no item''s own sitelink, so a month''s views of the redirect are summed under that article''s item.';

ALTER TABLE readership_month_files ADD COLUMN IF NOT EXISTS redirects_dump_date DATE;
ALTER TABLE readership_month_files ADD COLUMN IF NOT EXISTS redirects_build_id INTEGER;
COMMENT ON COLUMN readership_month_files.redirects_dump_date IS 'The dump date of the redirects the month was folded with (#1650), or null where no redirects were in place when it was kept.';
COMMENT ON COLUMN readership_month_files.redirects_build_id IS 'The build of the redirects the month was folded with (#1650): a build reads again a month folded with another, since one dump date can be built twice over a changed subset.';

COMMENT ON TABLE readership_months IS 'A month''s views of a Wikidata item''s article in one Wikipedia edition (ADR-0055, #1436): the article''s title and its redirects (#1650), in all three of the dump''s spellings and every access method, summed; mobile is the views on a phone (mobile web and app), for the automated-traffic check; daily is the month''s series, summed day by day over the titles whose plain spelling reaches 400 views. A title is staged where its plain spelling reaches 10 views in the month, every encoded spelling always, and kept where they sum to 10.';

COMMIT;
