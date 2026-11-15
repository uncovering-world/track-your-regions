-- 243-a-place-is-placed-by-its-outline-and-its-nearest-region.sql
--
-- A place's regions come from its own geometry as well as from its points
-- (#2122, ADR-0207): the leaves its outline lies in (the Theban Necropolis in
-- Luxor and in the New Valley), the leaves its line crosses (no line is drawn
-- yet: the column is added empty), the nearest leaf of a point no region
-- holds, within 25 km and when no other leaf lies within 1.5 times that
-- distance (the Island of Gorée in Dakar, the Golden Gate Bridge in
-- California), and, for a place with no point of its own, the leaf of its
-- kind record's point, which offers it to readers where none of its parts
-- does yet. Placement writes those regions into experience_shape_regions,
-- since each reads geometry; refresh_place_regions() reads them beside the
-- points' and still reads no geometry itself.
--
-- Three transactions: the shape (a table, four columns), short, then the
-- functions, then the backfill, which places every place by its geometry in
-- every world view with geometry and refreshes the regions of the places
-- that gained any. Order-independent with 01-schema.sql, which declares the
-- same. Re-runnable: the columns, table and index are added where missing,
-- the functions replaced, and a second backfill writes nothing.

\set ON_ERROR_STOP on

BEGIN;

-- The columns take experiences' exclusive lock until this transaction
-- commits: a long transaction on the table must not stall the reads behind it.
SET LOCAL lock_timeout = '10s';

-- A place's line, beside its outline (ADR-0207): a bridge, a tunnel, a dam,
-- a causeway drawn from OpenStreetMap's ways. Its owner is the source that
-- drew it, as for the outline (ADR-0146); path_source_ref names the objects
-- it was read from (ODbL provenance, ADR-0059) and path_updated_at the build
-- it was read from. It places the place and is not drawn yet (#1969).
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS path GEOMETRY(MultiLineString, 4326);
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS path_source_id INTEGER REFERENCES experience_sources(id) ON DELETE SET NULL;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS path_source_ref TEXT;
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS path_updated_at TIMESTAMPTZ;
COMMENT ON COLUMN experiences.path IS 'The place''s line (a bridge, a tunnel, a dam), from OpenStreetMap: it places the place in the regions it crosses (ADR-0207). NULL where none was drawn.';
COMMENT ON COLUMN experiences.path_source_id IS 'The source that drew the line: only it replaces or clears it (ADR-0207, as boundary_source_id, ADR-0146).';
COMMENT ON COLUMN experiences.path_source_ref IS 'The OpenStreetMap objects the line was read from (osm:W4815559,R451971), for its ODbL credit (ADR-0059).';
COMMENT ON COLUMN experiences.path_updated_at IS 'When the layer the line was read from was built.';

-- The regions a place's own geometry puts it in, beside the ones its points
-- give (ADR-0207): the leaves its outline or its line lies in, the nearest leaf
-- of a point no region holds, and the leaf of its kind record's point for a
-- place with no point of its own; each with the regions above it. Placement
-- writes it (refresh_place_shape_regions()), since each basis reads geometry,
-- and refresh_place_regions() reads it, so a refresh still reads none.
CREATE TABLE IF NOT EXISTS experience_shape_regions (
    experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
    basis VARCHAR(8) NOT NULL CHECK (basis IN ('area', 'line', 'nearest', 'record')),
    PRIMARY KEY (experience_id, region_id, basis)
);
COMMENT ON TABLE experience_shape_regions IS 'The regions a place''s outline, line, nearest leaf or kind record''s point put it in, with the regions above (ADR-0207): written by placement, read by refresh_place_regions().';
CREATE INDEX IF NOT EXISTS idx_experience_shape_regions_region ON experience_shape_regions(region_id);

COMMIT;

BEGIN;

-- The automatic rows the places `places` are expected to hold, in one world
-- view or in all, with the listing each row carries (ADR-0197, ADR-0207):
-- the regions of the points each shows, its own and its direct parts', and
-- the regions its own geometry and its parts' put it in
-- (experience_shape_regions: an outline, a line, the nearest leaf of a point
-- no region holds), each listed as its place's points are. Where none of
-- those offers the place to a reader in a world view, the leaf of its kind
-- record's point does (a serial site none of whose parts is read yet), and
-- readers find it there whenever they are shown the place at all.
CREATE OR REPLACE FUNCTION place_regions_expected(places INTEGER[], world_view INTEGER DEFAULT NULL)
RETURNS TABLE (experience_id INTEGER, region_id INTEGER, listing TEXT)
LANGUAGE sql STABLE AS $$
  WITH shown AS MATERIALIZED (SELECT * FROM place_shown_points(places)),
  seen AS (
    SELECT shown.place_id, bool_or(shown.visible) AS any_visible
      FROM shown GROUP BY shown.place_id),
  parts_seen AS (
    SELECT shown.place_id, el.experience_id AS part_id, bool_or(shown.visible) AS any_visible
      FROM shown JOIN experience_locations el ON el.id = shown.location_id
     WHERE el.experience_id <> shown.place_id
     GROUP BY shown.place_id, el.experience_id),
  holders (place_id, member_id, any_visible) AS (
    SELECT seen.place_id, seen.place_id, seen.any_visible FROM seen
    UNION ALL
    SELECT parts_seen.place_id, parts_seen.part_id, parts_seen.any_visible FROM parts_seen),
  given (place_id, region_id, visible) AS (
    SELECT shown.place_id, elr.region_id, shown.visible
      FROM shown JOIN experience_location_regions elr ON elr.location_id = shown.location_id
    UNION ALL
    SELECT holders.place_id, esr.region_id, holders.any_visible
      FROM holders CROSS JOIN LATERAL (
        SELECT drawn.region_id FROM experience_shape_regions drawn
         WHERE drawn.experience_id = holders.member_id AND drawn.basis <> 'record') esr),
  placed AS MATERIALIZED (
    SELECT given.place_id, given.region_id, r.world_view_id, bool_or(given.visible) AS visible
      FROM given JOIN regions r ON r.id = given.region_id
     WHERE world_view IS NULL OR r.world_view_id = world_view
     GROUP BY given.place_id, given.region_id, r.world_view_id),
  recorded AS MATERIALIZED (
    SELECT esr.experience_id AS place_id, esr.region_id, r.world_view_id
      FROM experience_shape_regions esr JOIN regions r ON r.id = esr.region_id
     WHERE esr.experience_id = ANY(places) AND esr.basis = 'record'
       AND (world_view IS NULL OR r.world_view_id = world_view)
       AND NOT EXISTS (SELECT 1 FROM placed
                        WHERE placed.place_id = esr.experience_id
                          AND placed.world_view_id = r.world_view_id AND placed.visible))
  SELECT COALESCE(placed.place_id, recorded.place_id), COALESCE(placed.region_id, recorded.region_id),
         CASE WHEN placed.visible OR recorded.place_id IS NOT NULL THEN 'offered'
              WHEN seen.any_visible
                   OR EXISTS (SELECT 1 FROM recorded here
                               WHERE here.place_id = placed.place_id AND here.world_view_id = placed.world_view_id)
              THEN 'scope' ELSE 'fallback' END
    FROM placed
    FULL JOIN recorded ON recorded.place_id = placed.place_id AND recorded.region_id = placed.region_id
    LEFT JOIN seen ON seen.place_id = COALESCE(placed.place_id, recorded.place_id)
$$;
COMMENT ON FUNCTION place_regions_expected(INTEGER[], INTEGER) IS 'The automatic experience_regions rows these places are expected to hold, in one world view or all (ADR-0197, ADR-0207): from the points they show and the regions their geometry gives, else their kind record''s point. What refresh_place_regions() writes and the catalogue check place-regions-out-of-step compares.';

-- Every place that has automatic rows or may need some: a place with a point,
-- a whole, a place whose geometry gives regions, a place holding an automatic
-- row. What a refresh of every place and the catalogue check
-- place-regions-out-of-step go over.
CREATE OR REPLACE FUNCTION places_with_regions() RETURNS INTEGER[]
LANGUAGE sql STABLE AS $$
  SELECT ARRAY(SELECT el.experience_id FROM experience_locations el
               UNION SELECT prt.whole_id FROM experience_parts prt
               UNION SELECT esr.experience_id FROM experience_shape_regions esr
               UNION SELECT er.experience_id FROM experience_regions er
                      WHERE er.assignment_type IS DISTINCT FROM 'manual')
$$;
COMMENT ON FUNCTION places_with_regions() IS 'Every place that holds automatic experience_regions rows or may need some (ADR-0197): what refresh_place_regions(NULL) and the catalogue check place-regions-out-of-step go over.';

-- Whether an outline is the place's own: it holds the place's point or lies
-- within a kilometre of it. One farther away is another object of the same
-- name (the Pergamon Altar's outline lies in Izmir, the altar in Berlin), and
-- it places nothing (ADR-0207; check outline-away-from-its-place).
CREATE OR REPLACE FUNCTION outline_reaches_place(outline GEOMETRY, point GEOMETRY) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ST_DWithin(outline::geography, point::geography, 1000)
$$;
COMMENT ON FUNCTION outline_reaches_place(GEOMETRY, GEOMETRY) IS 'Whether an outline holds the place''s point or lies within 1 km of it: one farther is another object, and places nothing (ADR-0207).';

-- The regions of world view `world_view` the places `places` (NULL: every
-- place) are in by their own geometry (ADR-0207), each leaf with the regions
-- above it, as placement takes a point's (ADR-0054):
--   area     the leaves holding at least 1% of the place's outline, when the
--            outline is its own (outline_reaches_place);
--   line     the leaves holding at least 1% of the length of its line;
--   nearest  for a place none of whose own points a region holds and with no
--            outline or line placing it, the leaf nearest each of its points,
--            within 25 km, when no other leaf lies within 1.5 times that
--            distance (Gorée 14 m off Dakar; the Øresund Bridge, 3.1 km from
--            Copenhagen and 4.5 km from Skåne, is left to its line);
--   record   for a place with no point of its own (a serial site), the leaf
--            holding the point each of its kind records reports.
-- Its own points are the ones place_shown_points() places a place by,
-- spelled here so the planner counts them (a call it cannot inline is
-- guessed at a thousand rows, and the anti-join below then loops).
-- NOT IN rather than NOT EXISTS for the same reason: it is hashed whatever
-- the planner guesses.
CREATE OR REPLACE FUNCTION place_shape_regions_expected(places INTEGER[], world_view INTEGER)
RETURNS TABLE (experience_id INTEGER, region_id INTEGER, basis TEXT)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE scope AS MATERIALIZED (
    SELECT e.id, e.location, e.boundary, ST_Area(e.boundary) AS outline_area, e.path, ST_Length(e.path) AS path_length
      FROM experiences e WHERE places IS NULL OR e.id = ANY(places)),
  leaves AS (SELECT r.id FROM regions r WHERE r.world_view_id = world_view AND r.is_leaf),
  area AS (
    SELECT s.id, p.region_id
      FROM scope s
      JOIN region_geom_pieces p ON p.geom && s.boundary AND ST_Intersects(p.geom, s.boundary)
      JOIN leaves l ON l.id = p.region_id
     WHERE s.boundary IS NOT NULL AND outline_reaches_place(s.boundary, s.location)
     GROUP BY s.id, p.region_id
    HAVING sum(ST_Area(ST_Intersection(p.geom, s.boundary))) >= 0.01 * max(s.outline_area)),
  line AS (
    SELECT s.id, p.region_id
      FROM scope s
      JOIN region_geom_pieces p ON p.geom && s.path AND ST_Intersects(p.geom, s.path)
      JOIN leaves l ON l.id = p.region_id
     WHERE s.path IS NOT NULL
     GROUP BY s.id, p.region_id
    HAVING sum(ST_Length(ST_Intersection(p.geom, s.path))) >= 0.01 * max(s.path_length)),
  own AS MATERIALIZED (
    SELECT el.experience_id AS place_id, el.id AS location_id, el.location
      FROM scope JOIN experience_locations el ON el.experience_id = scope.id
     WHERE el.missing_since IS NULL AND el.existence <> 'lost' AND el.merged_into_id IS NULL
       AND el.refused_at IS NULL),
  placed AS MATERIALIZED (
    SELECT own.place_id FROM own
      JOIN experience_location_regions elr ON elr.location_id = own.location_id
      JOIN regions r ON r.id = elr.region_id AND r.world_view_id = world_view
    UNION SELECT area.id FROM area
    UNION SELECT line.id FROM line),
  unheld AS MATERIALIZED (
    SELECT own.place_id, own.location FROM own
     WHERE own.place_id NOT IN (SELECT placed.place_id FROM placed)),
  nearest AS (
    SELECT unheld.place_id AS id, near.region_id
      FROM unheld
     CROSS JOIN LATERAL (
       SELECT d.region_id, d.metres, lead(d.metres) OVER (ORDER BY d.metres) AS next_metres
         FROM (SELECT p.region_id, min(ST_Distance(unheld.location::geography, p.geom::geography)) AS metres
                 FROM region_geom_pieces p JOIN leaves l ON l.id = p.region_id
                WHERE ST_DWithin(p.geom, unheld.location,
                                 37500 / 110000.0 / greatest(cos(radians(ST_Y(unheld.location))), 0.05))
                GROUP BY p.region_id) d
        ORDER BY d.metres LIMIT 1) near
     WHERE near.metres <= 25000 AND (near.next_metres IS NULL OR near.next_metres > 1.5 * near.metres)),
  recorded AS (
    SELECT s.id, p.region_id
      FROM scope s
      JOIN source_records m ON m.experience_id = s.id AND m.kind_id IS NOT NULL AND m.admission <> 'refused'
      JOIN region_geom_pieces p ON p.geom && m.reported_location AND ST_Intersects(p.geom, m.reported_location)
      JOIN leaves l ON l.id = p.region_id
     WHERE NOT EXISTS (SELECT 1 FROM experience_locations el WHERE el.experience_id = s.id)),
  above (experience_id, region_id, basis) AS (
    SELECT id, region_id, 'area' FROM area
    UNION SELECT id, region_id, 'line' FROM line
    UNION SELECT id, region_id, 'nearest' FROM nearest
    UNION SELECT id, region_id, 'record' FROM recorded
    UNION
    SELECT above.experience_id, r.parent_region_id, above.basis
      FROM above JOIN regions r ON r.id = above.region_id
     WHERE r.parent_region_id IS NOT NULL)
  SELECT above.experience_id, above.region_id, above.basis FROM above
$$;
COMMENT ON FUNCTION place_shape_regions_expected(INTEGER[], INTEGER) IS 'The regions of one world view these places (NULL: every place) are in by their outline, their line, the nearest leaf of a point no region holds, or their kind record''s point when they have no point of their own, with the regions above (ADR-0207): what refresh_place_shape_regions() writes.';

-- Rewrites the experience_shape_regions rows of the places `places` (NULL:
-- every place) in one world view, as place_shape_regions_expected() makes
-- them, writing only what differs, and returns how many rows it wrote or
-- removed. Placement calls it before refresh_place_regions(), which reads
-- the rows: under the places' region keys (lock_place_regions()), taken
-- first, so a refresh never reads a placement's rows half written.
CREATE OR REPLACE FUNCTION refresh_place_shape_regions(places INTEGER[], world_view INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  written INTEGER;
BEGIN
  PERFORM lock_place_regions(places);
  WITH expected AS MATERIALIZED (
    SELECT x.experience_id, x.region_id, x.basis FROM place_shape_regions_expected(places, world_view) x
  ),
  removed AS (
    DELETE FROM experience_shape_regions esr
     USING regions r
     WHERE r.id = esr.region_id AND r.world_view_id = world_view
       AND (places IS NULL OR esr.experience_id = ANY(places))
       AND NOT EXISTS (SELECT 1 FROM expected x
                        WHERE x.experience_id = esr.experience_id AND x.region_id = esr.region_id
                          AND x.basis = esr.basis)
    RETURNING 1
  ),
  put AS (
    INSERT INTO experience_shape_regions (experience_id, region_id, basis)
    SELECT x.experience_id, x.region_id, x.basis FROM expected x
     ORDER BY x.experience_id, x.region_id, x.basis
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM removed) + (SELECT count(*) FROM put) INTO written;
  RETURN written;
END;
$$;
COMMENT ON FUNCTION refresh_place_shape_regions(INTEGER[], INTEGER) IS 'Rewrites the experience_shape_regions rows of these places (NULL: every place) in one world view, as place_shape_regions_expected() makes them, under their region keys (ADR-0207). Called by placement before refresh_place_regions().';

COMMIT;

-- The backfill in a transaction of its own. It holds every place's region
-- keys (lock_place_regions(NULL)) until it commits, so a curator's write that
-- refreshes a place's regions waits for it.
BEGIN;

SELECT w.world_view_id, refresh_place_shape_regions(NULL, w.world_view_id) AS shape_rows_written
  FROM (SELECT DISTINCT world_view_id FROM regions WHERE geom IS NOT NULL ORDER BY world_view_id) w;

SELECT refresh_place_regions(ARRAY(SELECT DISTINCT experience_id FROM experience_shape_regions)) AS rows_written;

COMMIT;
