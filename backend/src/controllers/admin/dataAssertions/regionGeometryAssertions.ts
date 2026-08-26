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
 * (#667). Every run had reported success. These four rules are the resting-state
 * check the other lanes cannot be: they read the rows.
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
 * A region awaiting recompute still shows here, and should — by two routes.
 * `invalidateRegionGeometry()` nulls the edited region's geometry and every
 * derived ancestor's, so an edit parks a continent on this rule until compute is
 * run; and since #667 an ordinary compute does the same to the ancestors alone
 * (`invalidateAncestorGeometry()`), because a parent is the union of children one
 * of which has just changed. Computing anything under a continent therefore
 * parks the continent here until the next world-view run takes it bottom-up.
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

export const regionGeometryAssertions: CatalogueAssertion[] = [
  framedAsTheWorld,
  anchorFarFromItsRegion,
  parentShortOfItsChildren,
  regionWithoutGeometry,
];
