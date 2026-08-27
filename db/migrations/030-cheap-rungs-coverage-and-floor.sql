-- 030: Rebuild the two cheap LOD rungs — regions.geom_overview /
--      geom_simplified_coarse and administrative_divisions.geom_overview_3857 /
--      geom_simplified_coarse_3857 — and add the coarse rung to databases that
--      predate it.
--
-- Why the shapes change (#551). The overview rung was Douglas-Peucker, applied
-- per row: it annihilates any piece narrower than the tolerance, and it moves a
-- shared border differently on each side of it. At zoom 2 that is a map with
-- white gashes through Scandinavia and cracks between neighbours everywhere,
-- which is what it has been drawing. It is now floored and coverage-simplified
-- like the rungs below it (rule 15), so a border is one line again.
--
-- Why a rung is being added. The 5 km rung served zoom 3-4 and cost 483 ms to
-- answer one 103 kB tile of the administrative mirror, because the topology-
-- preserving variants do not delete a ring: the mirror's leaves hold 117,100
-- pieces, and four points each is a floor of half a million vertices no
-- tolerance can get under. (This read "neither ST_SimplifyVW nor" until
-- ADR-0036 measured otherwise -- plain VW did delete rings, 436 of Asia's
-- 26,151 pieces at the 1 km rung. The floor stated here is unaffected.) The
-- coarse rung drops the pieces a reader cannot see (100 km^2, one square pixel
-- at zoom 3) and answers the same tile from 183,052 vertices instead of
-- 773,264. See ADR-0031.
--
-- Apply after re-applying 01-schema.sql, which adds the columns, the
-- drop_small_parts() helper and the trigger lines that maintain both rungs:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/030-cheap-rungs-coverage-and-floor.sql
--
-- Cost on a development database: about 30 s for the 3,829 regions including the
-- coverage pass, and 6 m 32 s for the 392,112 administrative divisions. Unlike
-- 008 this is a recompute rather than a fill, so it rewrites every row it
-- touches and a second run does the whole thing again — arriving at the same
-- shapes, and bumping tile_version again. Interrupting is safe and keeps
-- nothing: one transaction, all of it or none.
--
-- Follow it with VACUUM (ANALYZE) on both tables, for the reason 008 gives:
-- every row is rewritten, and until the dead tuples are reclaimed the tile
-- queries scan twice the pages. VACUUM cannot run inside a transaction:
--
--   npm run db:run-sql -- -c 'VACUUM (ANALYZE) regions' \
--                       -c 'VACUUM (ANALYZE) administrative_divisions'

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(t || '.' || c, ', ')
    INTO missing
    FROM (VALUES
        ('regions', 'geom_simplified_coarse'),
        ('administrative_divisions', 'geom_simplified_coarse_3857')
    ) AS want(t, c)
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = want.t AND column_name = want.c
    );

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION
            '% missing — re-apply db/init/01-schema.sql first', missing;
    END IF;

    IF to_regprocedure('drop_small_parts(geometry, double precision)') IS NULL THEN
        RAISE EXCEPTION
            'drop_small_parts() missing — re-apply db/init/01-schema.sql first';
    END IF;
END
$$;

-- Per-row first, which is what the trigger would write. Rows with siblings get
-- overwritten by the coverage pass below; rows without any keep this.
UPDATE regions
SET geom_overview = simplify_for_overview(geom_simplified_low, 50000),
    geom_simplified_coarse = simplify_for_overview(geom_simplified_low, 10000)
WHERE geom_simplified_low IS NOT NULL;

-- The coverage pass, one sibling set at a time — the same statement
-- simplify_coverage_regions() runs, without redoing the 5 km and 1 km rungs it
-- also owns: those are already coverage-clean and rewriting them would cost
-- minutes and change nothing. Hull regions are excluded here as they are there,
-- since their cheap rungs derive from the hull rather than from the coverage.
DO $$
DECLARE
    p record;
    sets integer := 0;
    tol_overview constant double precision := 50000;
    tol_coarse constant double precision := 10000;
BEGIN
    FOR p IN
        SELECT parent_region_id AS id
        FROM regions
        WHERE parent_region_id IS NOT NULL
          AND geom_simplified_low IS NOT NULL
          AND NOT COALESCE(uses_hull, false)
        GROUP BY parent_region_id
        HAVING count(*) >= 2
    LOOP
        UPDATE regions r
        SET geom_overview = sub.overview,
            geom_simplified_coarse = sub.coarse
        FROM (
            SELECT id,
                validate_multipolygon(
                    ST_CoverageSimplify(
                        drop_small_parts(geom_simplified_low, tol_overview * tol_overview),
                        tol_overview
                    ) OVER ()
                ) AS overview,
                validate_multipolygon(
                    ST_CoverageSimplify(
                        drop_small_parts(geom_simplified_low, tol_coarse * tol_coarse),
                        tol_coarse
                    ) OVER ()
                ) AS coarse
            FROM regions
            WHERE parent_region_id = p.id
              AND geom_simplified_low IS NOT NULL
              AND NOT COALESCE(uses_hull, false)
        ) sub
        WHERE r.id = sub.id;
        sets := sets + 1;
    END LOOP;
    RAISE NOTICE 'coverage pass over % sibling set(s)', sets;
END
$$;

-- Divisions get the per-row form only. Every 3857 rung on that table is
-- per-row today — its coverage pass (simplify_coverage_siblings) works on the
-- 4326 columns the GeoJSON API reads — so this rung is no worse off than its
-- neighbours, and making the rendered columns gap-free is #560's work.
UPDATE administrative_divisions
SET geom_overview_3857 = simplify_for_overview(geom_simplified_low_3857, 50000),
    geom_simplified_coarse_3857 = simplify_for_overview(geom_simplified_low_3857, 10000)
WHERE geom_simplified_low_3857 IS NOT NULL;

-- Every tile from zoom 0 to 4 is now built from different geometry while the
-- URLs that produce them are unchanged, so without this an operator gets
-- pre-migration shapes back out of Martin's cache — at cache speed, which reads
-- as the change having landed. `tile_version` is the `_v` the frontend puts on
-- every Martin URL.
-- COALESCE because the column is nullable (DEFAULT 0, no NOT NULL): a row
-- holding NULL would keep it through a bare increment, and its tile URLs would
-- go on carrying the same _v while the geometry underneath them changed.
UPDATE world_views SET tile_version = COALESCE(tile_version, 0) + 1;

-- A rung that came out NULL where the input was not is a bug, not a shape
-- choice: drop_small_parts() keeps the largest piece unconditionally and the
-- topology-preserving simplification cannot annihilate what is left, so nothing
-- should have vanished.
DO $$
DECLARE
    lost integer;
BEGIN
    SELECT
        (SELECT count(*) FROM regions
         WHERE geom_simplified_low IS NOT NULL
           AND (geom_overview IS NULL OR geom_simplified_coarse IS NULL))
      + (SELECT count(*) FROM administrative_divisions
         WHERE geom_simplified_low_3857 IS NOT NULL
           AND (geom_overview_3857 IS NULL OR geom_simplified_coarse_3857 IS NULL))
    INTO lost;

    IF lost > 0 THEN
        RAISE EXCEPTION 'a cheap rung came out empty for % row(s)', lost;
    END IF;
END
$$;

COMMIT;
