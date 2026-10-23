/**
 * The review queue's card for a serial World Heritage site some component of
 * which the list placed only roughly (#1853, `approximatePointOpenSql`): one
 * card per site, a row per such point, with what says where it may really
 * stand. Each hint carries where it comes from and how far from the point:
 * `item`, `osm-ref` and `osm-name` as the *Find component items* pass worked
 * them out (`pointHints.ts`, `experience_point_hints`), and `candidate`, an
 * item the component-item finder proposes for it and nobody has answered,
 * which no other component holds (`candidateHintsSql`), read from its proposal. A
 * candidate within `COPIED_COORDINATE_M` of the point is the point copied and
 * is left out, as the pass leaves out its own.
 *
 * The answer is the curator's placement of the point (`editLocation`): a
 * hint's coordinate, one placed by hand, or the list's point kept, each a claim
 * on the point's coordinate, which closes the question.
 */

import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { rowKindJoinSql } from '../../db/membership.js';
import { lifecycleSelectSql } from '../../db/readerPredicates.js';
import { pointsShownSql } from '../../db/placePoints.js';
import { SITE_POINTS } from './reviewQueueComponentItems.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { approximatePointAskedSql, approximatePointsOpenSql, candidateHintsSql } from './reviewQueuePredicates.js';

/**
 * Every hint of the point `el`, with its distance from it and, for an
 * OpenStreetMap object, its tags: what the card lists and what Jev is asked
 * about (`pointHintSuggestionController.ts`).
 */
export const HINTS = `
  SELECT h.source, h.ref, h.label, h.location AS at, h.metres, h.tags
    FROM experience_point_hints h WHERE h.location_id = el.id
  UNION ALL
  SELECT 'candidate', p.wikidata_item, p.item_label, p.item_location,
         round(ST_Distance(p.item_location::geography, el.location::geography))::int, NULL::jsonb
    ${candidateHintsSql('p', 'el')}`;

/** A point's hints, the component's own reference first, nearest first within each source. */
const HINTS_OF_POINT = `(SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source', h.source, 'ref', h.ref, 'label', h.label,
           'latitude', ST_Y(h.at), 'longitude', ST_X(h.at), 'metres', h.metres)
         ORDER BY array_position(ARRAY['osm-ref', 'item', 'candidate', 'osm-name'], h.source), h.metres), '[]'::jsonb)
       FROM (${HINTS}) h)`;

/** Every point of the site asked about (`hinted`) or listed (not), in the source's order, with its hints. */
const approximatePoints = (hinted: boolean) => `(SELECT jsonb_agg(jsonb_build_object(
           'locationId', el.id,
           'name', el.name,
           'ref', el.external_ref,
           'latitude', ST_Y(el.location),
           'longitude', ST_X(el.location),
           'reason', el.approximate,
           'hints', ${HINTS_OF_POINT})
         ORDER BY el.ordinal NULLS LAST, el.id)
       FROM ${pointsShownSql('e.id', 'el')}
      WHERE ${approximatePointAskedSql(hinted, 'el')})`;

/**
 * The cards of `ids`: the points something says where they may stand on
 * `approximate-points`, the ones nothing does on `approximate-unhinted`
 * (#1903), which the same card answers by keeping or placing each by hand.
 */
export async function queryApproximatePoints(ids: number[], hinted = true): Promise<QueryResult> {
  return pool.query(`
    SELECT e.id, e.external_id, e.name, mk.kind_id, kd.name AS kind_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           '${hinted ? 'approximate-points' : 'approximate-unhinted'}' AS kind, NULL::jsonb AS proposed,
           ${approximatePoints(hinted)} AS approximate_points,
           ${SITE_POINTS} AS site_points
      FROM experiences e
      ${rowKindJoinSql('e', 'mk', 'kd')}
     WHERE e.id = ANY($1::int[])
       AND ${approximatePointsOpenSql('e', hinted)}
     ORDER BY e.id
  `, [ids]);
}
