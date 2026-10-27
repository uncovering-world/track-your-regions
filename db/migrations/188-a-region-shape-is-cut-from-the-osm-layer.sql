-- 188-a-region-shape-is-cut-from-the-osm-layer.sql
--
-- The OpenStreetMap layer keeps whole the objects that carry an item a
-- world-view import names, and once a build is swapped in, the store of
-- region shapes is refilled from them, keyed by the item (#2085, ADR-0157).
-- Such a shape is OpenStreetMap's work under ODbL, kept with that licence.
-- No column changes: the descriptions of the two tables and the licence
-- column now say so.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

COMMENT ON TABLE workbench.wikidata_geoshapes IS
    'Region shapes for WorldView Import geoshape matching: a Commons map file''s, keyed commons:{file}, with the licence its file declares, and an item''s, keyed by its QID, cut from the OpenStreetMap layer each time a build is swapped in (ADR-0157) under ODbL; nothing from maps.wikimedia.org and no composite unions (#2084)';
COMMENT ON COLUMN workbench.wikidata_geoshapes.licence IS
    'The licence the shape is under, as its source declares it (a Commons map file''s license, e.g. ODbL-1.0; ODbL-1.0 for a shape cut from the OpenStreetMap layer); null only on a not_available row';
COMMENT ON TABLE workbench.osm_objects IS
    'An OpenStreetMap object of the layer (#1437, ADR-0134): its type as osm2pgsql writes it (N, W, R) and id, every tag, the wikidata and wikipedia tags for lookup, and its geometry in WGS 84: the full shape where a kind draws the object (a ruin, a dig, a protected area) or the object carries an item a world-view import names (ADR-0157): a way''s line or the area it encloses, an area relation''s multipolygon, another relation''s collection of members; one point for every other object (ADR-0136), which locates it and never places anything. ODbL: what the catalogue takes from it keeps its provenance (ADR-0059). Never written but by the layer''s build, which swaps a new copy in whole.';

COMMIT;
