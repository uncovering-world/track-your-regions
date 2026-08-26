-- 034-unnamed-gadm-rows.sql
--
-- Give back the polygons the loader folded into their parents, and fill the
-- holes they left above them (#665).
--
-- GADM 4.1 leaves the deepest NAME empty on 2831 rows that carry a valid GID and
-- a polygon. The loader read only the names, so such a row ended one level early
-- and handed its polygon to the district above it -- which was then stored as a
-- leaf holding one tambon while its named siblings arrived afterwards as its
-- children. Nothing unions a leaf's children into anything, so those children
-- reached no ancestor at all: 86 divisions on the dev database are leaves with
-- children (66 Thai districts, all 16 Uruguayan departments, 4 in the United
-- Arab Emirates), and the country polygons above them carry interior rings where
-- their tambons should be -- 54 rings in Thailand's, 20 742 km2 of them, visible
-- as white patches inside the region fill around Nakhon Ratchasima and Surin at
-- zoom 7-8.
--
-- The loader no longer does this: db/gadm_levels.py reads an unnamed level as a
-- division of its own. This file is the repair for a database that already holds
-- the folded rows, and it is written as a repair rather than a recompute on
-- purpose. Recomputing an ancestor from its children is what
-- precalculate-geometries.py does, and it is exactly what times out for half the
-- continents (#459); the change here is additive -- the ancestors are missing
-- area and nothing else -- so each one is unioned with what it was missing.
-- Asia, 7.2 million vertices, takes about twenty seconds that way.
--
-- Runs before or after the next re-application of 01-schema.sql: it adds no DDL
-- and violates no constraint the schema file declares.
--
-- Re-running it is inert, by two guards rather than one. A repaired row is no
-- longer a leaf and carries no gadm_uid, so step 1 does not select it again --
-- that is the ordinary path. The other is a row step 3 could not rebuild: its
-- children carry no geometry, which is every folded row on a database loaded
-- without -g. Such a row keeps its flag and its uid on purpose, so that both the
-- closing report below and the two catalogue checks go on naming it -- clearing
-- them would leave a division standing for one polygon of what is under it and
-- nothing able to say so. Step 2 is what must then not repeat, and it does not:
-- it skips a folded row that already has the child it would insert.
--
-- The geometry triggers stay enabled throughout. Every simplified and 3857
-- column follows the geometry it is derived from, and the coverage-aware pass at
-- the end (simplify_coverage_siblings, the same function
-- precalculate-geometries.py calls) puts the sibling groups back to gap-free
-- borders, since the per-row trigger result would show slivers against
-- neighbours simplified the other way.
--
-- What it cannot repair is a polygon that never reached the database at all. 24
-- of GADM's 356 508 did not: 21 to name paths that resolve to more than one GID
-- (Cambodia 8, Spain 6, South Korea 4, Mexico 2, Cote d'Ivoire 1 -- mostly names
-- the source truncates to a common prefix), and 3 more where the folded district
-- had a single same-named child, so merge_single_children deleted the district
-- and took its polygon with it. This file moves polygons that are here. The
-- loader change recovers those 3 on the next load; the 21 want a repair of their
-- own (#681). On the dev database they leave Thailand two interior rings, 379 km2 of
-- them at Bang Sai in Phra Nakhon Si Ayutthaya, where 54 rings and 20 742 km2
-- stood before.
--
-- Forty minutes on the dev database, measured, almost all of it two rows: rewriting
-- Asia (7.2 million vertices) and South America drags each through a union, a
-- validity pass, two simplifications, a reprojection, three more simplifications
-- and a focus measurement -- the same work the loader does for every row it
-- writes, on the two largest there are. The regions mirroring them cost the same
-- again. Everything else is seconds.

\set ON_ERROR_STOP on

BEGIN;

-- No time limit: the two continent unions are the long pole and a session
-- default would abort them halfway.
SET LOCAL statement_timeout = 0;

-- ---------------------------------------------------------------------------
-- 1. The rows that were folded into
-- ---------------------------------------------------------------------------
-- A division marked as a leaf, carrying one GADM polygon of its own, with
-- children hanging under it. All three at once is the signature: a leaf with no
-- children is an ordinary leaf, and a parent carrying no gadm_uid is an ordinary
-- parent whose geometry is a union.

CREATE TEMP TABLE folded_division ON COMMIT DROP AS
SELECT d.id, d.name, d.parent_id, d.gadm_uid, d.geom
  FROM administrative_divisions d
 WHERE d.has_children = false
   AND d.gadm_uid IS NOT NULL
   AND EXISTS (SELECT 1 FROM administrative_divisions c WHERE c.parent_id = d.id);

-- A folded row inside another folded row would be repaired out of order: step 3
-- would rebuild the outer one from the inner one's *pre-repair* geometry, and
-- step 5 skips it for being in this list, so it would keep the hole while
-- looking repaired -- has_children set, gadm_uid cleared, out of the closing
-- report and out of both catalogue checks. No such pair exists in GADM 4.1
-- (measured: 0 of the 86), so rather than order the steps for a case the data
-- does not have, this refuses to run on one.

DO $nested$
DECLARE
    nested_count integer;
BEGIN
    WITH RECURSIVE up AS (
        SELECT f.id AS folded_id, d.parent_id AS ancestor_id
          FROM folded_division f JOIN administrative_divisions d ON d.id = f.id
         WHERE d.parent_id IS NOT NULL
        UNION
        SELECT u.folded_id, a.parent_id
          FROM up u JOIN administrative_divisions a ON a.id = u.ancestor_id
         WHERE a.parent_id IS NOT NULL
    )
    SELECT count(*) INTO nested_count
      FROM up WHERE ancestor_id IN (SELECT id FROM folded_division);

    IF nested_count > 0 THEN
        RAISE EXCEPTION 'One folded division sits inside another (% pairs). This file '
                        'repairs them in one pass and would rebuild the outer one from '
                        'the inner one''s old geometry. Repair the inner ones first.',
                        nested_count;
    END IF;
END
$nested$;

-- ---------------------------------------------------------------------------
-- 2. The folded polygon becomes the division it always was
-- ---------------------------------------------------------------------------
-- Called after the row it was folded into, with " (rest)" on the end, because
-- that is what it holds: the part of that row the named units beneath it leave
-- over. Every row repaired here has other children by definition -- being a leaf
-- with children is what put it in the list -- so this is exactly the case the
-- loader labels too (`remainder_label` in db/gadm_levels.py, which is where the
-- wording is decided). Without it the tree offers the same name twice, one
-- inside the other, and in twenty of the Thai districts repaired here three
-- times, since a tambon GADM *does* name carries it as well. Twenty rather than
-- the file's 23: three of them turn on a polygon that never reached the database
-- (#681), so the district they belong to is not in this list.
--
-- The derived columns are filled by the triggers on insert and settled by the
-- coverage pass at the end.

INSERT INTO administrative_divisions (name, parent_id, has_children, gadm_uid, geom)
SELECT f.name || ' (rest)', f.id, false, f.gadm_uid, f.geom
  FROM folded_division f
 WHERE NOT EXISTS (SELECT 1 FROM administrative_divisions c
                    WHERE c.parent_id = f.id AND c.gadm_uid = f.gadm_uid);

-- ---------------------------------------------------------------------------
-- 3. The row that held it becomes the parent it always was
-- ---------------------------------------------------------------------------
-- Its geometry is now the union of its children -- the tambons that reached no
-- ancestor, plus the remainder just materialised beside them. It carries no
-- gadm_uid any more: a division with children is a union rather than one row of
-- the source, which is the shape the loader writes and the shape the catalogue
-- check asserts.

UPDATE administrative_divisions d
   SET geom = u.geom,
       has_children = true,
       gadm_uid = NULL,
       updated_at = NOW()
  FROM (
        SELECT f.id, validate_multipolygon(ST_Union(c.geom)) AS geom
          FROM folded_division f
          JOIN administrative_divisions c ON c.parent_id = f.id
         WHERE c.geom IS NOT NULL
         GROUP BY f.id
       ) u
 WHERE d.id = u.id
   AND u.geom IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Which divisions gained what
-- ---------------------------------------------------------------------------
-- A repaired division gains its own new outline; every ancestor of it gains the
-- same shape, since a parent is the union of what is under it. Ids only in the
-- walk -- carrying geometry up a recursive CTE would copy a continent per level.

CREATE TEMP TABLE division_delta ON COMMIT DROP AS
WITH RECURSIVE up AS (
    SELECT f.id AS division_id, f.id AS repaired_id
      FROM folded_division f
    UNION
    SELECT d.parent_id, u.repaired_id
      FROM up u
      JOIN administrative_divisions d ON d.id = u.division_id
     WHERE d.parent_id IS NOT NULL
)
SELECT division_id, repaired_id FROM up;

-- ---------------------------------------------------------------------------
-- 5. Fill the holes above
-- ---------------------------------------------------------------------------
-- Union rather than recompute: what an ancestor is missing is area and only
-- area, so adding it back is one overlay against a shape that is otherwise
-- right, where rebuilding a continent from fifty countries is the operation that
-- does not finish (#459). An ancestor with no geometry at all is left alone --
-- it has nothing to fill and is a different defect, which the catalogue check
-- for a region with no geometry already reports.

UPDATE administrative_divisions a
   SET geom = validate_multipolygon(ST_Union(a.geom, delta.geom)),
       updated_at = NOW()
  FROM (
        SELECT dd.division_id, ST_Union(r.geom) AS geom
          FROM division_delta dd
          JOIN administrative_divisions r ON r.id = dd.repaired_id
         WHERE dd.division_id NOT IN (SELECT id FROM folded_division)
         GROUP BY dd.division_id
       ) delta
 WHERE a.id = delta.division_id
   AND a.geom IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. The regions built on those divisions
-- ---------------------------------------------------------------------------
-- A region's geometry is the union of the divisions it holds, so a region
-- holding a repaired division -- or any ancestor of one -- carries the same
-- hole. The "Administrative" world view mirrors GADM one member per region,
-- which is how the holes reach the tiles Martin serves.
--
-- Rebuilt from what it is made of rather than unioned with the delta, which is
-- the one place divisions and regions differ. A division's own geometry and its
-- children's are the same polygons noded the same way, so adding the missing
-- area back leaves them clean. A region's is not: this world view's Thailand was
-- computed from its 77 province regions, and unioning that with district
-- polygons of another provenance left 2292 interior rings along the seams, 836
-- of them under a hectare, where the division it mirrors came out with two --
-- its lakes.
--
-- What a region is made of is its direct members *and* the regions under it,
-- unioned -- `geometryComputeSingle` collects both, and a region can hold a
-- division directly while also having children (the editor's "Move to parent"
-- makes exactly that shape; 8 of the regions here are it). Members alone would
-- silently drop every child's area from those.
--
-- Deepest first, because a parent takes its children's shape and a parent
-- rebuilt before them would take their old one.
--
-- `custom_geom` is honoured rather than skipped: a curator's cut of a division
-- is what that member contributes, and it goes in as drawn. The cut was drawn
-- against a division that has since grown, though, so those regions are listed
-- at the end for a person to look at.
--
-- A region whose *whole boundary* was drawn by hand is skipped outright. It was
-- never traced from what is inside it, so nothing inside it can make it wrong --
-- which is the product's own rule, and `handleCustomBoundary` is where the
-- compute path states it: a custom boundary keeps its geometry unless somebody
-- forces a recompute. Rewriting one here would replace a curator's work with the
-- union of its parts, silently and with no copy kept. It is listed at the end
-- instead. Where such a region holds a member carrying its own cut the compute
-- path *does* rebuild it; that is a curator's press in the panel, not a
-- migration's decision.

CREATE TEMP TABLE region_delta ON COMMIT DROP AS
WITH RECURSIVE up AS (
    SELECT m.region_id
      FROM region_members m
      JOIN division_delta dd ON dd.division_id = m.division_id
    UNION
    SELECT r.parent_region_id
      FROM up u
      JOIN regions r ON r.id = u.region_id
     WHERE r.parent_region_id IS NOT NULL
)
SELECT region_id FROM up;

-- `regions` carries `created_at` and no `updated_at`, unlike
-- `administrative_divisions`; the geometry columns beside it are maintained by
-- its triggers, which fire on this write.
DO $rebuild$
DECLARE
    level_ids integer[];
BEGIN
    FOR level_ids IN
        WITH RECURSIVE depth AS (
            SELECT id, 0 AS d FROM regions WHERE parent_region_id IS NULL
            UNION ALL
            SELECT r.id, depth.d + 1
              FROM regions r JOIN depth ON r.parent_region_id = depth.id
        )
        SELECT array_agg(depth.id)
          FROM depth
          JOIN region_delta rd ON rd.region_id = depth.id
         GROUP BY depth.d
         ORDER BY depth.d DESC
    LOOP
        UPDATE regions g
           SET geom = validate_multipolygon(src.geom)
          FROM (
                SELECT rd.region_id, ST_Union(parts.geom) AS geom
                  FROM unnest(level_ids) AS rd(region_id)
                  JOIN LATERAL (
                        SELECT COALESCE(m.custom_geom, d.geom) AS geom
                          FROM region_members m
                          JOIN administrative_divisions d ON d.id = m.division_id
                         WHERE m.region_id = rd.region_id
                           AND (m.custom_geom IS NOT NULL OR d.geom IS NOT NULL)
                         UNION ALL
                        SELECT c.geom
                          FROM regions c
                         WHERE c.parent_region_id = rd.region_id
                           AND c.geom IS NOT NULL
                       ) parts ON true
                 GROUP BY rd.region_id
               ) src
         WHERE g.id = src.region_id
           AND g.geom IS NOT NULL
           AND g.is_custom_boundary IS NOT TRUE
           AND src.geom IS NOT NULL;
    END LOOP;
END
$rebuild$;

-- ---------------------------------------------------------------------------
-- 7. Gap-free borders again
-- ---------------------------------------------------------------------------
-- The triggers gave every changed row a per-row simplification, which is the
-- fallback rather than the answer: neighbours simplified independently pull
-- apart at low zoom and the map shows a white sliver between them. These are the
-- same two functions precalculate-geometries.py and the world-view computation
-- call, run over exactly the sibling groups that changed.

SELECT simplify_coverage_siblings(parent_id)
  FROM (
        SELECT DISTINCT d.parent_id
          FROM administrative_divisions d
         WHERE d.parent_id IS NOT NULL
           AND (d.id IN (SELECT division_id FROM division_delta)
                OR d.parent_id IN (SELECT id FROM folded_division))
       ) groups;

SELECT simplify_coverage_regions(parent_region_id)
  FROM (
        SELECT DISTINCT r.parent_region_id
          FROM regions r
         WHERE r.parent_region_id IS NOT NULL
           AND r.id IN (SELECT region_id FROM region_delta)
       ) groups;

-- ---------------------------------------------------------------------------
-- 8. What it did
-- ---------------------------------------------------------------------------

SELECT (SELECT count(*) FROM folded_division)                       AS divisions_repaired,
       (SELECT count(DISTINCT division_id) FROM division_delta)     AS divisions_refilled,
       (SELECT count(DISTINCT region_id) FROM region_delta)         AS regions_refilled;

-- Every leaf that still has children. Zero, or the repair did not cover it.
SELECT d.id, d.name,
       (SELECT count(*) FROM administrative_divisions c WHERE c.parent_id = d.id) AS children
  FROM administrative_divisions d
 WHERE d.has_children = false
   AND EXISTS (SELECT 1 FROM administrative_divisions c WHERE c.parent_id = d.id)
 ORDER BY d.name;

-- Regions left for a person. The first have geometry and no members of their
-- own, so there was nothing to rebuild them from here: their shape comes from
-- the regions under them and wants a world-view computation. The second hold a
-- curator's cut of a division that has just grown, which went in as drawn and
-- may no longer be the cut that was meant.
SELECT r.id, r.name, w.name AS world_view, 'nothing to rebuild it from' AS why
  FROM region_delta rd
  JOIN regions r ON r.id = rd.region_id
  JOIN world_views w ON w.id = r.world_view_id
 WHERE r.geom IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM region_members m WHERE m.region_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM regions c WHERE c.parent_region_id = r.id AND c.geom IS NOT NULL)
 UNION ALL
SELECT r.id, r.name, w.name, 'its whole boundary is hand-drawn and was left as drawn'
  FROM region_delta rd
  JOIN regions r ON r.id = rd.region_id
  JOIN world_views w ON w.id = r.world_view_id
 WHERE r.is_custom_boundary IS TRUE
 UNION ALL
SELECT r.id, r.name, w.name, 'holds a hand-drawn cut of a division that grew'
  FROM region_members m
  JOIN regions r ON r.id = m.region_id
  JOIN world_views w ON w.id = r.world_view_id
 WHERE m.custom_geom IS NOT NULL
   AND m.division_id IN (SELECT division_id FROM division_delta)
 ORDER BY 3, 2;

COMMIT;
