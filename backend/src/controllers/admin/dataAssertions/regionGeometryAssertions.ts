/**
 * What must be true of a region's own shape, its focus box and its anchor.
 *
 * Two geometry defects were found in one week by a person looking at a map and
 * by nothing else in the repository (#668). Three regions of the Administrative
 * world view held a focus box claiming every longitude on Earth, so selecting
 * the Far Eastern Federal District framed the whole globe, anchored at 0°E in
 * the North Sea (#666). Four of the eight top-level regions of the same world
 * view held a geometry covering a fraction of what they contain — North America
 * is 18.3 % of its children — and two countries carried no geometry at all
 * (#667). A third arrived the same way: the rung the map serves drew 66 holes
 * over north-eastern Thailand where the data has 8, because the simplification
 * that made it was not topology-preserving (#685). Every run had reported
 * success. These five rules are the resting-state check the other lanes cannot
 * be: they read the rows.
 *
 * The first is the one that must not be a second copy of the trigger's own
 * arithmetic, or it would agree with the trigger on every row the trigger got
 * wrong. It measures the geometry a different way: which 10-degree bands of
 * longitude the region's parts occupy, and how wide the widest empty stretch
 * between them is round the circle.
 */

import type { CatalogueAssertion } from './assertion.js';
import { count, text } from './assertion.js';

/** A degree band the sweep works in: 36 of them round the circle. */
const BAND_DEGREES = 10;
const BANDS = 360 / BAND_DEGREES;

/**
 * How much of a world view has to be computed before a region without geometry
 * is a hole rather than an import in progress.
 *
 * A single computed region cannot admit the world view: one region of the
 * in-flight Wikivoyage import computed on demand would turn this rule from two
 * rows into four thousand. Nine tenths, and the Administrative world view sits
 * at 99.9 % while Wikivoyage sits at 0 %.
 */
const COMPUTED_SHARE = 0.9;

/**
 * A region framed as the whole world while its geometry is not.
 *
 * The stored box is global (west <= east and wider than `near_global_deg()`, the
 * shape `geometry_focus()` files a shape as when it is wide however it is
 * measured),
 * yet the region's parts leave at least two bands — 20° of longitude — with no
 * part of the region in them, so a window of 340° or less existed. GADM splits
 * a polygon at the antimeridian, so a part's own bbox never crosses it and the
 * bands a part touches are the ones between its plain min and max. Antarctica's
 * two rows occupy 36 of 36 bands and are not reported; Fiji's geometry leaves
 * 34 empty, Russia's 19 — either would be reported the day its stored box went
 * global again. Only rows with a global stored box are dumped, so this is cheap.
 *
 * The shape swept is `COALESCE(hull_geom, geom)`, which is what the trigger
 * measured: a concave hull bridges the gaps between the parts it wraps, so a
 * hull region's hull covers longitudes its `geom` does not, and sweeping the
 * geometry alone would report a hull region whose box is right. Sharing the
 * trigger's *input* is not sharing its arithmetic, which is what independence
 * means here. Same reason for `near_global_deg()`: the threshold is the
 * schema's, stated once (#674), and restating 350 here would let it drift.
 */
const framedAsTheWorld: CatalogueAssertion = {
  id: 'framed-as-the-world',
  area: 'regions',
  title: 'A region framed as the whole world while its geometry is not',
  kind: 'invariant',
  meaning:
    'Selecting the region frames the entire globe at zoom 1, the region cut in two against the '
    + 'edges, and its anchor point sits at 0°E in whichever ocean that is. Re-fire the focus '
    + 'trigger for the row (SET hull_geom = hull_geom). If the box comes back global it is not '
    + 'necessarily a regression: the trigger measures in two frames only, so a leaf reaching '
    + 'both meridians is global by construction, and a parent whose children\'s boxes close the '
    + 'circle keeps its own global box (children_focus_arc, covers_globe). Either way a window '
    + 'of 340° or less exists and the map is framing more than it needs to (#666, #673).',
  sql: `WITH global_box AS (
          SELECT r.id, r.name, r.world_view_id, r.geom, r.hull_geom
            FROM regions r
           WHERE r.geom IS NOT NULL
             AND r.focus_bbox IS NOT NULL
             AND r.focus_bbox[1] <= r.focus_bbox[3]
             AND r.focus_bbox[3] - r.focus_bbox[1] > near_global_deg()
        ),
        parts AS (
          SELECT g.id, (ST_Dump(COALESCE(g.hull_geom, g.geom))).geom AS part FROM global_box g
        ),
        bands AS (
          SELECT DISTINCT p.id, b
            FROM parts p
           CROSS JOIN LATERAL generate_series(
                 GREATEST(floor((ST_XMin(p.part) + 180) / ${BAND_DEGREES})::int, 0),
                 LEAST(floor((ST_XMax(p.part) + 180) / ${BAND_DEGREES})::int, ${BANDS - 1})) AS b
        ),
        occupied AS (
          SELECT id, array_agg(b ORDER BY b) AS bs FROM bands GROUP BY id
        ),
        empty_run AS (
          SELECT o.id, MAX(run) AS widest
            FROM occupied o
           CROSS JOIN LATERAL (
                 SELECT next_b - b - 1 AS run
                   FROM (SELECT b, LEAD(b) OVER (ORDER BY b) AS next_b FROM unnest(o.bs) AS b) s
                  WHERE next_b IS NOT NULL
                 UNION ALL
                 SELECT (o.bs[1] + ${BANDS}) - o.bs[array_length(o.bs, 1)] - 1
               ) runs
           GROUP BY o.id
        )
        SELECT g.id AS region_id,
               g.name AS region_name,
               w.name AS world_view_name,
               e.widest * ${BAND_DEGREES} AS empty_degrees
          FROM global_box g
          JOIN empty_run e ON e.id = g.id
          JOIN world_views w ON w.id = g.world_view_id
         WHERE e.widest >= 2
         ORDER BY e.widest DESC, g.name`,
  describe: row =>
    `${text(row, 'region_name')} (${text(row, 'world_view_name')}): framed as the whole world, `
    + `though ${count(row, 'empty_degrees')}° of longitude hold no part of it `
    + `(region ${count(row, 'region_id')})`,
};

/**
 * A region whose anchor is nowhere near it.
 *
 * A watch, not an invariant, and reading its rows as a traveller says why: the
 * United Kingdom's box centre is in the Atlantic because the Falklands and Saint
 * Helena are in the box, France's because of Réunion and French Guiana, Japan's
 * because of the Ogasawara islands, and Antarctica's continent row because the
 * centre of a box round the pole is the Southern Ocean. Those anchors are
 * right — the frame is right — so there is nothing to answer for. The number
 * is worth watching because the Far Eastern Federal District (anchored off
 * Shetland) and Fiji (off Namibia) were on this list until #671, and a
 * regression would put them back.
 *
 * Measured on the 3857 low rung with the tolerance scaled by latitude, because
 * the exact distance on geography over full-resolution polygons costs sixteen
 * seconds for one run and this costs a quarter of one. The scaling is Mercator's
 * — a metre on the ground is 1/cos(lat) map metres — and puts a row within a
 * few kilometres of the line on either side of it; a watch tolerates that.
 */
const anchorFarFromItsRegion: CatalogueAssertion = {
  id: 'anchor-far-from-its-region',
  area: 'regions',
  title: 'A region whose anchor point is more than 500 km from its own geometry',
  kind: 'watch',
  meaning:
    'The map centres the camera here when the region is selected and a crossing box is framed. '
    + 'For a scattered territory the centre of the box is open water and that is right; a '
    + 'mainland region on this list has its anchor in the wrong ocean (#666). Legitimate rows '
    + 'stand still; a mainland name appearing here is what to look at.',
  sql: `SELECT r.id AS region_id,
               r.name AS region_name,
               w.name AS world_view_name,
               round((ST_Distance(r.geom_simplified_low, ST_Transform(r.anchor_point, 3857))
                      * cos(radians(ST_Y(r.anchor_point))) / 1000)::numeric) AS about_km
          FROM regions r
          JOIN world_views w ON w.id = r.world_view_id
         WHERE r.anchor_point IS NOT NULL
           AND r.geom_simplified_low IS NOT NULL
           AND abs(ST_Y(r.anchor_point)) < 85
           AND NOT ST_DWithin(r.geom_simplified_low,
                              ST_Transform(r.anchor_point, 3857),
                              500000 / cos(radians(ST_Y(r.anchor_point))))
         ORDER BY about_km DESC, r.name`,
  describe: row =>
    `${text(row, 'region_name')} (${text(row, 'world_view_name')}): anchored about `
    + `${count(row, 'about_km')} km from its nearest edge (region ${count(row, 'region_id')})`,
};

/**
 * A parent region that omits what its children hold.
 *
 * #667's class: a parent's geometry is computed once and never again when a
 * child's changes, so a continent can end up as a fraction of the countries
 * under it. Summing the children double-counts a division two of them hold —
 * nothing enforces a partition within a world view, and the Wikivoyage import
 * accepts a match its own coverage check flagged as a conflict — so a row can
 * also mean overlapping siblings rather than a stale parent, which is why the
 * meaning says to look before recomputing. No such pair exists on the dev
 * catalogue today (measured: 0 sibling pairs share a division), so the rows it
 * reports are all #667's — three of them at the last measurement, down from the
 * four it opened with as each continent's union finishes inside the timeout. The stored areas are compared —
 * `geom_area_km2` is written by the metadata trigger beside the geometry, so it
 * is stale exactly when the geometry is, which is what this asks about —
 * rather than ST_Area on the fly,
 * which costs fifty seconds over the catalogue where this costs fifty
 * milliseconds. Nine tenths, because a parent's union legitimately loses
 * slivers and holes its children's outlines carry.
 */
const parentShortOfItsChildren: CatalogueAssertion = {
  id: 'parent-short-of-its-children',
  area: 'regions',
  title: 'A parent region whose geometry covers less than nine tenths of what its children hold',
  kind: 'invariant',
  meaning:
    'Either the parent is drawn as a fraction of itself — a hole where a child was added or '
    + 'regrown after the parent was last computed, which recomputing the parent clears (#667) — '
    + 'or two of its children hold the same division and the sum double-counts it, which '
    + 'recomputing will not clear: the parent\'s own area is the union and is right. Check the '
    + 'children for a shared member before recomputing.',
  sql: `SELECT p.id AS region_id,
               p.name AS region_name,
               w.name AS world_view_name,
               round(p.geom_area_km2::numeric) AS parent_km2,
               round(ch.km2::numeric) AS children_km2,
               round((100 * p.geom_area_km2 / ch.km2)::numeric, 1) AS percent
          FROM regions p
          JOIN world_views w ON w.id = p.world_view_id
          JOIN LATERAL (
                 SELECT sum(c.geom_area_km2) AS km2
                   FROM regions c
                  WHERE c.parent_region_id = p.id
                    AND c.geom_area_km2 IS NOT NULL
               ) ch ON true
         WHERE p.geom_area_km2 IS NOT NULL
           AND ch.km2 > 0
           AND p.geom_area_km2 < 0.9 * ch.km2
         ORDER BY percent, p.name`,
  describe: row =>
    `${text(row, 'region_name')} (${text(row, 'world_view_name')}): ${text(row, 'percent')} % of `
    + `its children — ${count(row, 'parent_km2').toLocaleString('en')} km² against `
    + `${count(row, 'children_km2').toLocaleString('en')} km² (region ${count(row, 'region_id')})`,
};

/**
 * A region of a computed world view with no geometry at all.
 *
 * A hole rather than an import that never ran, and the qualifier is what
 * separates them: most of the world view has to be computed. Existence of one
 * computed region would not do — `geometryComputeSingle` computes one region on
 * demand, so a curator's first click on the in-flight Wikivoyage import (4 301
 * regions, none computed) would turn this rule into four thousand rows of the
 * wrong question. The Administrative world view sits at 99.9 % and answers
 * Canada, one row of 3 831 (#667).
 *
 * A region awaiting recompute still shows here, and should. Any write to
 * `regions.geom` marks the derived ancestors above it stale — the database does
 * it, from `trg_regions_geom_invalidates_parent` (ADR-0035) — because a parent
 * is the union of children one of which has just changed; and an edit to a
 * region's members nulls that region's own geometry too
 * (`invalidateRegionGeometry()`), which is the same write and so reaches the
 * same ancestors. Computing anything under a continent therefore parks the
 * continent here until the next world-view run takes it bottom-up.
 * That *is* a region with nothing on the map — the panel reporting it is the
 * reminder to finish the job, and the count falls back on its own.
 */
const regionWithoutGeometry: CatalogueAssertion = {
  id: 'region-without-geometry',
  area: 'regions',
  title: 'A region with no geometry, in a world view whose geometry has been computed',
  kind: 'invariant',
  meaning:
    'The region is a name with nothing on the map: it cannot be drawn, framed or matched, '
    + 'and its parent is short by exactly this much. Compute its geometry, or look at why the '
    + 'computation skipped it (#667).',
  sql: `WITH computed AS (
          SELECT world_view_id
            FROM regions
           GROUP BY world_view_id
          HAVING count(geom) > ${COMPUTED_SHARE} * count(*)
        )
        SELECT r.id AS region_id,
               r.name AS region_name,
               w.name AS world_view_name,
               parent.name AS parent_name
          FROM regions r
          JOIN computed c ON c.world_view_id = r.world_view_id
          JOIN world_views w ON w.id = r.world_view_id
          LEFT JOIN regions parent ON parent.id = r.parent_region_id
         WHERE r.geom IS NULL
         ORDER BY w.name, r.name`,
  describe: row => {
    const parent = text(row, 'parent_name');
    const under = parent ? `, under ${parent}` : '';
    return `${text(row, 'region_name')} (${text(row, 'world_view_name')}): no geometry at all`
      + `${under} (region ${count(row, 'region_id')})`;
  },
};

/**
 * A display rung that is not the shape it was made from, only coarser.
 *
 * The fifth rule, and the one a person found by looking at the map rather than
 * at anything here: north-eastern Thailand was drawn with 66 holes in it where
 * the data has 8 (#685). `ST_SimplifyVW` moves every ring on its own, so a
 * simplified outline crosses itself and two parts that were disjoint come to
 * overlap — and the `ST_MakeValid` every geometry write ends with then resolves
 * the overlap the only way it can, by carving it out as an interior ring. The
 * eight root regions of the Administrative world view hold 610 interior rings
 * between them and their 1 km rung carried 1,933.
 *
 * That pass failed the same shape twice, so the rule is asked twice. It also
 * **annihilated** a ring narrower than its tolerance, and the vertex floor then
 * dropped what came back degenerate: 436 of Asia's 26,151 pieces went at the
 * 1 km rung, against rule 12. So a rung may not gain a hole, and may not lose a
 * piece — except at the two cheap rungs, where dropping a piece below the rung's
 * own scale is the decision ADR-0031 took, and where only the holes half is
 * asked.
 *
 * Both halves are exact rather than thresholds, because simplification does not
 * add rings and the rungs at 5 km and finer keep every part. And the second half
 * is what a *library* change would trip: `ST_CoverageSimplify` neither drops a
 * piece nor closes a hole on PostGIS 3.5.6 / GEOS 3.14.1 — measured, a 100 m
 * speck 50 km from a square and a 200 m lake inside it both survive a 5 km
 * pass — but `docker-compose.yml` pins `postgis/postgis:17-3.5-alpine`, which
 * floats GEOS. This is the rule that notices when it stops being true.
 *
 * Counting rings and parts is not a second copy of what the pass computes, so
 * this cannot agree with a broken writer the way a re-derivation would. What it
 * does share is the *input*: the low and medium rungs of a hull region come from
 * its hull, so comparing them against `geom_3857` would report every hull region
 * whose rungs are right — a concave hull bridges the gaps between the parts it
 * wraps and can enclose a lagoon the geometry leaves open. Sharing the trigger's
 * input is not sharing its arithmetic, the same distinction `framedAsTheWorld`
 * makes above. The `_real` pair is always made from the real geometry, hull or
 * no hull, so it is compared against that.
 *
 * It is the only rule here that reads a full-resolution column for *every* row —
 * `framedAsTheWorld` above reads one too, but only for the rows whose stored box
 * is already global — and that is the whole of its cost: one PostGIS call over `regions.geom_3857` detoasts
 * 11.7 M points and takes 2.6 s, against 0.35 s for all six rungs together, and
 * there is no stored ring count to read instead the way
 * `parentShortOfItsChildren` reads `geom_area_km2`. Two things were tried and
 * only one paid. `MATERIALIZED` is load-bearing: without it the planner inlines
 * the CTE and re-reads the source for every rung named below, 20 s a run against
 * 8. Hoisting each column's two calls into a lateral so they might share one
 * detoast is not — measured at 8.1 s against 8.4 s, because each call detoasts
 * on its own regardless — so the plainer form stands.
 *
 * `administrative_divisions` is not covered, and its rendered rungs come off the
 * same function. Reading its full-resolution column is what would cost: the
 * eight root divisions weigh 386 MB between them (ADR-0031 decision 5) against
 * a report that answers in seconds. What holds the rule there is
 * `renderedRungTopology.test.ts`, which reads the schema rather than the rows.
 */
const rungUnlikeItsSource: CatalogueAssertion = {
  id: 'rung-unlike-its-source',
  area: 'regions',
  title: 'A display rung drawing holes its source has not, or missing pieces its source has',
  kind: 'invariant',
  meaning:
    'The map draws white blobs inside the region at the zooms that rung serves, or leaves out '
    + 'islands the region has — neither is in any data, only in the pass that made the rung. '
    + 'Rebuild the rungs with db/migrations/037-topology-preserving-rungs.sql (#685, ADR-0036). '
    + 'A row still here after that means whatever wrote the rung is losing shape again, rather '
    + 'than a backlog — and a missing piece on a rung of 5 km or finer is the shape a PostGIS or '
    + 'GEOS upgrade would arrive in, since the image tag floats.',
  sql: `WITH shape AS MATERIALIZED (
          SELECT r.id, r.name, r.world_view_id,
                 ST_NRings(eff.g) - ST_NumGeometries(eff.g)             AS own_rings,
                 ST_NumGeometries(eff.g)                                AS own_parts,
                 ST_NRings(r.geom_3857) - ST_NumGeometries(r.geom_3857) AS real_rings,
                 ST_NumGeometries(r.geom_3857)                          AS real_parts,
                 ST_NRings(r.geom_simplified_medium)
                   - ST_NumGeometries(r.geom_simplified_medium)         AS medium_rings,
                 ST_NumGeometries(r.geom_simplified_medium)             AS medium_parts,
                 ST_NRings(r.geom_simplified_low)
                   - ST_NumGeometries(r.geom_simplified_low)            AS low_rings,
                 ST_NumGeometries(r.geom_simplified_low)                AS low_parts,
                 ST_NRings(r.geom_simplified_coarse)
                   - ST_NumGeometries(r.geom_simplified_coarse)         AS coarse_rings,
                 ST_NRings(r.geom_overview)
                   - ST_NumGeometries(r.geom_overview)                  AS overview_rings,
                 ST_NRings(r.geom_simplified_medium_real)
                   - ST_NumGeometries(r.geom_simplified_medium_real)    AS medium_real_rings,
                 ST_NumGeometries(r.geom_simplified_medium_real)        AS medium_real_parts,
                 ST_NRings(r.geom_simplified_low_real)
                   - ST_NumGeometries(r.geom_simplified_low_real)       AS low_real_rings,
                 ST_NumGeometries(r.geom_simplified_low_real)           AS low_real_parts
            FROM regions r
            CROSS JOIN LATERAL (
                  SELECT CASE WHEN COALESCE(r.uses_hull, false)
                              THEN COALESCE(r.hull_geom_3857, r.geom_3857)
                              ELSE r.geom_3857 END AS g
                 ) eff
           WHERE r.geom_3857 IS NOT NULL
        ),
        rung AS (
          SELECT s.id, s.name, s.world_view_id, v.label, v.counted, v.drawn, v.held
            FROM shape s
            CROSS JOIN LATERAL (VALUES
              ('1 km rung',        'holes',  s.medium_rings,      s.own_rings),
              ('5 km rung',        'holes',  s.low_rings,         s.own_rings),
              ('10 km rung',       'holes',  s.coarse_rings,      s.own_rings),
              ('50 km rung',       'holes',  s.overview_rings,    s.own_rings),
              ('1 km island rung', 'holes',  s.medium_real_rings, s.real_rings),
              ('5 km island rung', 'holes',  s.low_real_rings,    s.real_rings),
              -- The two cheap rungs are absent here on purpose: dropping a piece
              -- below their own scale is ADR-0031 decision 1, not a defect.
              ('1 km rung',        'pieces', s.medium_parts,      s.own_parts),
              ('5 km rung',        'pieces', s.low_parts,         s.own_parts),
              ('1 km island rung', 'pieces', s.medium_real_parts, s.real_parts),
              ('5 km island rung', 'pieces', s.low_real_parts,    s.real_parts)
            ) AS v(label, counted, drawn, held)
           WHERE (v.counted = 'holes'  AND v.drawn > v.held)
              OR (v.counted = 'pieces' AND v.drawn < v.held)
        )
        SELECT worst.region_id, worst.region_name, worst.world_view_name,
               worst.rung, worst.counted, worst.drawn, worst.held
          FROM (
            SELECT DISTINCT ON (x.id)
                   x.id AS region_id, x.name AS region_name, w.name AS world_view_name,
                   x.label AS rung, x.counted, x.drawn, x.held,
                   abs(x.drawn - x.held) AS off_by
              FROM rung x
              JOIN world_views w ON w.id = x.world_view_id
             ORDER BY x.id, abs(x.drawn - x.held) DESC
          ) worst
         ORDER BY worst.off_by DESC, worst.region_name`,
  describe: (row) => {
    // One invented hole, or one lost island, is the smallest this rule can
    // report — and it is the shape a regression arrives in before it is 555.
    const drawn = count(row, 'drawn');
    const counted = text(row, 'counted');
    const noun = drawn === 1 ? counted.replace(/s$/, '') : counted;
    return `${text(row, 'region_name')} (${text(row, 'world_view_name')}): the ${text(row, 'rung')} `
      + `draws ${drawn} ${noun} where the shape it is made from has `
      + `${count(row, 'held')} (region ${count(row, 'region_id')})`;
  },
};

export const regionGeometryAssertions: CatalogueAssertion[] = [
  framedAsTheWorld,
  anchorFarFromItsRegion,
  parentShortOfItsChildren,
  regionWithoutGeometry,
  rungUnlikeItsSource,
];
