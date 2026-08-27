-- 037: Rebuild every rendered rung of regions and administrative_divisions, so
--      that a rung carries the interior rings its source has and no others.
--
-- Why the shapes change (#685). simplify_for_zoom() simplified with
-- ST_SimplifyVW, which moves every ring on its own: the simplified outline
-- crosses itself and two parts that were disjoint come to overlap, and the
-- ST_MakeValid every geometry write ends with then resolves the overlap the only
-- way it can -- by carving it out as an interior ring. So each rung carried
-- holes the data does not have, and more of them the coarser the rung. The eight
-- root regions of the Administrative world view hold 610 interior rings between
-- them; the 1 km rung carried 1,933 and the 5 km rung 7,057. Over north-eastern
-- Thailand the rung a visitor reads drew 66 holes where the data has 8, big
-- enough to read as white blobs at zoom 8.
--
-- The function now simplifies with ST_CoverageSimplify -- topology-preserving
-- Visvalingam-Whyatt, the same algorithm without the breakage (ADR-0036). This
-- file recomputes what the old one wrote. It repairs no data and drops no
-- column: every value here is derived, and a second run arrives at the same
-- shapes.
--
-- Apply after re-applying 01-schema.sql, which carries the new function:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/037-topology-preserving-rungs.sql
--
-- Order matters. The per-row pass goes first and touches every row, the
-- coverage pass then overwrites the rows it owns -- a sibling set of two or
-- more non-hull regions -- because only it can keep a border shared between two
-- rows (rule 15). Doing it the other way round would leave white slivers
-- between neighbours where the per-row pass had moved each side its own way.
--
-- Cost on a development database, and it is hours rather than minutes: 36 m 37 s
-- for the 3,830 regions per row, 11 m 40 s for the coverage pass over their 218
-- sibling sets, 1 h 35 m 39 s for the 392,198 divisions -- 2 h 24 m in all. Every
-- rung is recomputed from full resolution, which is the same work a fresh GADM
-- import does in db/init-db.py step 3. It raises a NOTICE with the elapsed time
-- as each pass finishes, so a long run can be told from a stuck one.
-- Interrupting is safe and keeps nothing: one transaction, all of it or none.
--
-- Follow it with VACUUM (ANALYZE) on both tables, for the reason 008 and 030
-- give: every row is rewritten, and until the dead tuples are reclaimed the tile
-- queries scan twice the pages. VACUUM cannot run inside a transaction:
--
--   npm run db:run-sql -- -c 'VACUUM (ANALYZE) regions' \
--                       -c 'VACUUM (ANALYZE) administrative_divisions'

\set ON_ERROR_STOP on

BEGIN;

-- The whole file is a recompute through simplify_for_zoom(). Against the old
-- definition it would spend its entire runtime writing back exactly the shapes
-- it is meant to replace, and report success.
DO $$
DECLARE
    definition text;
BEGIN
    SELECT pg_get_functiondef(
               to_regprocedure('simplify_for_zoom(geometry, double precision, double precision, integer)'))
    INTO definition;

    IF definition IS NULL THEN
        RAISE EXCEPTION
            'simplify_for_zoom() missing -- re-apply db/init/01-schema.sql first';
    END IF;

    IF definition NOT LIKE '%ST_CoverageSimplify%' THEN
        RAISE EXCEPTION
            'simplify_for_zoom() still simplifies with ST_SimplifyVW -- re-apply db/init/01-schema.sql first';
    END IF;
END
$$;

-- Regions, per row. Writing geom_simplified_low fires trg_regions_geom_3857
-- with low_changed set, which recomputes geom_overview and
-- geom_simplified_coarse from the value this statement is writing -- so the two
-- cheap rungs follow without a statement of their own. The _real pair is
-- always derived from the real geometry rather than from a hull, and no
-- coverage pass ever touches it.
DO $$
DECLARE
    started timestamptz := clock_timestamp();
    touched integer;
BEGIN
    UPDATE regions
    SET geom_simplified_low = simplify_for_zoom(
            CASE WHEN COALESCE(uses_hull, false)
                 THEN COALESCE(hull_geom_3857, geom_3857) ELSE geom_3857 END, 5000, 0, 0),
        geom_simplified_medium = simplify_for_zoom(
            CASE WHEN COALESCE(uses_hull, false)
                 THEN COALESCE(hull_geom_3857, geom_3857) ELSE geom_3857 END, 1000, 0, 0),
        geom_simplified_low_real = simplify_for_zoom(geom_3857, 5000, 0, 0),
        geom_simplified_medium_real = simplify_for_zoom(geom_3857, 1000, 0, 0)
    WHERE geom_3857 IS NOT NULL;

    GET DIAGNOSTICS touched = ROW_COUNT;
    RAISE NOTICE 'regions, per row: % row(s) in %',
        touched, clock_timestamp() - started;
END
$$;

-- The coverage pass, one sibling set at a time. simplify_coverage_regions()
-- rewrites all four rungs of a set from geom_3857, which is what "Compute All"
-- leaves behind and what the per-row pass above has just overwritten.
DO $$
DECLARE
    started timestamptz := clock_timestamp();
    p record;
    sets integer := 0;
BEGIN
    FOR p IN
        SELECT parent_region_id AS id
        FROM regions
        WHERE parent_region_id IS NOT NULL
          AND geom_3857 IS NOT NULL
          AND NOT COALESCE(uses_hull, false)
        GROUP BY parent_region_id
        HAVING count(*) >= 2
    LOOP
        PERFORM simplify_coverage_regions(p.id);
        sets := sets + 1;
    END LOOP;
    RAISE NOTICE 'regions, coverage pass: % sibling set(s) in %',
        sets, clock_timestamp() - started;
END
$$;

-- Divisions, per row. Every 3857 rung on that table is per-row today -- its
-- coverage pass (simplify_coverage_siblings) works on the 4326 columns the
-- GeoJSON API reads -- so there is no second pass to run here, and making the
-- rendered columns gap-free is still #560's work. The two cheap rungs derive
-- from the low one and are written in the same statement order the trigger
-- uses.
DO $$
DECLARE
    started timestamptz := clock_timestamp();
    touched integer;
BEGIN
    UPDATE administrative_divisions
    SET geom_simplified_low_3857 = simplify_for_zoom(geom_3857, 5000, 0, 0),
        geom_simplified_medium_3857 = simplify_for_zoom(geom_3857, 1000, 0, 0)
    WHERE geom_3857 IS NOT NULL;

    GET DIAGNOSTICS touched = ROW_COUNT;

    UPDATE administrative_divisions
    SET geom_overview_3857 = simplify_for_overview(geom_simplified_low_3857, 50000),
        geom_simplified_coarse_3857 = simplify_for_overview(geom_simplified_low_3857, 10000)
    WHERE geom_simplified_low_3857 IS NOT NULL;

    RAISE NOTICE 'divisions, per row: % row(s) in %',
        touched, clock_timestamp() - started;
END
$$;

-- Every tile from zoom 0 upward is now built from different geometry while the
-- URLs that produce them are unchanged, so without this an operator gets
-- pre-migration shapes back out of Martin's cache -- at cache speed, which reads
-- as the change having landed. tile_version is the _v the frontend puts on every
-- Martin URL. COALESCE because the column is nullable: a row holding NULL would
-- keep it through a bare increment.
UPDATE world_views SET tile_version = COALESCE(tile_version, 0) + 1;

-- What the file exists to establish, asked of the rows rather than of the code:
-- no rung of a region carries more interior rings than the shape it derives
-- from, and no rung of 5 km or finer carries fewer pieces. A hull region's low
-- and medium rungs come from its hull, which is the input the trigger reads; the
-- _real pair always comes from the real geometry. The two cheap rungs are asked
-- about their rings only -- dropping a piece below their own scale is ADR-0031
-- decision 1 and is what they are for.
DO $$
DECLARE
    offenders integer;
BEGIN
    -- MATERIALIZED, or the planner inlines this and re-reads the
    -- full-resolution column once per rung below: 38 s against 21.
    WITH shape AS MATERIALIZED (
        SELECT r.id,
               ST_NRings(eff.g) - ST_NumGeometries(eff.g) AS own_rings,
               ST_NumGeometries(eff.g) AS own_parts,
               ST_NRings(r.geom_3857) - ST_NumGeometries(r.geom_3857) AS real_rings,
               ST_NumGeometries(r.geom_3857) AS real_parts,
               r.geom_simplified_medium, r.geom_simplified_low,
               r.geom_simplified_coarse, r.geom_overview,
               r.geom_simplified_medium_real, r.geom_simplified_low_real
          FROM regions r
          CROSS JOIN LATERAL (
                SELECT CASE WHEN COALESCE(r.uses_hull, false)
                            THEN COALESCE(r.hull_geom_3857, r.geom_3857)
                            ELSE r.geom_3857 END AS g
               ) eff
         WHERE r.geom_3857 IS NOT NULL
    )
    SELECT count(DISTINCT s.id)
    INTO offenders
    FROM shape s
    CROSS JOIN LATERAL (VALUES
        ('holes', ST_NRings(s.geom_simplified_medium) - ST_NumGeometries(s.geom_simplified_medium), s.own_rings),
        ('holes', ST_NRings(s.geom_simplified_low) - ST_NumGeometries(s.geom_simplified_low), s.own_rings),
        ('holes', ST_NRings(s.geom_simplified_coarse) - ST_NumGeometries(s.geom_simplified_coarse), s.own_rings),
        ('holes', ST_NRings(s.geom_overview) - ST_NumGeometries(s.geom_overview), s.own_rings),
        ('holes', ST_NRings(s.geom_simplified_medium_real) - ST_NumGeometries(s.geom_simplified_medium_real), s.real_rings),
        ('holes', ST_NRings(s.geom_simplified_low_real) - ST_NumGeometries(s.geom_simplified_low_real), s.real_rings),
        ('pieces', ST_NumGeometries(s.geom_simplified_medium), s.own_parts),
        ('pieces', ST_NumGeometries(s.geom_simplified_low), s.own_parts),
        ('pieces', ST_NumGeometries(s.geom_simplified_medium_real), s.real_parts),
        ('pieces', ST_NumGeometries(s.geom_simplified_low_real), s.real_parts)
    ) AS rung(counted, drawn, held)
    WHERE (rung.counted = 'holes' AND rung.drawn > rung.held)
       OR (rung.counted = 'pieces' AND rung.drawn < rung.held);

    IF offenders > 0 THEN
        RAISE EXCEPTION
            'a rung is still unlike the shape it was made from, on % region(s)', offenders;
    END IF;
END
$$;

COMMIT;
