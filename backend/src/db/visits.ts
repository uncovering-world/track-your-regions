/**
 * A traveller's visits, read one way everywhere (#2120): Map mode's ticks and
 * row state, Discover's list and button, a place's progress and a curator's
 * question whether anyone had been there.
 *
 * A visit is one row of `user_visited_experiences` on the place the traveller
 * ticked: a part, a cast's edition, a place of one point, or a whole ticked
 * as a whole. Nothing is written for a whole when one of its parts is ticked;
 * the whole's state is read from its parts, one level down, as every reader of
 * a place's points shows them (`pointsShownSql`). A point counts as visited
 * when its own place is. A visit on a place a merge folded is kept for the
 * merge's undo and never read.
 */

import { pointsShownSql } from './placePoints.js';
import { offeredLocationSql, publishedContentSql } from './readerPredicates.js';

/**
 * Whether the place `place` is a whole a reader is shown by its parts: one of
 * its direct parts has a point a reader is shown. Such a place is ticked by
 * its parts, so its row shows its state and ticks nothing (#2120). A part
 * whose points are all unread or withdrawn does not count, so a reader never
 * learns from the row that unread parts exist.
 */
export function showsPartsSql(place: string): string {
  return `EXISTS (SELECT 1 FROM experience_parts sp_prt
                   JOIN experience_locations sp_el ON sp_el.experience_id = sp_prt.part_id
                  WHERE sp_prt.whole_id = ${place}
                    AND ${offeredLocationSql('sp_el')} AND ${publishedContentSql('sp_el')})`;
}

/**
 * Whether the place `place` shows a point of its own a reader may see: on a
 * whole, a point that stands for the whole site, such as the one named for
 * the whole of the City of Graz beside its historic centre. A tick on that
 * point is a visit on the whole itself (#2120).
 */
export function showsOwnPointSql(place: string): string {
  return `EXISTS (SELECT 1 FROM experience_locations so_el
                  WHERE so_el.experience_id = ${place}
                    AND ${offeredLocationSql('so_el')} AND ${publishedContentSql('so_el')})`;
}

/**
 * The traveller `user`'s visits that count, as a derived table of the visit
 * rows: on a place no merge folded. `user` is an int expression, a bound
 * parameter.
 */
export function liveVisitsSql(user: string): string {
  return `(SELECT lv.* FROM user_visited_experiences lv
             JOIN experiences lv_place ON lv_place.id = lv.experience_id
            WHERE lv.user_id = ${user} AND lv_place.merged_into_id IS NULL)`;
}

/**
 * Every place the traveller `user` has a state in, with what decides it:
 * `place_id`, `ticked` (a visit on the place itself), `total` (the points a
 * reader is shown of it, its own and its direct parts') and `visited` (those
 * whose own place the traveller visited). The places are those they visited
 * and the wholes those are direct parts of. `computeVisitedStatus`
 * (`@tyr/shared/visits`) turns the three into the state.
 */
export function visitStatesSql(user: string): string {
  return `(WITH ticked AS MATERIALIZED (SELECT DISTINCT tv.experience_id FROM ${liveVisitsSql(user)} tv),
        touched AS (
          SELECT ticked.experience_id AS place_id FROM ticked
          UNION
          SELECT prt.whole_id FROM experience_parts prt JOIN ticked ON ticked.experience_id = prt.part_id)
      SELECT touched.place_id,
             EXISTS (SELECT 1 FROM ticked WHERE ticked.experience_id = touched.place_id) AS ticked,
             count(shown.id)::int AS total,
             count(shown.id) FILTER (WHERE shown.experience_id IN (SELECT experience_id FROM ticked))::int AS visited
        FROM touched
        LEFT JOIN LATERAL (SELECT shown.id, shown.experience_id FROM ${pointsShownSql('touched.place_id', 'shown')}
                            WHERE ${offeredLocationSql('shown')} AND ${publishedContentSql('shown')}) shown ON true
       GROUP BY touched.place_id)`;
}

/**
 * Whether any traveller has been at the point `point`: a visit on its own
 * place. What a curator's card about a point weighs, since a visit outlives
 * either answer (ADR-0022).
 */
export function someoneVisitedPointSql(point = 'el'): string {
  return `EXISTS (SELECT 1 FROM user_visited_experiences sv
                   JOIN experiences sv_place ON sv_place.id = sv.experience_id
                  WHERE sv.experience_id = ${point}.experience_id AND sv_place.merged_into_id IS NULL)`;
}

/**
 * The rows `columns` for each of the points `points` (an int[] expression),
 * read as the visit is written: under a share lock on the point, so a merge
 * that moves or folds it commits first and the visit goes to the place the
 * point stands on then, and a point a merge folded is left out. What a tick
 * on a point, its untick and *Mark all* write from, inside their statement
 * (#2120).
 */
export function pointPlaceAtWriteSql(points: string, columns: string): string {
  return `SELECT ${columns} FROM experience_locations el
     WHERE el.id = ANY(${points}) AND el.merged_into_id IS NULL
     FOR SHARE OF el`;
}

/**
 * The rows `columns` for the place `place` (an int expression), read as a
 * visit on it is written or taken back: under a share lock on the place, so a
 * merge folding it commits first and the place it folded is left out, and
 * only where `where` holds of it as well (`e` is the place). What a tick on a
 * place, its untick and the venue a seen work marks write from, inside their
 * statement (#2120).
 */
export function placeAtWriteSql(place: string, columns: string, where = 'TRUE'): string {
  return `SELECT ${columns} FROM experiences e
     WHERE e.id = ${place} AND e.merged_into_id IS NULL AND ${where}
     FOR SHARE OF e`;
}
