-- 225-the-openstreetmap-layer-keeps-the-lines-of-streets.sql
--
-- The OpenStreetMap layer keeps whole the lines of Squares & streets'
-- candidates (#2311, ADR-0194): a highway or a place way whose wikidata tag is
-- one of them, or whose name is one of theirs near its point. Each such row
-- names the item it is the line of, so a street is read along its length,
-- and each build records how many items it looked for and how many it found
-- a line for. NULL on a build is a layer cut before ADR-0194, which kept no
-- street's line: a reader then reads a street at its point.
--
-- Order-independent with 01-schema.sql, which declares the same columns.
-- Re-runnable: each column and the index are added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE workbench.osm_objects ADD COLUMN IF NOT EXISTS street_item TEXT;
CREATE INDEX IF NOT EXISTS osm_objects_street_item ON workbench.osm_objects (street_item) WHERE street_item IS NOT NULL;
COMMENT ON COLUMN workbench.osm_objects.street_item IS 'The Squares & streets item this highway or place way is the line of (ADR-0194): its wikidata tag, or the item one of its names belongs to within 1 km of the item''s point. Such a way keeps its whole line. NULL for every other object.';

ALTER TABLE workbench.osm_layer_builds ADD COLUMN IF NOT EXISTS streets INTEGER;
ALTER TABLE workbench.osm_layer_builds ADD COLUMN IF NOT EXISTS streets_lined INTEGER;
COMMENT ON COLUMN workbench.osm_layer_builds.streets IS 'How many of Squares & streets'' candidates the build looked for the lines of (ADR-0194). NULL is a layer cut before ADR-0194, which kept no street''s line.';
COMMENT ON COLUMN workbench.osm_layer_builds.streets_lined IS 'How many of those candidates the build kept at least one line for (ADR-0194). NULL is a layer cut before ADR-0194.';

COMMIT;
