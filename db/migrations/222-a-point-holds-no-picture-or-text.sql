-- 222-a-point-holds-no-picture-or-text.sql
--
-- A point holds no picture, credit, description or article of its own
-- (#2117). A serial site's part holds them on its own row (ADR-0156
-- decision 3), and a point of any other place shows its place's. The
-- point's image_url, description and metadata were left from the time a
-- component was a point: on the development catalogue on 2026-11-09 none
-- of its 24,263 points held a value in any of them, and no point held a
-- curator's claim on its picture or its text. The claims are taken off with
-- the columns, so a claim never names a column that is gone.
--
-- Re-runnable: each column is dropped if present.

\set ON_ERROR_STOP on

BEGIN;

UPDATE experience_locations
   SET curated_fields = curated_fields - 'image_url' - 'description' - 'metadata.wikipediaUrl'
 WHERE curated_fields ?| ARRAY['image_url', 'description', 'metadata.wikipediaUrl'];

ALTER TABLE experience_locations DROP COLUMN IF EXISTS image_url;
ALTER TABLE experience_locations DROP COLUMN IF EXISTS description;
ALTER TABLE experience_locations DROP COLUMN IF EXISTS metadata;

COMMENT ON COLUMN experience_locations.curated_fields IS 'Column names a curator has claimed on this point: name, location, and wikidata_item, written when a curator confirms a proposed item on the review queue (#1272) and respected by every run. Never external_ref or ordinal — those are the source''s handle on the row and its place in the source''s list, and a claim on them would break the pairing that decides whether a point moved or was replaced.';

COMMIT;
