-- 158-where-an-approximate-point-may-stand.sql
--
-- Where a component the World Heritage list placed only roughly may really
-- stand (#1853): the hints the curator's card draws beside the list's point.
-- The Find component items pass works them out from the Wikidata subset and
-- the OpenStreetMap layer, and the card reads them from a serving table, since
-- no curator route reads a workbench table (ADR-0124).
--
-- The OpenStreetMap object that carries a component's own reference (ref:whc,
-- Saint Gayane church's 1011-002) is found by it at any distance: the Longmen
-- Grottoes stand 10 km from the list's point. The layer is a large table and a
-- scan per component is too slow, so the objects carrying a reference are
-- indexed by it. A layer build copies the live table's indexes onto the table
-- it swaps in (layerTables.ts), so the index survives the next build. Building
-- it reads the layer once.
--
-- Re-runnable: both are created only where missing.

\set ON_ERROR_STOP on

CREATE INDEX IF NOT EXISTS osm_objects_ref_whc ON workbench.osm_objects ((tags->>'ref:whc')) WHERE tags ? 'ref:whc';

BEGIN;

-- Where a component the World Heritage list placed only roughly may stand
-- (#1853), worked out by the Find component items pass from the subset and the
-- OpenStreetMap layer, which no curator route reads (ADR-0124): the coordinate
-- of the component's own Wikidata item (item), an OpenStreetMap object carrying
-- its World Heritage reference (osm-ref), or one within 2 km named like it
-- (osm-name), each with its distance from the point. Replaced per point by
-- each pass. See db/migrations/158.
CREATE TABLE IF NOT EXISTS experience_point_hints (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
    source VARCHAR(10) NOT NULL CHECK (source IN ('item', 'osm-ref', 'osm-name')),
    ref TEXT NOT NULL,
    label TEXT,
    location geometry(Point, 4326) NOT NULL,
    metres INTEGER NOT NULL,
    found_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experience_point_hints_location ON experience_point_hints(location_id);
COMMENT ON TABLE experience_point_hints IS 'Where a component the World Heritage list placed only roughly (experience_locations.approximate) may really stand (#1853): the coordinate of its own Wikidata item (item, ref the item), an OpenStreetMap object carrying its World Heritage reference ref:whc (osm-ref, ref like W194252618), or one within 2 km named like it (osm-name), with its distance from the point in metres. Worked out by the Find component items pass from the subset and the OpenStreetMap layer and replaced per point on each pass, so the curator''s card reads no workbench table (ADR-0124).';

COMMIT;
