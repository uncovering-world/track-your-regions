-- 214-a-rough-points-namesakes-are-asked-of-openstreetmap-from-the-card.sql
--
-- A component the World Heritage list placed only roughly is offered the
-- OpenStreetMap objects within 2 km named like it, read from the local layer.
-- The layer keeps only selected tags, so the Cemetery of Congregation
-- (way 1095868935, landuse=cemetery) is not in it, and the card offered
-- nothing. A curator now asks the full OpenStreetMap from the card, once per
-- point (#2243). The answer is kept here and copied into the point's hints by
-- each pass while the point keeps the name and coordinate it was asked with.
--
-- Re-runnable: the table is created only where it is missing, and the
-- comments are replaced.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS experience_point_name_asks (
    location_id INTEGER PRIMARY KEY REFERENCES experience_locations(id) ON DELETE CASCADE,
    asked_name TEXT NOT NULL,
    asked_location geometry(Point, 4326) NOT NULL,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    asked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    objects JSONB NOT NULL DEFAULT '[]'::jsonb
);
COMMENT ON TABLE experience_point_name_asks IS 'A rough point''s namesakes as the full OpenStreetMap answered when a curator asked from the approximate-point card (#2243): the objects within 2 km named like the component that the layer does not keep (a cemetery mapped as landuse, say), each with its ref, label, coordinate and tags. Asked once per point and kept; it stands for the point only while the point keeps the name and coordinate it was asked with (asked_name, asked_location), and the Find component items pass copies its objects into experience_point_hints as osm-name hints.';

-- The hints' own comments name the new origin.
COMMENT ON TABLE experience_point_hints IS 'Where a component the World Heritage list placed only roughly (experience_locations.approximate) may really stand (#1853): the coordinate of its own Wikidata item (item, ref the item), an OpenStreetMap object carrying its World Heritage reference ref:whc (osm-ref, ref like W194252618), or one within 2 km named like it (osm-name), with its distance from the point in metres. Worked out by the Find component items pass from the subset, the OpenStreetMap layer and the full OpenStreetMap''s answers a curator asked for from the card (experience_point_name_asks, #2243), and replaced per point on each pass, so the curator''s card reads no workbench table (ADR-0124).';
COMMENT ON COLUMN experience_point_hints.tags IS 'An OpenStreetMap hint''s tags as the layer holds them, or as the full OpenStreetMap answered a curator''s question from the card (#2243), which Jev reads to judge whether the object is the component (#1913); null on an item.';

COMMIT;
