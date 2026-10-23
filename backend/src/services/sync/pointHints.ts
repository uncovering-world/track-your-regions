/**
 * Where a component the World Heritage list placed only roughly may really
 * stand (#1853): the hints the curator's card draws beside the list's point,
 * worked out by the *Find component items* pass and kept in
 * `experience_point_hints`, since the card reads no workbench table (ADR-0124).
 *
 * Three sources, each read locally, never from a live service:
 * - `item`, the coordinate of the component's own Wikidata item, from the
 *   subset's claims;
 * - `osm-ref`, an OpenStreetMap object of the layer (ADR-0134) that carries
 *   the component's World Heritage reference (`ref:whc`), at any distance:
 *   Saint Gayane church carries `1011-002`, 341 m from the point Echmiatsin's
 *   components share, and the Longmen Grottoes' object stands 10 km from the
 *   list's point;
 * - `osm-name`, up to `OSM_NAME_HINTS` objects within `OSM_NAME_RADIUS_M`
 *   named like the component, a settlement or a boundary never among them.
 *
 * A hint within `COPIED_COORDINATE_M` of the point is the point copied, not a
 * measurement, and is left out. The finder's own candidates are hints too, and
 * the card reads their coordinates from the proposals, which are serving.
 */

import { pool } from '../../db/index.js';
import { offeredLocationSql, publishedContentSql } from '../../db/readerPredicates.js';
import { shownBySql } from '../../db/placePoints.js';
import { COPIED_COORDINATE_M } from './componentItemMatching.js';

/** How far an OpenStreetMap object named like the component may stand to be offered: a whole minute's cell. */
export const OSM_NAME_RADIUS_M = 2000;
/** How alike an object's name must be to the component's, by trigram similarity. */
const OSM_NAME_SIMILARITY = 0.4;
/** How many objects named like the component a point is offered. */
const OSM_NAME_HINTS = 3;
/** Metres in a degree of latitude, near enough for a search box. */
const METRES_PER_DEGREE = 111000;

/**
 * A component point the list placed only roughly (`experience_locations.approximate`)
 * that nobody has placed since: one a reader sees, with no curator's claim on
 * its coordinate. The review queue asks about these points, and the pass
 * works out their hints. `el` is the point's alias.
 */
export function approximatePointOpenSql(el = 'el'): string {
  return `${el}.approximate IS NOT NULL AND NOT ${el}.curated_fields ? 'location'
    AND ${offeredLocationSql(el)} AND ${publishedContentSql(el)}`;
}

/** Every hint for the point `el`, before its distance is worked out. */
const HINTS = `
  SELECT 'item' AS source, el.wikidata_item AS ref, NULL::text AS label,
         ST_SetSRID(ST_MakePoint((c.value->>'longitude')::float8, (c.value->>'latitude')::float8), 4326) AS at
    FROM (SELECT c.value FROM wikidata_claims c
           WHERE c.subject = el.wikidata_item AND c.property = 'P625' AND c.rank >= 0 AND c.value ? 'latitude'
           ORDER BY c.rank DESC LIMIT 1) c
  UNION ALL
  SELECT 'osm-ref', o.osm_type || o.osm_id, COALESCE(o.tags->>'name:en', o.tags->>'name'), ST_PointOnSurface(o.geom)
    FROM osm_objects o
   WHERE el.external_ref IS NOT NULL AND o.tags ? 'ref:whc' AND o.tags->>'ref:whc' = el.external_ref
  UNION ALL
  SELECT * FROM (
    SELECT 'osm-name', o.osm_type || o.osm_id, COALESCE(o.tags->>'name:en', o.tags->>'name'), ST_PointOnSurface(o.geom)
      FROM osm_objects o
     WHERE el.name IS NOT NULL
       -- A box the spatial index answers first, the radius in degrees, wider in
       -- longitude as the meridians close towards the poles.
       AND o.geom && ST_Expand(el.location,
             ${OSM_NAME_RADIUS_M / METRES_PER_DEGREE} / greatest(cos(radians(ST_Y(el.location))), 0.05),
             ${OSM_NAME_RADIUS_M / METRES_PER_DEGREE})
       AND ST_DWithin(o.geom::geography, el.location::geography, ${OSM_NAME_RADIUS_M})
       -- A copy of the point takes no namesake's place before it is left out.
       AND NOT ST_DWithin(o.geom::geography, el.location::geography, ${COPIED_COORDINATE_M})
       AND o.tags->>'ref:whc' IS DISTINCT FROM el.external_ref
       -- A settlement or an area's boundary named like the component is the
       -- place it is named after, not where it stands: the Dacian forts were
       -- offered their villages (#1903).
       AND NOT (o.tags ? 'place' OR o.tags ? 'boundary')
       AND (similarity(lower(o.tags->>'name'), lower(el.name)) >= ${OSM_NAME_SIMILARITY}
            OR similarity(lower(o.tags->>'name:en'), lower(el.name)) >= ${OSM_NAME_SIMILARITY})
     ORDER BY ST_Distance(o.geom::geography, el.location::geography)
     LIMIT ${OSM_NAME_HINTS}) named`;

/** What a pass worked out: the points it read, and the hints it kept for them. */
export interface PointHintsReport {
  points: number;
  hints: number;
}

/**
 * Work out the hints of every open approximate point, or of one site's, and
 * keep them in place of the ones an earlier pass kept for the same points. A
 * whole pass also drops the hints of points no longer asked about.
 */
export async function findPointHints(siteId?: number): Promise<PointHintsReport> {
  const ofSite = siteId === undefined ? 'TRUE' : shownBySql('el', 'ARRAY[$1::int]');
  const params = siteId === undefined ? [] : [siteId];
  if (siteId === undefined) {
    await pool.query(
      `DELETE FROM experience_point_hints h
        WHERE NOT EXISTS (SELECT 1 FROM experience_locations el WHERE el.id = h.location_id AND ${approximatePointOpenSql('el')})`,
    );
  }
  const points = await pool.query<{ id: number }>(
    `SELECT el.id FROM experience_locations el WHERE ${approximatePointOpenSql('el')} AND ${ofSite}`, params,
  );
  const ids = points.rows.map(row => row.id);
  if (ids.length === 0) return { points: 0, hints: 0 };
  const kept = await pool.query(
    `WITH gone AS (
       DELETE FROM experience_point_hints h WHERE h.location_id = ANY($1::int[])
     ), found AS (
       SELECT el.id AS location_id, hint.source, hint.ref, hint.label, hint.at,
              ST_Distance(hint.at::geography, el.location::geography) AS metres
         FROM experience_locations el
        CROSS JOIN LATERAL (${HINTS}) hint
        WHERE el.id = ANY($1::int[]) AND hint.at IS NOT NULL AND hint.ref IS NOT NULL
     )
     INSERT INTO experience_point_hints (location_id, source, ref, label, location, metres)
     SELECT location_id, source, ref, label, at, round(metres)::int FROM found
      WHERE metres >= ${COPIED_COORDINATE_M}`,
    [ids],
  );
  return { points: ids.length, hints: kept.rowCount ?? 0 };
}
