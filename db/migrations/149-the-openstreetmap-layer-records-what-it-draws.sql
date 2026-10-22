-- 149-the-openstreetmap-layer-records-what-it-draws.sql
--
-- Each build of the OpenStreetMap layer records the rule it kept full
-- geometries by (#1437, ADR-0136): historic, man_made and boundary values,
-- as the keep rule a kind hands the reader. A reader whose keep rule the
-- layer in place does not cover asks those outlines live rather than reading
-- a point as one, until a build cut with the wider rule is swapped in. NULL is
-- a layer cut before ADR-0136, which kept every geometry whole.
--
-- Order-independent with 01-schema.sql, which declares the same column.
-- Re-runnable: the column is added if absent.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE workbench.osm_layer_builds ADD COLUMN IF NOT EXISTS drawn JSONB;
COMMENT ON COLUMN workbench.osm_layer_builds.drawn IS 'The rule the build kept full geometries by (ADR-0136): {historic, manMade, boundary} value lists, with ruins and archaeological_site drawn by their presence. Every other object holds a point. NULL is a layer cut before ADR-0136, which kept every geometry whole.';

COMMIT;
