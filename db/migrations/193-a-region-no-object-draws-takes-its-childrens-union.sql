-- 193-a-region-no-object-draws-takes-its-childrens-union.sql
--
-- A region whose item no OpenStreetMap relation or way draws, such as the
-- Middle East, is given the union of its child regions' shapes with each
-- refill of the store (#2113, ADR-0159). No column changes: the descriptions
-- of the store and of composite_of now say so. The composites themselves
-- arrive with the next layer build.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

COMMENT ON TABLE workbench.wikidata_geoshapes IS
    'Region shapes for WorldView Import geoshape matching: a Commons map file''s, keyed commons:{file}, with the licence its file declares, and an item''s, keyed by its QID, cut from the OpenStreetMap layer each time a build is swapped in (ADR-0157) under ODbL, or the union of its region''s child regions'' shapes where no object draws it (ADR-0159); nothing from maps.wikimedia.org (#2084)';
COMMENT ON COLUMN workbench.wikidata_geoshapes.composite_of IS
    'How many shapes a composite is the union of: those of the child regions of a region no OpenStreetMap object draws, built with each refill from the layer (ADR-0159); NULL for a shape held whole';

COMMIT;
