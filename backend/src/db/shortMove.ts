/**
 * Whether a move of a point a reader sees passes the curation gate as a short
 * move (#1837, ADR-0140): the rule the place's upsert and the location writer
 * both ask, and migration 155 spells out.
 *
 * Three conditions, each measured on the review queue of 2026-10-22:
 * - **shorter than `SHORT_MOVE_METERS`.** Every such move kept the pin on the
 *   same building or site, or corrected it;
 * - **in the same GADM leaf division, and in one at all.** No move under the
 *   distance changed its division. The two under a kilometre that did were
 *   coastal points leaving or entering the sea (Knidos, a Rock Art of Alta
 *   component);
 * - **no nearer to another place than to its own stored point.** A move that
 *   lands at another place of the catalogue is the one short move worth a
 *   question, as Reims Cathedral beside the Reims World Heritage property shows.
 *   Another place is one whose point a reader sees and that is neither the
 *   place, a whole it is a part of, nor a part of either. The Parthenon and the
 *   Acropolis count as two.
 *
 * `place` is an integer expression naming the place the point belongs to
 * (its whole, for a component's part place). `from` and `to` are geometry
 * expressions in SRID 4326. An expression is answered once per row, so a
 * caller passes column references or bound parameters.
 */

import { SHORT_MOVE_METERS } from '@tyr/shared/moves';
import { placeOfferedSql } from './membership.js';
import { madeOfSql, withWholesSql } from './placePoints.js';
import { offeredLocationSql, partOfferedSql, publishedContentSql } from './readerPredicates.js';

/** The GADM leaf divisions covering a point, as a sorted `int[]`. */
const leavesSql = (point: string): string =>
  `ARRAY(SELECT d.id FROM administrative_divisions d
          WHERE NOT d.has_children AND ST_Covers(d.geom, ${point}) ORDER BY d.id)`;

export function shortMovePassesSql(place: string, from: string, to: string): string {
  const metres = `ST_Distance((${from})::geography, (${to})::geography)`;
  return `(${metres} < ${SHORT_MOVE_METERS}
    AND cardinality(${leavesSql(from)}) > 0
    AND ${leavesSql(from)} = ${leavesSql(to)}
    AND NOT EXISTS (
      SELECT 1 FROM experience_locations near
        JOIN experiences other ON other.id = near.experience_id
       -- A box of about two kilometres around the new point first, so the
       -- spatial index answers before the distance does.
       WHERE near.location && ST_Expand(${to}, 0.02)
         AND ST_DWithin(near.location::geography, (${to})::geography, ${metres})
         AND ST_Distance(near.location::geography, (${to})::geography) < ${metres}
         AND near.experience_id <> ALL(${madeOfSql(withWholesSql(`ARRAY[${place}]::int[]`))})
         AND ${offeredLocationSql('near')} AND ${publishedContentSql('near')}
         AND other.merged_into_id IS NULL
         AND (${placeOfferedSql('other')} OR ${partOfferedSql('other')})))`;
}
