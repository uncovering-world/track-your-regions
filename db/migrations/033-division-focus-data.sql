-- 033-division-focus-data.sql
--
-- Give administrative divisions the focus data regions already have (#674):
-- focus_bbox and anchor_point, computed by geometry_focus() -- the one rule --
-- for every division with geometry.
--
-- Why. A division had focus data nowhere, so framing one meant downloading its
-- full geometry and measuring it in the browser: 775 000 vertices for the Far
-- Eastern Federal District, on every click, with a measurement (turf.bbox) that
-- reads anything over the dateline as spanning the world. Stored once at write
-- time, a read is a column read, and the two places that re-derived the answer
-- from raw longitudes with heuristics of their own can read it instead.
--
-- What it writes. The two columns directly, not by re-firing the geom trigger:
-- an UPDATE OF geom over 392 112 rows would drag trigger_simplify_geom and
-- trg_admin_div_geom_3857 through every one of them. The 3857 trigger fires on
-- any UPDATE and guards each branch on IS DISTINCT FROM, which for a 30 MB
-- geometry is a full comparison per row, so it is disabled around the write
-- the way init-db.py already disables it for the bulk load.
--
-- Cost. About five minutes on the dev database (392 112 divisions, 323 M vertices, 319 s measured;
-- the 200 heaviest rows alone take 17 s). One transaction: interrupting rolls
-- back cleanly, and a re-run fills only what is still empty.
--
-- ORDER: after re-applying db/init/01-schema.sql, which defines geometry_focus()
-- and adds the column. The guard refuses otherwise.
--
-- Apply with:
--   npm run db:run-sql -- -v ON_ERROR_STOP=1 < db/migrations/033-division-focus-data.sql

\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('geometry_focus(geometry)') IS NULL THEN
    RAISE EXCEPTION
      'geometry_focus() is missing (#674). Re-apply db/init/01-schema.sql first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'administrative_divisions' AND column_name = 'focus_bbox'
  ) THEN
    RAISE EXCEPTION
      'administrative_divisions.focus_bbox is missing (#674). Re-apply db/init/01-schema.sql first.';
  END IF;
END;
$guard$;

ALTER TABLE administrative_divisions DISABLE TRIGGER trg_admin_div_geom_3857;

-- Rows with a box already were written by the trigger and are current; rows
-- without one may still carry an anchor from the import filler that used to
-- write ST_Centroid(ST_Envelope(geom)) -- a different, worse answer -- so the
-- anchor is rewritten with the box, not left where it was.
UPDATE administrative_divisions d
SET (focus_bbox, anchor_point) = (
  SELECT ARRAY[f.west, f.south, f.east, f.north],
         ST_SetSRID(ST_MakePoint(f.center_lng, f.center_lat), 4326)
  FROM geometry_focus(d.geom) f
)
WHERE d.geom IS NOT NULL
  AND d.focus_bbox IS NULL;

ALTER TABLE administrative_divisions ENABLE TRIGGER trg_admin_div_geom_3857;

-- What a database holding GADM should show afterwards: the only divisions whose
-- box is global are the ones that wrap the pole. On the dev database that is
-- the two rows named Antarctica -- the continent and the country beneath it.
-- Any other row here is a division the trigger's no-children rule got wrong,
-- and a reason to revisit that rule rather than to accept the row.
SELECT d.id, d.name,
       round(d.focus_bbox[1]::numeric, 4) AS west,
       round(d.focus_bbox[3]::numeric, 4) AS east,
       round(ST_X(d.anchor_point)::numeric, 4) AS anchor_lng,
       round(ST_Y(d.anchor_point)::numeric, 4) AS anchor_lat
FROM administrative_divisions d
WHERE d.focus_bbox IS NOT NULL
  AND d.focus_bbox[1] <= d.focus_bbox[3]
  AND d.focus_bbox[3] - d.focus_bbox[1] > near_global_deg()
ORDER BY d.id;

COMMIT;
