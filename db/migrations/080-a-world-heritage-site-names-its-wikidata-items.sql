-- 080-a-world-heritage-site-names-its-wikidata-items.sql
--
-- A World Heritage membership knows its place by the site's UNESCO id, and
-- Wikidata states that id on the item or items of the property (P757). The
-- World Heritage run now records them on the membership (#1248), so the
-- catalogue's own merge of places on one Wikidata item reaches World
-- Heritage sites too: a site of one point whose id resolves to exactly one
-- item is that item's place. A Wikidata source knows its places by the item
-- already and records none here.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_kind_memberships ADD COLUMN IF NOT EXISTS wikidata_items TEXT[];

COMMIT;
