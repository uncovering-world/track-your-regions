-- 120-readership-is-kept-by-month.sql
--
-- Readership on the dump pipeline (#1436, ADR-0055): each month of the
-- pageview_complete user file summed per article and kept per Wikidata item
-- and edition, with the file each month came from and its editions' totals.
-- All three tables are unlogged: every row is rebuilt from its dump, and the
-- record of which months are kept is emptied by a crash with the months
-- themselves, so the next build reads the year again rather than skipping
-- months it no longer holds.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS readership_month_files (
    month DATE PRIMARY KEY CHECK (EXTRACT(DAY FROM month) = 1),
    file_name TEXT NOT NULL,
    build_id INTEGER NOT NULL REFERENCES dump_builds(id),
    lines BIGINT NOT NULL,
    editions JSONB NOT NULL,
    kept BIGINT NOT NULL,
    built_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE readership_month_files IS 'Each month of readership kept (#1436): the pageview file it was read from, the build that read it, its lines, every Wikipedia edition''s total views that month (editions, by sitelink site code: the denominator a door divides by, and what says which editions ADR-0055 counts, those over 15M views a year) and the rows kept.';

CREATE UNLOGGED TABLE IF NOT EXISTS readership_months (
    month DATE NOT NULL,
    item TEXT NOT NULL,
    site TEXT NOT NULL,
    views INTEGER NOT NULL CHECK (views >= 0),
    mobile INTEGER NOT NULL CHECK (mobile >= 0 AND mobile <= views),
    daily INTEGER[],
    PRIMARY KEY (item, site, month)
);
CREATE INDEX IF NOT EXISTS idx_readership_months_month ON readership_months (month);
COMMENT ON TABLE readership_months IS 'A month''s views of a Wikidata item''s article in one Wikipedia edition (ADR-0055, #1436): the article''s title in all three of the dump''s spellings and every access method summed; mobile is the views on a phone (mobile web and app), for the automated-traffic check; daily is the month''s series, kept where its plain spelling reaches 400 views. A title is staged where its plain spelling reaches 10 views in the month, every encoded spelling always, and kept where they sum to 10.';

CREATE UNLOGGED TABLE IF NOT EXISTS readership_staging (
    build_id INTEGER NOT NULL,
    site TEXT NOT NULL,
    title TEXT NOT NULL,
    views INTEGER NOT NULL,
    mobile INTEGER NOT NULL,
    daily INTEGER[]
);
COMMENT ON TABLE readership_staging IS 'A month being read (#1436): its titles over the floor, staged by the build that reads it, summed and joined to items once the file is verified, then cleared.';

COMMIT;
