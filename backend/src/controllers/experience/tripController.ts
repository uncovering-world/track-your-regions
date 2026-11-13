/**
 * A traveller's trips to a place they visited (#2120, ADR-0202): each a time
 * they were there, with a date known to a day, a month, a year or not at all.
 * Their own data: every route is under `/api/users/me` and every read and
 * write is of the caller's own visits. A route naming one trip answers 404
 * for another traveller's, never 403, so an id says nothing about whose it
 * is; a batch (`addTrips`, `changeTrips`) leaves another traveller's trip, or
 * a place the caller has no visit on, out of its answer.
 *
 * Every write reads the place or the visit it writes for inside its own
 * statement, under a share lock (`placeAtWriteSql`, `ownTripAtWriteSql`,
 * `ownVisitsAtWriteSql`), as every visit write does: a merge or an untick
 * committing meanwhile is waited for, and a folded place takes no trip.
 */

import type { z } from 'zod/v4';
import { pool, rollbackQuietly } from '../../db/index.js';
import { claimablePlaceSql } from '../../db/readerPredicates.js';
import { liveVisitsSql, ownTripAtWriteSql, ownVisitsAtWriteSql, placeAtWriteSql, tripOrderSql } from '../../db/visits.js';
import { badRequest, notFound } from '../../middleware/errorHandler.js';
import type { experienceIdParamSchema } from '../../types/index.js';
import { TOO_MANY_TRIPS, TRIPS_PER_VISIT } from '../../types/trips.js';
import type {
  addTripsBodySchema, changeTripsBodySchema, restoreVisitsBodySchema, tripDateBodySchema, tripIdParamSchema,
} from '../../types/trips.js';
import type { Trip, TripRemoved, TripSaved, TripsDated, VisitsRestored, VisitTrips } from '../../api/responses/visited.js';

interface TripRow {
  id: number;
  year: number | null;
  month: number | null;
  day: number | null;
  created_at: Date | null;
}

function tripOf(row: TripRow): Trip {
  return { id: row.id, year: row.year, month: row.month, day: row.day, createdAt: row.created_at?.toISOString() ?? null };
}

/**
 * The caller's trips to one place, newest first
 * GET /api/users/me/visited-experiences/:experienceId/trips
 */
export async function getTrips(
  { params: { experienceId }, caller }: { params: z.output<typeof experienceIdParamSchema>; caller: Express.User },
): Promise<VisitTrips> {
  const result = await pool.query<{ visited: boolean; trips: (Omit<TripRow, 'created_at'> & { created_at: string | null })[] }>(`
    SELECT EXISTS (SELECT 1 FROM ${liveVisitsSql('$1')} lv WHERE lv.experience_id = $2) AS visited,
           COALESCE((SELECT json_agg(json_build_object('id', tr.id, 'year', tr.year, 'month', tr.month,
                                                       'day', tr.day, 'created_at', tr.created_at)
                                     ORDER BY ${tripOrderSql('tr')})
                       FROM ${liveVisitsSql('$1')} lv JOIN user_visit_trips tr ON tr.visit_id = lv.id
                      WHERE lv.experience_id = $2), '[]'::json) AS trips
  `, [caller.id, experienceId]);
  const row = result.rows[0];
  return {
    experienceId,
    visited: row.visited,
    trips: row.trips.map(trip => tripOf({ ...trip, created_at: trip.created_at ? new Date(trip.created_at) : null })),
  };
}

/**
 * Add a trip to a place, ticking it where the traveller had not yet
 * POST /api/users/me/visited-experiences/:experienceId/trips
 */
export async function addTrip(
  { params: { experienceId }, body, caller }: {
    params: z.output<typeof experienceIdParamSchema>;
    body: z.output<typeof tripDateBodySchema>;
    caller: Express.User;
  },
): Promise<TripSaved> {
  // The place under its share lock, only while a reader may be shown it; the
  // visit made or found and locked by the same statement, so an untick
  // cannot take it away between the two (#2120). A visit already holding
  // TRIPS_PER_VISIT takes no more, and the one row still says it was found.
  const result = await pool.query<Omit<TripRow, 'id'> & { found: boolean; id: number | null }>(`
    WITH pl AS (${placeAtWriteSql('$2', 'e.id', claimablePlaceSql())}),
    visit AS (
      INSERT INTO user_visited_experiences (user_id, experience_id, marked_at)
      SELECT $1, pl.id, NOW() FROM pl
      ON CONFLICT (user_id, experience_id) DO UPDATE SET user_id = EXCLUDED.user_id
      RETURNING id),
    trip AS (
      INSERT INTO user_visit_trips (visit_id, year, month, day)
      SELECT visit.id, $3, $4, $5 FROM visit
       WHERE (SELECT count(*) FROM user_visit_trips held WHERE held.visit_id = visit.id) < $6
      RETURNING id, year, month, day, created_at)
    SELECT EXISTS (SELECT 1 FROM visit) AS found, trip.* FROM (SELECT 1) one LEFT JOIN trip ON true
  `, [caller.id, experienceId, body.year, body.month, body.day, TRIPS_PER_VISIT]);
  const row = result.rows[0];
  if (!row.found) throw notFound('Experience not found');
  if (row.id === null) throw badRequest(TOO_MANY_TRIPS);
  return { success: true, experienceId, trip: tripOf({ ...row, id: row.id }) };
}

/**
 * Add one trip with one date to each of several places the caller has a
 * visit on: the offer's answer after a tick, one request for a batch (#2120)
 * POST /api/users/me/trips
 *
 * A place with no visit (unticked meanwhile) or whose visit holds
 * TRIPS_PER_VISIT already is left out of the answer, never ticked here.
 */
export async function addTrips(
  { body, caller }: { body: z.output<typeof addTripsBodySchema>; caller: Express.User },
): Promise<TripsDated> {
  const result = await pool.query<TripRow & { experience_id: number }>(`
    WITH v AS (${ownVisitsAtWriteSql('$1', '$2::int[]', 'ov.id, ov.experience_id')}),
    added AS (
      INSERT INTO user_visit_trips (visit_id, year, month, day)
      SELECT v.id, $3, $4, $5 FROM v
       WHERE (SELECT count(*) FROM user_visit_trips held WHERE held.visit_id = v.id) < $6
      RETURNING id, visit_id, year, month, day, created_at)
    SELECT v.experience_id, added.id, added.year, added.month, added.day, added.created_at
      FROM added JOIN v ON v.id = added.visit_id
     ORDER BY v.experience_id
  `, [caller.id, body.experienceIds, body.date.year, body.date.month, body.date.day, TRIPS_PER_VISIT]);
  return { success: true, trips: result.rows.map(row => ({ experienceId: row.experience_id, trip: tripOf(row) })) };
}

/**
 * Give several of the caller's trips new dates at once: the offer's "Change"
 * over every place its line covers (#2120)
 * PUT /api/users/me/trips
 *
 * Another traveller's trip, or one gone meanwhile, is left out of the answer.
 */
export async function changeTrips(
  { body, caller }: { body: z.output<typeof changeTripsBodySchema>; caller: Express.User },
): Promise<TripsDated> {
  const dates = body.trips.map(({ id, date }) => ({ id, ...date }));
  const result = await pool.query<TripRow & { experience_id: number }>(`
    UPDATE user_visit_trips t SET year = d.year, month = d.month, day = d.day
      FROM jsonb_to_recordset($3::jsonb) AS d(id int, year int, month int, day int),
           (${ownTripAtWriteSql('$1', 'ANY($2::int[])', 'ot.id, ov.experience_id')}) own
     WHERE t.id = d.id AND own.id = d.id
     RETURNING own.experience_id, t.id, t.year, t.month, t.day, t.created_at
  `, [caller.id, dates.map(date => date.id), JSON.stringify(dates)]);
  return { success: true, trips: result.rows.map(row => ({ experienceId: row.experience_id, trip: tripOf(row) })) };
}

/**
 * Change a trip's date
 * PATCH /api/users/me/trips/:tripId
 */
export async function changeTrip(
  { params: { tripId }, body, caller }: {
    params: z.output<typeof tripIdParamSchema>;
    body: z.output<typeof tripDateBodySchema>;
    caller: Express.User;
  },
): Promise<TripSaved> {
  const result = await pool.query<TripRow & { experience_id: number }>(`
    UPDATE user_visit_trips t SET year = $3, month = $4, day = $5
      FROM (${ownTripAtWriteSql('$1', '$2', 'ot.id, ov.experience_id')}) own
     WHERE t.id = own.id
     RETURNING t.id, t.year, t.month, t.day, t.created_at, own.experience_id
  `, [caller.id, tripId, body.year, body.month, body.day]);
  if (result.rows.length === 0) throw notFound('Trip not found');
  return { success: true, experienceId: result.rows[0].experience_id, trip: tripOf(result.rows[0]) };
}

/**
 * Remove a trip; the visit stays, with no date if it was the last
 * DELETE /api/users/me/trips/:tripId
 */
export async function removeTrip(
  { params: { tripId }, caller }: { params: z.output<typeof tripIdParamSchema>; caller: Express.User },
): Promise<TripRemoved> {
  const result = await pool.query<TripRow & { experience_id: number }>(`
    DELETE FROM user_visit_trips t
     USING (${ownTripAtWriteSql('$1', '$2', 'ot.id, ov.experience_id')}) own
     WHERE t.id = own.id
     RETURNING t.id, t.year, t.month, t.day, t.created_at, own.experience_id
  `, [caller.id, tripId]);
  if (result.rows.length === 0) throw notFound('Trip not found');
  return { success: true, experienceId: result.rows[0].experience_id, trip: tripOf(result.rows[0]) };
}

/**
 * Put back visits an untick removed, each with its trips: its Undo
 * POST /api/users/me/visits/restore
 *
 * One transaction, so the Undo of a batch restores all of it or none. A
 * place since folded or refused takes nothing back; a visit made again
 * meanwhile keeps its own fields and gains the trips.
 */
export async function restoreVisits(
  { body, caller }: { body: z.output<typeof restoreVisitsBodySchema>; caller: Express.User },
): Promise<VisitsRestored> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  let restored = 0;
  try {
    await client.query('BEGIN');
    for (const visit of body.visits) {
      const result = await client.query<{ restored: number }>(`
        WITH pl AS (${placeAtWriteSql('$2', 'e.id', claimablePlaceSql())}),
        visit AS (
          INSERT INTO user_visited_experiences (user_id, experience_id, marked_at, notes, rating)
          SELECT $1, pl.id, COALESCE($3::timestamptz, NOW()), $4, $5 FROM pl
          ON CONFLICT (user_id, experience_id) DO UPDATE SET user_id = EXCLUDED.user_id
          RETURNING id),
        trips AS (
          INSERT INTO user_visit_trips (visit_id, year, month, day)
          SELECT visit.id, t.year, t.month, t.day
            FROM visit CROSS JOIN jsonb_to_recordset($6::jsonb) AS t(year int, month int, day int)
          RETURNING 1)
        SELECT count(*)::int AS restored FROM visit
      `, [caller.id, visit.experienceId, visit.markedAt, visit.notes, visit.rating, JSON.stringify(visit.trips)]);
      restored += result.rows[0].restored;
    }
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
  return { success: true, restored };
}
