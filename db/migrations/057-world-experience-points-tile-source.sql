-- Migration 057: the catalogue's points as a Martin tile source (#910)
--
-- A world map of a kind is a read of points, not of objects: a serial World
-- Heritage site is one row and hundreds of places. `GET /api/experiences` caps
-- a page at 1000 rows and answers objects, so the map read this one tile
-- function instead — the same mechanism the region polygons already use.
--
-- The function is reproduced verbatim in db/init/01-schema.sql, which is what a
-- fresh database gets; this file is for a database that already holds data.
-- Additive: it creates a function and grants it, and touches no row.

BEGIN;

CREATE OR REPLACE FUNCTION tile_experience_points(
    z integer,
    x integer,
    y integer,
    query_params json DEFAULT '{}'::json
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
    result bytea;
    bounds geometry;
    lonlat geometry;
    p_kind_id integer;
    -- From this zoom a feature carries what a pin needs; below it, a point and
    -- its fold flag and nothing else. Measured on the development catalogue:
    -- the tile holding the whole world is 112 kB as it ships and 583 kB
    -- carrying every property, and no reader below the marker band can see a
    -- name. 4 is the integer tile zoom the
    -- markers' fade band draws from -- MARKER_FADE_START is 4.5 in
    -- frontend/src/components/experienceMarkers/layers.ts, and MapLibre serves
    -- zoom 4.5 from z4 tiles, so labelling from z5 would fade in colourless,
    -- nameless pins over half a zoom level.
    labelled boolean;
    -- The fold's answer: the id of each drawn object's reader position, to
    -- the number of places it stands for. Built at every zoom, because the
    -- fold answers a picture the heatmap gives as much as a crowd of pins --
    -- the Rock Art of the Mediterranean Basin's 734 shelters saturate eastern
    -- Spain long before a single pin is drawn.
    --
    -- Narrowed to the objects this tile draws, which is never slower and is
    -- what keeps a deep tile cheap: measured over the whole catalogue against
    -- the same map built for every object, 38 ms against 67 at z0, 16 against
    -- 33 at z4, and 4 ms against 33 over a city at z10, where the tile holds
    -- one object.
    --
    -- A jsonb map rather than a join, because the two sides are a GiST `&&`
    -- the planner estimates at one row and an aggregate it estimates at one
    -- row, and it joins them with a nested loop -- 2304 x 952 rows and 8.3 s
    -- on the densest z4 tile. Built here, the lookup is a binary search per
    -- feature.
    folds jsonb;
BEGIN
    -- A value that is not a kind id answers with an empty tile rather than an
    -- error. Martin publishes this on its own port, so the parameter is
    -- whatever a stranger typed, and Martin returns what the cast raises as a
    -- 500 carrying the Postgres message. Empty is the honest answer: naming a
    -- kind that cannot exist is not the same request as naming none, so it must
    -- not quietly widen to every kind. The five older sources that take a
    -- parameter still answer such a request with the 500 --
    -- tile_gadm_root_divisions reads none, so it has nothing to cast --;
    -- hardening them together is #918.
    --
    -- Both of the cast's failure classes, because they are different values of
    -- wrong and only one of them is obvious: `abc`, `1.5` and the empty string
    -- a client writes when it means "no kind" raise
    -- `invalid_text_representation` (22P02), while a literal that is a perfectly
    -- good integer and simply does not fit -- `99999999999` -- raises
    -- `numeric_value_out_of_range` (22003) from `pg_strtoint32_safe` instead.
    -- Named rather than `WHEN others`, which would swallow a cancelled query
    -- and answer an empty tile for it.
    BEGIN
        p_kind_id := (query_params->>'kind_id')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN '';
    END;

    bounds := ST_TileEnvelope(z, x, y);
    -- The envelope in the column's own SRID, so idx_experience_locations_location
    -- answers the filter.
    lonlat := ST_Transform(bounds, 4326);
    labelled := z >= 4;

    SELECT COALESCE(jsonb_object_agg(f.main_id::text, f.places), '{}'::jsonb)
      INTO folds
    FROM (
        SELECT
            -- The place nearest the object's own published point, which is
            -- what the catalogue answers "where is this" with (ADR-0028
            -- decision 2, readerPositionSql) -- so a folded pin here sits
            -- where a region's folded pin sits. In metres on geography,
            -- never in degrees, for the reason that fragment gives: at 70N
            -- a degree of longitude is a third of a degree of latitude, and
            -- degree ordering sends the reader further in every case it
            -- changes. `el.id` breaks ties, so the answer is total.
            (array_agg(el.id ORDER BY el.location::geography <-> e.location::geography, el.id))[1]
                AS main_id,
            count(*)::int AS places
        FROM experience_locations el
        JOIN experiences e ON e.id = el.experience_id
        WHERE el.experience_id IN (
                SELECT el0.experience_id
                FROM experience_locations el0
                WHERE el0.location && lonlat
                  AND el0.missing_since IS NULL
                  AND el0.existence <> 'lost'
                  AND el0.curation_state <> 'pending')
          -- Every offered place of those objects, not only the ones inside
          -- this tile: the nearest place is what decides the fold, and it may
          -- well lie in the next tile.
          AND el.missing_since IS NULL
          AND el.existence <> 'lost'
          AND el.curation_state <> 'pending'
        GROUP BY el.experience_id
    ) f;

    SELECT ST_AsMVT(tile, 'points', 4096, 'geom') INTO result
    FROM (
        SELECT
            CASE WHEN labelled THEN el.experience_id END AS "experienceId",
            CASE WHEN labelled THEN el.id END AS "locationId",
            CASE WHEN labelled THEN el.name END AS name,
            CASE WHEN labelled THEN e.name END AS "experienceName",
            -- The kind and the type, never a colour: what colour a kind is
            -- drawn in is decided in one place (frontend/src/utils/kindColors.ts,
            -- #814), and a palette written here would be a second answer to the
            -- same question.
            CASE WHEN labelled THEN m.kind_id END AS "kindId",
            CASE WHEN labelled THEN e.type END AS type,
            -- The fold, at every zoom: `main` marks the one place an object is
            -- drawn as when folded, and a NULL property is left out of the tile
            -- altogether, so only the 3 755 objects pay for it. The count
            -- beside it is the badge's, and the badge is only ever drawn at
            -- marker zoom.
            CASE WHEN folds ? el.id::text THEN true END AS main,
            CASE WHEN labelled THEN NULLIF((folds->>el.id::text)::int, 1) END AS "locationCount",
            -- No buffer, which is the opposite of the usual advice and is
            -- right here. A buffer exists so that a feature crossing a tile
            -- edge is drawn whole; a point crosses nothing, and MapLibre
            -- clips neither circles nor the heatmap to their tile, so a point
            -- near an edge already casts its heat and draws its pin across
            -- it from the tile it belongs to. What a buffer adds instead is
            -- the same point in two tiles, and the heatmap **sums** what is
            -- drawn: measured over the four z1 tiles, a 128-unit buffer drew
            -- 10 899 features where no buffer draws 8 850 -- itself 20 more
            -- than the 8 830 places, since a point on a tile edge lands in
            -- both tiles anyway -- so a band a sixteenth of a tile wide along
            -- every edge read half again as dense as the places either side
            -- of it.
            ST_AsMVTGeom(ST_Transform(el.location, 3857), bounds, 4096, 0, true) AS geom
        FROM experience_locations el
        JOIN experiences e ON e.id = el.experience_id
        -- The kind the row is shown under: the membership its own source
        -- brought (rowKindJoinSql, #819). LEFT, as there: the kind is a column
        -- the point is drawn with, not the predicate that decides whether it is
        -- drawn.
        LEFT JOIN experience_kind_memberships m
            ON m.experience_id = e.id AND m.source_id = e.source_id
        WHERE el.location && lonlat
          -- The four reader-facing questions, in the order
          -- backend/src/controllers/experience/experienceLifecycle.ts asks them:
          -- does the source still offer this point and does it still stand
          -- (offeredLocationSql), has anyone looked at it -- which is also what
          -- hides a point a curator turned down, since a refusal leaves
          -- curation_state 'pending' (publishedContentSql, ADR-0053), does the
          -- object still stand (hideLostSql), and is some membership of it both
          -- admitted and passed (placeOfferedSql). Martin publishes this
          -- function on an unauthenticated port, so these are the whole of what
          -- a stranger may read here.
          AND el.missing_since IS NULL
          AND el.existence <> 'lost'
          AND el.curation_state <> 'pending'
          AND e.existence <> 'lost'
          AND EXISTS (SELECT 1 FROM experience_kind_memberships km
                      WHERE km.experience_id = e.id AND km.admission <> 'refused'
                        AND km.curation_state <> 'pending')
          -- Optional, so its predicate admits NULL: naming no kind is the
          -- world of every kind at once, which is a picture rather than a
          -- missing scope. Nothing here is scoped by a parameter -- a place
          -- belongs to the catalogue, not to a lens -- so there is no id whose
          -- absence could widen the answer past what a reader may see.
          AND (p_kind_id IS NULL OR m.kind_id = p_kind_id)
    ) tile
    WHERE tile.geom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$;

COMMENT ON FUNCTION tile_experience_points IS 'MVT tiles for every reader-visible place of the catalogue. Query params: kind_id (optional)';

GRANT EXECUTE ON FUNCTION tile_experience_points TO PUBLIC;

COMMIT;
