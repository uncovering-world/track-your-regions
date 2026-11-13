/**
 * A traveller's visits to the points of a place: the ticks a list draws, the
 * "n of m" its badge reads, a tick on one point and "mark all".
 *
 * A visit is a row on the place the point belongs to (#2120): a tick on the
 * Temple of Karnak's point is the temple's visit, a tick on one cast of an
 * edition is the edition's, and a tick on a place of one point is the
 * place's. Nothing is written for the whole a part belongs to: Ancient Thebes
 * reads the temple's visit through its part (`db/visits.ts`), so Map mode and
 * Discover read one record and agree.
 */

import type { z } from 'zod/v4';
import type {
  AllLocationsMarked, AllLocationsUnmarked, ExperienceVisitedStatusResponse, LocationVisitMarked, LocationVisitUnmarked,
  VisitedLocationIds,
} from '../../api/responses/visited.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { computeVisitedStatus } from '@tyr/shared/visits';
import { placePointsSql, pointNameSql } from '../../db/placePoints.js';
import type { ExperienceLocationsRow, ExperiencesRow, UserVisitedExperiencesRow } from '../../db/schema.generated.js';
import {
  claimablePlaceSql,
  claimableToReaderSql,
  offeredLocationSql,
  publishedContentSql,
} from '../../db/readerPredicates.js';
import {
  liveVisitsSql, placeAtWriteSql, pointPlaceAtWriteSql, removedVisitsOf, removeVisits, removeVisitsOn,
} from '../../db/visits.js';
import { notFound } from '../../middleware/errorHandler.js';
import type {
  experienceIdParamSchema, idParamSchema, locationIdParamSchema, markAllLocationsQuerySchema,
  markLocationVisitedBodySchema, visitedLocationIdsQuerySchema,
} from '../../types/index.js';

/**
 * Get visited location IDs for current user
 * GET /api/users/me/visited-locations/ids
 */
export async function getVisitedLocationIds(
  { query: q, caller }: { query: z.output<typeof visitedLocationIdsQuerySchema>; caller: Express.User },
): Promise<VisitedLocationIds> {
  const userId = caller.id;
  const experienceId = q.experienceId ?? null;

  // Carries exactly what `getExperienceVisitedStatus` carries, and the reason is
  // that the two answer the same question about the same rows: this endpoint
  // supplies the ticks a client draws, that one supplies the "n of m" a badge
  // reads. Filter them differently and the two disagree about one traveller's
  // own record — 3 of 2 — which is the arithmetic nobody reports and everybody
  // notices.
  //
  // So all four: the gate and the content gate, because a point nobody has
  // read is one no writer can create a visit through; `admission`, because a
  // museum this catalogue turned down is on no list this reader can see; and
  // points a reader may be shown, which since ADR-0026 decision 7 is two
  // exclusions rather than one. The traveller's history is not lost by any of
  // this: `getVisitedIds` carries no lifecycle predicate, and that is where a
  // record of somewhere that has since left the catalogue belongs.
  //
  // Read from the traveller's visits outward: each visited place's points,
  // under every place that shows them, its own and its whole (ADR-0100).
  let query = `
    SELECT el.id AS location_id, pp.place_id AS experience_id
    FROM ${liveVisitsSql('$1')} uv
    JOIN experience_locations el ON el.experience_id = uv.experience_id
    JOIN ${placePointsSql()} pp ON pp.location_id = el.id
    JOIN experiences e ON e.id = pp.place_id
    WHERE ${claimablePlaceSql()}
      AND ${offeredLocationSql('el')} AND ${publishedContentSql('el')}
  `;

  const params: number[] = [userId];

  if (experienceId) {
    query += ' AND pp.place_id = $2';
    params.push(experienceId);
  }

  const result = await pool.query<{ location_id: number; experience_id: number }>(query, params);

  // Group by experience for easy lookup
  const byExperience: Record<number, number[]> = {};
  for (const row of result.rows) {
    if (!byExperience[row.experience_id]) {
      byExperience[row.experience_id] = [];
    }
    byExperience[row.experience_id].push(row.location_id);
  }

  // A point a part and its whole both show is one visit, listed once.
  const visitedLocationIds = [...new Set(result.rows.map(r => r.location_id))];
  return {
    visitedLocationIds,
    byExperience,
    total: visitedLocationIds.length,
  };
}

/**
 * Mark a location as visited
 * POST /api/users/me/visited-locations/:locationId
 */
export async function markLocationVisited(
  { params: { locationId }, body, caller }: {
    params: z.output<typeof locationIdParamSchema>;
    body: z.output<typeof markLocationVisitedBodySchema>;
    caller: Express.User;
  },
): Promise<LocationVisitMarked> {
  const userId = caller.id;
  const notes = body.notes || null;

  // The point, under a place the reader may claim that shows it (ADR-0025,
  // ADR-0100): its own place first, then the wholes it is a part of. Gated on
  // the point's state and the place's, both unrelaxed: this is the caller's
  // own record, and a point no read ever showed them is not one they can
  // claim to have stood at. The lookup's names are echoed back, so the gate
  // also keeps an unread row's content from a non-curator.
  const locResult = await pool.query<
    Pick<ExperienceLocationsRow, 'id' | 'name' | 'experience_id'> & { shown_by: number; shown_by_name: ExperiencesRow['name'] }
  >(`
    SELECT el.id, el.name, el.experience_id, pp.place_id AS shown_by, e.name AS shown_by_name
    FROM ${placePointsSql()} pp
    JOIN experience_locations el ON el.id = pp.location_id
    JOIN experiences e ON e.id = pp.place_id
    WHERE el.id = $1 AND ${claimableToReaderSql()}
    ORDER BY (pp.place_id = el.experience_id) DESC, pp.place_id
  `, [locationId]);

  if (locResult.rows.length === 0) throw notFound('Location not found');

  const location = locResult.rows[0];

  // The visit is the point's own place's (#2120): the part's for a part's
  // point, the place's for any other point, read again as it is written.
  const result = await pool.query<Pick<UserVisitedExperiencesRow, 'id' | 'marked_at' | 'notes'>>(`
    INSERT INTO user_visited_experiences (user_id, experience_id, notes, marked_at)
    ${pointPlaceAtWriteSql('ARRAY[$2::int]', '$1, el.experience_id, $3, NOW()')}
    ON CONFLICT (user_id, experience_id) DO UPDATE SET
      notes = COALESCE($3, user_visited_experiences.notes),
      marked_at = NOW()
    RETURNING id, marked_at, notes
  `, [userId, locationId, notes]);

  // A merge folded the point while the tick was on its way.
  if (result.rows.length === 0) throw notFound('Location not found');
  const visit = result.rows[0];
  return {
    success: true,
    locationId,
    locationName: location.name,
    experienceId: location.shown_by,
    experienceName: location.shown_by_name,
    id: visit.id,
    marked_at: visit.marked_at?.toISOString() ?? null,
    notes: visit.notes,
  };
}

/**
 * Unmark a location as visited
 * DELETE /api/users/me/visited-locations/:locationId
 */
export async function unmarkLocationVisited(
  { params: { locationId }, caller }: { params: z.output<typeof locationIdParamSchema>; caller: Express.User },
): Promise<LocationVisitUnmarked> {
  // The point's own place, whose visit it is, and the place the tick was
  // answered under, as `markLocationVisited` names it.
  // A point the traveller is shown, as `markLocationVisited` gates it: a
  // visit on a point no read shows them is one a click never clears (#2120).
  const locResult = await pool.query<{ experience_id: number; shown_by: number }>(`
    SELECT el.experience_id, pp.place_id AS shown_by
    FROM ${placePointsSql()} pp
    JOIN experience_locations el ON el.id = pp.location_id
    JOIN experiences e ON e.id = pp.place_id
    WHERE el.id = $1 AND ${claimableToReaderSql()}
    ORDER BY (pp.place_id = el.experience_id) DESC, pp.place_id
  `, [locationId]);

  if (locResult.rows.length === 0) throw notFound('Location not found');

  // The visit on the point's place as the delete reads it, under the share
  // lock a tick takes: a merge moving the point commits first and the visit
  // taken back is the one the point now reads, and a point it folded clears
  // nothing (#2120).
  const visit = `SELECT v.id FROM user_visited_experiences v
      JOIN (${pointPlaceAtWriteSql('ARRAY[$2::int]', 'el.experience_id')}) pt ON v.experience_id = pt.experience_id
     WHERE v.user_id = $1 FOR UPDATE OF v`;
  const rows = await removeVisits(visit, [caller.id, locationId]);
  return { success: true, locationId, experienceId: locResult.rows[0].shown_by, removed: removedVisitsOf(rows) };
}

/**
 * The points of the place `place` a reader may claim to have stood at, as
 * `id` and `experience_id` (the point's own place): its own and its direct
 * parts', offered and published, under a place the reader may claim
 * (`claimableToReaderSql`), and only those placed in `region` where one is
 * named. What *Mark all* marks and *Unmark all* clears, so neither reaches a
 * visit on a place the traveller is not shown (#2120). `place` and `region`
 * are bound parameters.
 */
function claimablePointsSql(place: string, region: string | null): string {
  const inRegion = region
    ? `AND EXISTS (SELECT 1 FROM experience_location_regions elr
                    WHERE elr.location_id = el.id AND elr.region_id = ${region})`
    : '';
  return `SELECT el.id, el.experience_id
    FROM ${placePointsSql()} pp
    JOIN experience_locations el ON el.id = pp.location_id
    JOIN experiences e ON e.id = pp.place_id
    WHERE pp.place_id = ${place} AND ${claimableToReaderSql()}
      ${inRegion}`;
}

/**
 * Mark locations of an experience as visited
 * POST /api/users/me/experiences/:experienceId/mark-all-locations
 * Query params:
 *   - regionId: If provided, only mark locations that are in this region
 */
export async function markAllLocationsVisited(
  { params: { experienceId }, query: q, caller }: {
    params: z.output<typeof experienceIdParamSchema>;
    query: z.output<typeof markAllLocationsQuerySchema>;
    caller: Express.User;
  },
): Promise<AllLocationsMarked> {
  const userId = caller.id;
  const regionId = q.regionId ?? null;

  // "All of them" means the ones on offer. A point the source withdrew is on
  // no list this reader can see, so recording a visit to it would be a claim
  // they never made. The same is true of a point nobody has read yet: gated
  // on curation_state, both the container's and the location's own
  // (ADR-0025), or "mark all" would write a visit to a `pending` location no
  // read ever showed this reader and answer `locationsMarked` with a count
  // that discloses the size of the unread set (#520).
  const locationsResult = await pool.query<{ id: number; experience_id: number }>(
    claimablePointsSql('$1', regionId ? '$2' : null),
    regionId ? [experienceId, regionId] : [experienceId],
  );

  if (locationsResult.rows.length === 0) throw notFound('Experience not found or has no locations in this region');

  // One visit per place the points belong to, its own and its parts', in
  // one statement. Each point's place is read again as the visit is written,
  // under a share lock on the point: a merge moving it commits first and the
  // visit lands where the point now stands, and a point it folded is skipped
  // (#2120). What is answered is the points the write read: none left is a
  // 404, as for one point.
  const written = await pool.query<{ marked: number }>(`
    WITH points AS (${pointPlaceAtWriteSql('$2::int[]', 'el.experience_id')}),
    visits AS (
      INSERT INTO user_visited_experiences (user_id, experience_id, marked_at)
      SELECT $1, points.experience_id, NOW() FROM points
      ON CONFLICT (user_id, experience_id) DO NOTHING
    )
    SELECT count(*)::int AS marked FROM points
  `, [userId, locationsResult.rows.map(row => row.id)]);
  const locationsMarked = written.rows[0]?.marked ?? 0;
  if (locationsMarked === 0) throw notFound('Experience not found or has no locations in this region');

  return {
    success: true,
    experienceId,
    regionId,
    locationsMarked,
  };
}

/**
 * Unmark locations of an experience as visited
 * DELETE /api/users/me/experiences/:experienceId/mark-all-locations
 * Query params:
 *   - regionId: If provided, only unmark locations that are in this region
 */
export async function unmarkAllLocationsVisited(
  { params: { experienceId }, query: q, caller }: {
    params: z.output<typeof experienceIdParamSchema>;
    query: z.output<typeof markAllLocationsQuerySchema>;
    caller: Express.User;
  },
): Promise<AllLocationsUnmarked> {
  const userId = caller.id;
  const regionId = q.regionId ?? null;

  // The places whose points are cleared, as *Mark all* finds them: in one
  // region, the places of the points there; everywhere, the place itself and
  // its direct parts, so a site leaves no part that reads it partly visited
  // again. Only places with a point the traveller is shown: a visit on a part
  // whose points were withdrawn or are unread is one they cannot see, and a
  // click never clears it (#2120). One client, so the count reads what the
  // delete left.
  const client = await pool.connect();
  let unusable: Error | undefined;
  let locationsUnmarked: number;
  let removed: ReturnType<typeof removedVisitsOf>;
  try {
    await client.query('BEGIN');

    // Each read under a share lock, as every visit write reads what it writes
    // for: a merge moving or folding a point or the place commits first, and
    // the visits taken back are those of the places the points then stand on.
    const shown = `${claimablePointsSql('$2', regionId ? '$3' : null)} FOR SHARE OF el`;
    // The place itself, whose card the click is on, only while a reader may
    // be shown it: a stale page never clears a folded or refused place's visit.
    const place = placeAtWriteSql('$2', 'e.id AS experience_id', claimablePlaceSql());
    const places = regionId
      ? 'SELECT shown.experience_id FROM shown'
      : 'SELECT place.experience_id FROM place UNION SELECT shown.experience_id FROM shown';
    // Nothing is deleted where the Undo could not put it all back (#2120).
    const cleared = await removeVisitsOn(client, `
      WITH shown AS (${shown})${regionId ? '' : `, place AS (${place})`}
      SELECT v.id FROM user_visited_experiences v
       WHERE v.user_id = $1 AND v.experience_id IN (${places}) FOR UPDATE OF v
    `, regionId ? [userId, experienceId, regionId] : [userId, experienceId]);
    removed = cleared[0].taken_visits === 0 ? [] : removedVisitsOf(cleared);

    // How many of the place's points a reader is shown lost their tick.
    const counted = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM ${placePointsSql()} pp
        JOIN experience_locations el ON el.id = pp.location_id
       WHERE pp.place_id = $1 AND el.experience_id = ANY($2::int[])
         AND ${offeredLocationSql()} AND ${publishedContentSql('el')}
    `, [experienceId, removed.map(visit => visit.experienceId)]);

    await client.query('COMMIT');
    locationsUnmarked = counted.rows[0].count;
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  return {
    success: true,
    experienceId,
    regionId,
    locationsUnmarked,
    removed,
  };
}

/**
 * Get experience visited status with location details
 * GET /api/users/me/experiences/:id/visited-status
 */
export async function getExperienceVisitedStatus(
  { params: { id: experienceId }, caller }: { params: z.output<typeof idParamSchema>; caller: Express.User },
): Promise<ExperienceVisitedStatusResponse> {
  const userId = caller.id;

  // The place's points a reader is shown, each with the visit on its own
  // place: the part's for a part's point, the place's own otherwise.
  const result = await pool.query<
    Pick<ExperienceLocationsRow, 'name' | 'ordinal'> & Pick<ExperiencesRow, 'cast_points'>
    & { location_id: number; longitude: number; latitude: number; ticked: boolean }
    & { visit_id: number | null; marked_at: UserVisitedExperiencesRow['marked_at']; notes: UserVisitedExperiencesRow['notes'] }
  >(`
    SELECT
      el.id as location_id,
      e.cast_points,
      -- A reader's read: a part's unnamed point is called by its place (#1924).
      ${pointNameSql('el')} AS name,
      el.ordinal,
      ST_X(el.location) as longitude,
      ST_Y(el.location) as latitude,
      uv.id as visit_id,
      uv.marked_at,
      uv.notes,
      EXISTS (SELECT 1 FROM ${liveVisitsSql('$2')} own WHERE own.experience_id = e.id) AS ticked
    FROM ${placePointsSql()} pp
    JOIN experience_locations el ON el.id = pp.location_id
    -- The row this reader is asking about has to be one the catalogue offers:
    -- admission and the gate, as the place's own read asks them (ADR-0024,
    -- ADR-0025, #503). A part of a serial site is asked about as its whole
    -- offers it (ADR-0100).
    JOIN experiences e ON e.id = pp.place_id AND ${claimablePlaceSql()}
    LEFT JOIN ${liveVisitsSql('$2')} uv ON uv.experience_id = el.experience_id
    WHERE pp.place_id = $1
      -- Offered points only, like every other read that shows a place: a
      -- withdrawn point the reader visited keeps its visit, which this read,
      -- a description of the place, does not show.
      AND ${offeredLocationSql()}
      AND ${publishedContentSql('el')}
    ORDER BY el.ordinal, el.id
  `, [experienceId, userId]);

  if (result.rows.length === 0) throw notFound('Experience not found or has no locations');

  const totalLocations = result.rows.length;
  const visitedLocations = result.rows.filter(r => r.visit_id !== null).length;

  const castPoints = result.rows[0].cast_points;
  const visitedStatus = computeVisitedStatus(visitedLocations, totalLocations, result.rows[0].ticked);

  return {
    experienceId,
    visitedStatus,
    castPoints,
    totalLocations,
    visitedLocations,
    locations: result.rows.map(r => ({
      id: r.location_id,
      name: r.name,
      ordinal: r.ordinal,
      longitude: r.longitude,
      latitude: r.latitude,
      isVisited: r.visit_id !== null,
      markedAt: r.marked_at?.toISOString() ?? null,
      notes: r.notes,
    })),
  };
}
