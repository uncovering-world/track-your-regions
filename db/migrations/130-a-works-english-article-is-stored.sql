-- 130-a-works-english-article-is-stored.sql
--
-- A notable work's row on a card links its Wikipedia article through
-- Wikidata's redirect (#1191), and nothing about the article was stored on the
-- work. When the item has no English article the redirect answers with
-- Wikidata's own "no page found" form: on the development catalogue on
-- 2026-10-16, 13 of the 1,598 works a place shows, the stele of Lemnos
-- (Q3501422) among them (#1608).
--
-- The works runs now record each work's English article, the way the place
-- runs record `metadata.wikipediaUrl`. Two columns, because three states have
-- to be told apart: an article (`wikipedia_url` set), none (`wikipedia_read_at`
-- set and no URL), and not yet asked (`wikipedia_read_at` NULL: a work a
-- curator created, or one no run has written since this migration), which
-- keeps the redirect link. A measurement like `sitelinks_count`: no curator
-- claims it and no gate holds it.
--
-- Re-runnable: each column is made only where missing.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE treasures ADD COLUMN IF NOT EXISTS wikipedia_url VARCHAR(1000);
ALTER TABLE treasures ADD COLUMN IF NOT EXISTS wikipedia_read_at TIMESTAMPTZ;

COMMENT ON COLUMN treasures.wikipedia_url IS
    'The work''s English Wikipedia article, as the last works run read it (#1608); NULL with wikipedia_read_at set means none';
COMMENT ON COLUMN treasures.wikipedia_read_at IS
    'When a works run last read the English article (#1608); NULL means never, and the card keeps the redirect link';

COMMIT;
