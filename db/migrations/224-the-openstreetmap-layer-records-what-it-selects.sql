-- 224-the-openstreetmap-layer-records-what-it-selects.sql
--
-- Each build of the OpenStreetMap layer records the selection it kept objects
-- by (#2311, ADR-0191), as migration 149 made it record the rule it drew by.
-- The layer now keeps every food-and-drink venue, and a reader of venues can
-- tell a build that holds them from one cut before: a build whose selection
-- does not name the venue values is not read for them, never read as a map
-- with no cafe. NULL is a layer cut before ADR-0191.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE workbench.osm_layer_builds ADD COLUMN IF NOT EXISTS selection TEXT[];
COMMENT ON COLUMN workbench.osm_layer_builds.selection IS 'The selection the build kept objects by (LAYER_SELECTION, ADR-0191): one osmium tags-filter expression per key, such as amenity=place_of_worship,cafe,restaurant. A reader of a tag the build did not select treats the layer as not read for it. NULL is a layer cut before ADR-0191, which kept no venue it did not select for another tag.';

COMMIT;
