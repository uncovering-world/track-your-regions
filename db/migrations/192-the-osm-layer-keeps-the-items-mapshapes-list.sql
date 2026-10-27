-- 192-the-osm-layer-keeps-the-items-mapshapes-list.sql
--
-- The OpenStreetMap layer also keeps whole the objects that carry an item a
-- {{mapshape}} on an imported region's Wikivoyage page lists, so the mapshape
-- match draws a child region from its districts' outlines (#2105, ADR-0158).
-- No column changes: the layer table's description now says so.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

COMMENT ON TABLE workbench.osm_objects IS
    'An OpenStreetMap object of the layer (#1437, ADR-0134): its type as osm2pgsql writes it (N, W, R) and id, every tag, the wikidata and wikipedia tags for lookup, and its geometry in WGS 84: the full shape where a kind draws the object (a ruin, a dig, a protected area) or the object carries an item the world-view match reads a shape for, a region''s own or one its Wikivoyage page''s mapshapes list (ADR-0157, ADR-0158): a way''s line or the area it encloses, an area relation''s multipolygon, another relation''s collection of members; one point for every other object (ADR-0136), which locates it and never places anything. ODbL: what the catalogue takes from it keeps its provenance (ADR-0059). Never written but by the layer''s build, which swaps a new copy in whole.';

COMMIT;
