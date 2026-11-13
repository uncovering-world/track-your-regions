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

import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from './index.js';
import { pointsShownSql } from './placePoints.js';
import { offeredLocationSql, publishedContentSql } from './readerPredicates.js';
import { badRequest, notFound } from '../middleware/errorHandler.js';
import { RESTORE_LIMITS, TOO_MUCH_TO_UNDO } from '../types/trips.js';

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

/**
 * Newest first, as a place's card lists its trips: by date, a trip whose date
 * is not known last, and among equal dates the one entered last first.
 * `trip` names the `user_visit_trips` alias.
 */
export function tripOrderSql(trip = 'tr'): string {
  return `${trip}.year DESC NULLS LAST, ${trip}.month DESC NULLS LAST, ${trip}.day DESC NULLS LAST,
          ${trip}.created_at DESC, ${trip}.id DESC`;
}

/**
 * The trip `trip` (an int expression) of the traveller `user`, with `columns`
 * of it (`ot`) and of its visit (`ov`), read as it is changed or removed:
 * under a share lock on the visit, so an untick or a merge of that visit
 * commits first, and only on a place no merge folded. Another traveller's
 * trip, or none, is no row: the caller answers 404 and says nothing more
 * (#2120).
 */
export function ownTripAtWriteSql(user: string, trip: string, columns: string): string {
  return `SELECT ${columns} FROM user_visit_trips ot
     JOIN user_visited_experiences ov ON ov.id = ot.visit_id
     JOIN experiences ov_place ON ov_place.id = ov.experience_id
    WHERE ot.id = ${trip} AND ov.user_id = ${user} AND ov_place.merged_into_id IS NULL
    FOR SHARE OF ov`;
}

/**
 * The removal of the traveller's visits `visits` (an int[] expression of
 * their `id`s, locked by an earlier statement of the same transaction), as the
 * tail of a `WITH`: it deletes them only while what it takes fits what its
 * Undo puts back (`RESTORE_LIMITS`), so a removal never deletes a visit its
 * Undo would refuse (#2120). One statement answers a row per removed visit,
 * with its trips as a JSON list of their dates, read in the statement that
 * deletes their visit, which still sees them (their cascade runs after it);
 * and on every row, or on one row when nothing was removed, how many visits
 * and trips the removal would take (`taken_visits`, `taken_trips`). Run by
 * `removeVisitsOn`, never on its own.
 */
export function removeVisitsSql(visits: string): string {
  return `target AS (SELECT unnest(${visits}) AS id),
    size AS (
      SELECT (SELECT count(*)::int FROM target) AS taken_visits,
             (SELECT count(*)::int FROM user_visit_trips tt WHERE tt.visit_id IN (SELECT id FROM target)) AS taken_trips),
    gone AS (
      DELETE FROM user_visited_experiences v USING target, size
       WHERE v.id = target.id
         AND size.taken_visits <= ${RESTORE_LIMITS.visits} AND size.taken_trips <= ${RESTORE_LIMITS.trips}
       RETURNING v.id, v.experience_id, v.marked_at, v.notes, v.rating)
    SELECT size.taken_visits, size.taken_trips, removed.*
      FROM size LEFT JOIN (
        SELECT gone.experience_id, gone.marked_at, gone.notes, gone.rating,
               COALESCE((SELECT json_agg(json_build_object('year', rt.year, 'month', rt.month, 'day', rt.day)
                                         ORDER BY ${tripOrderSql('rt')})
                           FROM user_visit_trips rt WHERE rt.visit_id = gone.id), '[]'::json) AS trips
          FROM gone) removed ON true`;
}

/**
 * Remove the traveller's visits that `target` selects (a query of their
 * `id`s with `params`, ending `FOR UPDATE OF v`), on `client` inside its open
 * transaction, answering `removeVisitsSql`'s rows (#2120). Two statements:
 * the first takes the locks, the second counts what it takes and deletes it.
 * Not one: a statement reads the snapshot it started with, and a lock it
 * waits for is granted after that, so a trip an `addTrip` committed on the
 * visit while the untick waited would be missing from the count and from
 * `removed` and still go with its visit by the cascade, beyond its Undo. The
 * second statement starts once every visit is held, so it sees every trip
 * committed before, and no trip can be added or changed under a held visit.
 */
export async function removeVisitsOn(
  client: PoolClient, target: string, params: unknown[],
): Promise<RemovedVisitRow[]> {
  const held = await client.query<{ id: number }>(target, params);
  const result = await client.query<RemovedVisitRow>(
    `WITH ${removeVisitsSql('$1::int[]')}`, [held.rows.map(row => row.id)],
  );
  return result.rows;
}

/** `removeVisitsOn` in a transaction of its own: the untick of one place or one point. */
export async function removeVisits(target: string, params: unknown[]): Promise<RemovedVisitRow[]> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const rows = await removeVisitsOn(client, target, params);
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    // A client whose ROLLBACK also failed is destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/** A row of `removeVisitsSql`: a removed visit, or none, with what the removal would take. */
export interface RemovedVisitRow {
  taken_visits: number;
  taken_trips: number;
  experience_id: number | null;
  marked_at: Date | null;
  notes: string | null;
  rating: number | null;
  trips: { year: number | null; month: number | null; day: number | null }[] | null;
}

/**
 * The visits a removal took, in the answer's shape (`RemovedVisit`), or its
 * refusal: 404 where there was nothing to remove, and 400 in words where it
 * would take more than an Undo puts back, having deleted nothing.
 */
export function removedVisitsOf(rows: RemovedVisitRow[]) {
  const { taken_visits: visits, taken_trips: trips } = rows[0];
  if (visits === 0) throw notFound('Visit record not found');
  if (visits > RESTORE_LIMITS.visits || trips > RESTORE_LIMITS.trips) throw badRequest(TOO_MUCH_TO_UNDO);
  return rows.map(row => ({
    experienceId: row.experience_id as number,
    markedAt: row.marked_at?.toISOString() ?? null,
    notes: row.notes,
    rating: row.rating,
    trips: row.trips ?? [],
  }));
}
