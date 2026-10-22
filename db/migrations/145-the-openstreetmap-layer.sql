-- 145-the-openstreetmap-layer.sql
--
-- The OpenStreetMap layer (#1437, ADR-0134): the objects of the planet the
-- catalogue asks about, with every tag and their full geometry, cut from the
-- weekly planet file with osmium and loaded through an osm2pgsql flex style.
-- An object is kept for a selected tag (wikidata, wikipedia, historic,
-- heritage, archaeological_site, ruins, amenity=place_of_worship, tourism,
-- man_made, place, a protected boundary) or because the catalogue names it
-- (metadata.osm on a place), whatever its tags.
--
-- A build loads a _next copy, indexes it and swaps it in whole with its
-- record, as every table kept from a dump is. The tables are logged: a
-- rebuild re-reads a 95 GB planet, which a crash should not cost.
--
-- Order-independent with 01-schema.sql, which declares the same objects.
-- Re-runnable: every object is created if absent.

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS workbench.osm_layer_builds (
    build_id INTEGER PRIMARY KEY REFERENCES workbench.dump_builds(id),
    planet_file TEXT NOT NULL,
    dump_date DATE NOT NULL,
    replicated_at TIMESTAMPTZ NOT NULL,
    objects BIGINT NOT NULL,
    pinned INTEGER NOT NULL,
    pinned_gone INTEGER NOT NULL DEFAULT 0,
    swapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workbench.osm_layer_builds IS 'Each build of the OpenStreetMap layer that was swapped in (#1437, ADR-0134): the dump build that cut it, the planet file and its date, the replication timestamp the planet was current to (every answer read from the layer carries it), the objects kept, how many objects the catalogue named were cut in whatever their tags, and how many of those the planet no longer held (deleted or redrawn under another id since a place linked them). The newest row is what osm_objects holds.';

CREATE TABLE IF NOT EXISTS workbench.osm_objects (
    osm_type CHAR(1) NOT NULL,
    osm_id BIGINT NOT NULL,
    tags JSONB NOT NULL,
    wikidata TEXT,
    wikipedia TEXT,
    geom geometry(Geometry, 4326),
    PRIMARY KEY (osm_type, osm_id)
);
CREATE INDEX IF NOT EXISTS osm_objects_wikidata ON workbench.osm_objects (wikidata) WHERE wikidata IS NOT NULL;
CREATE INDEX IF NOT EXISTS osm_objects_wikipedia ON workbench.osm_objects (wikipedia) WHERE wikipedia IS NOT NULL;
CREATE INDEX IF NOT EXISTS osm_objects_geom ON workbench.osm_objects USING GIST (geom);
COMMENT ON TABLE workbench.osm_objects IS 'An OpenStreetMap object of the layer (#1437, ADR-0134): its type as osm2pgsql writes it (N, W, R) and id, every tag, the wikidata and wikipedia tags for lookup, and its geometry in WGS 84 (a point, a way''s line or the area it encloses, an area relation''s multipolygon, another relation''s collection of members). ODbL: what the catalogue takes from it keeps its provenance (ADR-0059). Never written but by the layer''s build, which swaps a new copy in whole.';

COMMIT;
