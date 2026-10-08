-- 081-a-point-carries-its-own-picture-and-description.sql
--
-- A point of a serial World Heritage site showed the site's photograph,
-- because a point had no picture of its own: twelve pile dwellings on one
-- lake, one picture between them. Once a point records its Wikidata item
-- (#1269), the item's picture (P18) and its English description are the
-- point's own (#1270). The picture's credit sits in metadata.imageCredit,
-- as it does on experiences and treasures, since a hosted picture carries a
-- credit (ADR-0043).
--
-- Order-independent with 01-schema.sql, which declares the same columns.
-- Re-runnable: each column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
