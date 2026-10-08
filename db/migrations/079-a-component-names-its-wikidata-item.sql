-- 079-a-component-names-its-wikidata-item.sql
--
-- A component of a serial World Heritage site is a point with a name, a
-- coordinate and its UNESCO reference (external_ref, such as 1363-061).
-- Wikidata records many components as items of their own, carrying that
-- reference as their World Heritage Site ID (P757). The World Heritage run
-- now records the item on the point (#1269): the item a point's own picture,
-- description and card are read from, and how a component is recognised as
-- the same place as another kind's row. A claim on the point's item
-- ('wikidata_item' in curated_fields) is never overridden; no screen writes one
-- yet, and the run leaves room for it.
--
-- The run's own record says how many components of each site resolved and
-- which references were ambiguous (experience_sync_logs.component_items).
--
-- Order-independent with 01-schema.sql, which declares the same columns.
-- Re-runnable: each column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS wikidata_item VARCHAR(20);

-- What the run's resolution came to, read where an admin reads the run.
ALTER TABLE experience_sync_logs ADD COLUMN IF NOT EXISTS component_items JSONB;

COMMIT;
