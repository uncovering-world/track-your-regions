-- 182-no-shape-from-the-wikimedia-maps-service.sql
--
-- The world-view import no longer reads region outlines from
-- maps.wikimedia.org (#2084): the Wikimedia Maps Terms of Use do not let a
-- third-party service use it, and the import presented itself as Wikivoyage to
-- get through. This removes what that service sent and what was computed from
-- it:
--
--   - every shape keyed by a Wikidata item, the ones the service returned, its
--     "no shape" answers, and the unions built from them (composite_of). A shape
--     a Commons map holds is keyed "commons:{file}" and stays;
--   - a region's geo_available, which recorded what the service answered for
--     it, wherever no shape is held for the region's item any more: unknown
--     again, as before the first lookup;
--   - a suggestion's geo_similarity, the overlap of a division with the region's
--     shape, wherever that shape is no longer held. The divisions an admin has
--     already accepted stay members of their regions.
--
-- No composite union is built any more either. Until the import holds shapes
-- from a source it may use (#2085), Geoshape Match and the spatial pass match a
-- region by its Wikivoyage markers instead.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

DELETE FROM workbench.wikidata_geoshapes
 WHERE wikidata_id NOT LIKE 'commons:%';

UPDATE region_import_state ris
   SET geo_available = NULL
 WHERE ris.geo_available IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM workbench.wikidata_geoshapes wg
      WHERE wg.wikidata_id = ris.source_external_id
   );

UPDATE region_match_suggestions rms
   SET geo_similarity = NULL
  FROM region_import_state ris
 WHERE ris.region_id = rms.region_id
   AND rms.geo_similarity IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM workbench.wikidata_geoshapes wg
      WHERE wg.wikidata_id = ris.source_external_id
        AND NOT wg.not_available
   );

COMMENT ON TABLE workbench.wikidata_geoshapes IS 'Commons map shapes for WorldView Import geoshape matching, keyed commons:{file}; nothing from maps.wikimedia.org and no composite unions (#2084), so no row is keyed by a Wikidata QID until #2085';
COMMENT ON COLUMN workbench.wikidata_geoshapes.composite_of IS 'How many parts a composite geoshape is the union of, every part the item names (#1628); NULL for a shape held whole. No composite is built since #2084';

COMMIT;
