-- 008: Backfill the overview LOD columns —
--      regions.geom_overview and administrative_divisions.geom_overview_3857.
--
-- `01-schema.sql` adds the column, the simplify_for_overview() helper and the
-- trigger line that maintains it, so re-applying that file is enough to make
-- new and edited regions correct. Rows already in the table keep a NULL there
-- until something writes to them, and NULL means "not computed" — the tile
-- functions fall back to geom_simplified_low at overview zoom, which is what
-- they did before and costs what it cost before. This file fills them in.
--
-- Apply after re-applying 01-schema.sql:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/008-overview-lod-backfill.sql
--
-- Cost on a development database: about 23 s for the 3,829 regions and roughly
-- nine minutes for the 392,112 administrative divisions. It runs in one
-- transaction and writes two things: the overview columns, and — only if it
-- filled at least one row — world_views.tile_version, to retire the tile URLs
-- that would otherwise serve pre-backfill shapes from Martin's cache.
--
-- Interrupting is safe because of that single transaction, not because progress
-- is preserved: an interrupt at minute eight of nine rolls back every row it had
-- filled, and the next run starts from the beginning. Re-running once it has
-- completed is cheap for a different reason — both backfills skip rows that
-- already have a value, so a second run finds nothing, writes nothing, and
-- leaves tile_version alone.
--
-- Follow it with VACUUM (ANALYZE) on both tables. Updating every row leaves as
-- many dead tuples behind, and until they are reclaimed the tile queries scan
-- twice the pages — measured at 20-57 s per overview tile immediately after the
-- backfill, against 0.1-1.4 s once vacuumed. VACUUM cannot run inside the
-- transaction, so it is not scripted here:
--
--   npm run db:run-sql -- -c 'VACUUM (ANALYZE) regions' \
--                       -c 'VACUUM (ANALYZE) administrative_divisions'
--
-- Martin's own in-memory cache needs no separate step: this file bumps
-- world_views.tile_version, which changes the `_v` on every tile URL the
-- frontend requests.

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(t || '.' || c, ', ')
    INTO missing
    FROM (VALUES
        ('regions', 'geom_overview'),
        ('administrative_divisions', 'geom_overview_3857')
    ) AS want(t, c)
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = want.t AND column_name = want.c
    );

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION
            '% missing — re-apply db/init/01-schema.sql first', missing;
    END IF;
END
$$;

-- The trigger that maintains this column fires on geometry changes only, and
-- this write sets no geometry, so it will not re-enter. Rows whose
-- geom_simplified_low is NULL keep a NULL overview, matching the trigger.
DO $$
DECLARE
    just_filled integer;
    filled integer := 0;
BEGIN
    UPDATE regions
    SET geom_overview = simplify_for_overview(geom_simplified_low)
    WHERE geom_simplified_low IS NOT NULL
      AND geom_overview IS NULL;
    GET DIAGNOSTICS just_filled = ROW_COUNT;
    filled := filled + just_filled;

    UPDATE administrative_divisions
    SET geom_overview_3857 = simplify_for_overview(geom_simplified_low_3857)
    WHERE geom_simplified_low_3857 IS NOT NULL
      AND geom_overview_3857 IS NULL;
    GET DIAGNOSTICS just_filled = ROW_COUNT;
    filled := filled + just_filled;

    -- Bust Martin's tile cache, but only if the shapes actually changed. Every
    -- zoom 0-2 tile is now built from different geometry while the URLs that
    -- produce them are unchanged, so without this an operator gets pre-backfill
    -- shapes back out of cache — at cache speed, which reads as the change
    -- having landed. `tile_version` is the `_v` the frontend puts on every
    -- Martin URL, so bumping it unconditionally would make a second run throw
    -- away a warm cache for nothing. Safe inside this transaction: plain integer
    -- column, no triggers on world_views.
    IF filled > 0 THEN
        UPDATE world_views SET tile_version = tile_version + 1;
        RAISE NOTICE 'backfilled % row(s); bumped tile_version', filled;
    ELSE
        RAISE NOTICE 'nothing to backfill; tile_version left alone';
    END IF;
END
$$;

DO $$
DECLARE
    remaining integer;
BEGIN
    SELECT
        (SELECT count(*) FROM regions
         WHERE geom_simplified_low IS NOT NULL AND geom_overview IS NULL)
      + (SELECT count(*) FROM administrative_divisions
         WHERE geom_simplified_low_3857 IS NOT NULL AND geom_overview_3857 IS NULL)
    INTO remaining;

    IF remaining > 0 THEN
        RAISE EXCEPTION 'overview LOD still NULL for % row(s)', remaining;
    END IF;
END
$$;

COMMIT;
