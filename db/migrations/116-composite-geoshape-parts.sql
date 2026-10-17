-- 116-composite-geoshape-parts.sql
--
-- A composite geoshape is the union of an item's parts' shapes, built when
-- Wikimedia holds none for the item itself (geoshapeComposite.ts). It used to
-- be built from whichever parts had a shape, so Lower Egypt (Q463871), one of
-- whose four parts has a shape, was cached as Cairo and matched as the Delta
-- (#1628). A composite is now built only when every part has a shape, and the
-- cache records how many parts it is the union of (composite_of).
--
-- The rows cached before this migration do not say whether they are a shape
-- Wikimedia holds or a composite, and a composite may have been built for a
-- world view since deleted, so every cached shape is cleared: the next match
-- fetches each again, and builds a composite only under the new rule. The
-- negative cache stays: an item Wikimedia holds no shape for has none still,
-- and a composite never overwrote a row that is still negative. Re-running
-- this file adds nothing and clears what the matches since have cached again,
-- which they rebuild the same way.
--
-- Suggestions already scored against a cleared composite are not touched: a
-- world view keeps them, Lower Egypt offered Cairo at 92 % among them, until it
-- is re-matched. The cleanup reaches the cache, not what was matched from it.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE wikidata_geoshapes
  ADD COLUMN IF NOT EXISTS composite_of INTEGER CHECK (composite_of > 0);

COMMENT ON COLUMN wikidata_geoshapes.composite_of IS 'How many parts a composite geoshape is the union of, every part the item names (#1628); NULL for a shape Wikimedia holds for the item';

DELETE FROM wikidata_geoshapes WHERE NOT not_available;

COMMIT;
