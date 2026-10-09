-- 082-a-component-is-proposed-its-wikidata-item.sql
--
-- A component of a serial World Heritage site whose reference no Wikidata item
-- records (#1269) may still have an item: a fort, a burial mound, a stretch of
-- canal described without the UNESCO number. A match by place and name is a
-- proposal for a curator, never a fact (ADR-0046, #1272): one row per point and
-- candidate item, with what the match rests on — whether the item says it is
-- part of the site or lies near the point, the distance, the name similarity,
-- whether the names are the same — and, once answered, the answer.
-- A refused candidate stays, so it is never proposed again; an accepted one
-- records the item on the point as a curator's choice.
--
-- Order-independent with 01-schema.sql, which declares the same table.
-- Re-runnable: the table and its index are created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_component_item_proposals (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    wikidata_item VARCHAR(20) NOT NULL,
    item_label TEXT NOT NULL,
    distance_m INTEGER NOT NULL,
    name_similarity REAL NOT NULL,
    exact BOOLEAN NOT NULL DEFAULT false,
    basis VARCHAR(10) NOT NULL CHECK (basis IN ('part_of', 'near')),
    proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answer VARCHAR(10) CHECK (answer IN ('accepted', 'refused')),
    answered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    answered_at TIMESTAMPTZ,
    UNIQUE (location_id, wikidata_item)
);
CREATE INDEX IF NOT EXISTS idx_component_item_proposals_open
    ON experience_component_item_proposals(location_id) WHERE answer IS NULL;

COMMIT;
