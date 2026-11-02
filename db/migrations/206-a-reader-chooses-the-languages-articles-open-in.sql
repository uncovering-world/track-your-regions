-- 206-a-reader-chooses-the-languages-articles-open-in.sql
--
-- A place's, a part's and a work's Wikipedia link opened the English article
-- although the item behind it is written about in about 27 editions, which
-- the catalogue keeps since migration 199 (wikipedia_editions). A signed-in
-- visitor now sets an ordered list of reading languages on the account page,
-- beside the maps app, and a link opens the article in the first of them the
-- item has (#2209). No list, NULL, reads the browser's languages, as a visitor
-- who is not signed in does.
--
-- The codes are Wikipedia's language codes (ru, de, zh-classical), first
-- choice first, at most ten: READING_LANGUAGE and MAX_READING_LANGUAGES in
-- packages/shared/src/preferences.ts, which the request schema holds them to.
--
-- Re-runnable: the column is added only where missing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS reading_languages TEXT[];

COMMENT ON COLUMN users.reading_languages IS
    'The Wikipedia languages the visitor reads, first choice first (#2209): an article opens in the first of them its item has, then English; NULL reads the browser''s languages';

COMMIT;
