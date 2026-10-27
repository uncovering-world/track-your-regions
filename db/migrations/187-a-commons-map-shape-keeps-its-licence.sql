-- 187-a-commons-map-shape-keeps-its-licence.sql
--
-- A region shape kept from a Commons map data file (`Data:<file>.map`) is that
-- file's work, under the licence the file declares: ODbL for most of
-- Wikivoyage's region maps, which are drawn from OpenStreetMap, CC0 for
-- others. The admin's import dialogs draw the shape, and a shape drawn carries
-- its credit, as a region map image does (migration 183) and a site's outline
-- does (ADR-0059). So the store keeps the file's `license` and its `sources`
-- line, read with the shape (#2085).
--
-- A Commons shape kept before this has neither, and a migration does not call
-- Commons, so those rows go: the store is a cache, and the next match that
-- names the file reads it again with its licence.
--
-- Re-runnable.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE workbench.wikidata_geoshapes
    ADD COLUMN IF NOT EXISTS licence TEXT,
    ADD COLUMN IF NOT EXISTS attribution TEXT;

DELETE FROM workbench.wikidata_geoshapes
 WHERE wikidata_id LIKE 'commons:%' AND NOT not_available AND licence IS NULL;

ALTER TABLE workbench.wikidata_geoshapes
    DROP CONSTRAINT IF EXISTS wikidata_geoshapes_credit_presence;
ALTER TABLE workbench.wikidata_geoshapes
    ADD CONSTRAINT wikidata_geoshapes_credit_presence CHECK (not_available OR licence IS NOT NULL);

COMMENT ON TABLE workbench.wikidata_geoshapes IS
    'Commons map shapes for WorldView Import geoshape matching, keyed commons:{file}, each with the licence its file declares; nothing from maps.wikimedia.org and no composite unions (#2084), so no row is keyed by a Wikidata QID until #2085';
COMMENT ON COLUMN workbench.wikidata_geoshapes.licence IS
    'The licence the shape is under, as its source declares it (a Commons map file''s license, e.g. ODbL-1.0); null only on a not_available row';
COMMENT ON COLUMN workbench.wikidata_geoshapes.attribution IS
    'What the source says the shape was drawn from (a Commons map file''s sources line, e.g. Based on OpenStreetMap data); null when it says nothing';

COMMIT;
