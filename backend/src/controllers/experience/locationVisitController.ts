/**
 * A traveller's visits to the points of a place: the ticks a list draws, the
 * "n of m" its badge reads, a tick on one point and "mark all".
 *
 * A component of a serial site is a part place of one point (ADR-0100), and a
 * visit to it is recorded on the part, as a place visit, and cascades to the
 * site (decision 5): a tick on the Temple of Karnak's point writes the
 * temple's visit and Ancient Thebes'. The reads ask `visitedPointsSql`, which
 * answers a point visited by its own visit or its part's, so the site still
 * counts the temple as one of its points visited, and a merge with another
 * kind's Karnak reconciles one place visit with another.
 */

import type { z } from 'zod/v4';
import type {
  AllLocationsMarked, AllLocationsUnmarked, ExperienceVisitedStatusResponse, LocationVisitMarked, LocationVisitUnmarked,
  VisitedLocationIds, VisitedStatus,
} from '../../api/responses/visited.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import { partOfPointSql, placePointsSql, pointNameSql, pointsShownSql, visitedPointsSql } from '../../db/placePoints.js';
import type { ExperienceLocationsRow, ExperiencesRow, UserVisitedLocationsRow } from '../../db/schema.generated.js';
import {
  claimablePlaceSql,
  claimableToReaderSql,
  offeredLocationSql,
  publishedContentSql,
} from '../../db/readerPredicates.js';
import { notFound } from '../../middleware/errorHandler.js';
import { dropUnvisitedWholes, visitWholes } from './wholeVisits.js';
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
  // So all four: the gate and the content gate, because a visit to an unread
  // point is one no writer can create any more and none should be surfaced from
  // before; `admission`, because a museum this catalogue turned down is on no
  // list this reader can see; and points a reader may be shown, which since ADR-0026
  // decision 7 is two exclusions rather than one — a point the source withdrew is not somewhere
  // they can be shown to have been, and a point a curator declared gone from the world
  // is not somewhere anyone can be sent, which is a different claim resting on a
  // different person's judgement. The consequence worth stating because nothing else
  // here does: a tick on a component declared `lost` leaves this map. The
  // traveller's history is not lost by any of this — `getVisitedIds` carries
  // no lifecycle predicate at all, deliberately, and that is where a record of
  // somewhere that has since left the catalogue belongs.
  //
  // Unconditional, like the writers that create these rows: this is the
  // caller's own record, not one of the three by-id reads ADR-0025 widens for a
  // curator.
  let query = `
    SELECT uvl.location_id, pp.place_id AS experience_id
    FROM ${visitedPointsSql('$1')} uvl
    JOIN experience_locations el ON uvl.location_id = el.id
    -- Under every place that shows the point: a part's and its whole's (ADR-0100).
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

  const result = await pool.query<Pick<UserVisitedLocationsRow, 'location_id'> & Pick<ExperienceLocationsRow, 'experience_id'>>(
    query, params,
  );

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

  // Verify location exists and get experience info. Gated on curation_state,
  // both the container's and the location's own (ADR-0025): without this, any
  // authenticated caller could mark a `pending` location "visited" — a claim
  // they never made, since no read shows it to them — and this same lookup
  // echoes `el.name`/`e.name` back in the response, so the unread row's
  // content reached a non-curator through the write path. #520 argued this
  // read needed no gate because a `pending` location "cannot have been
  // visited" — true only if nothing can create that visit in the first
  // place, and this endpoint is exactly the thing that can. No curator
  // relaxation here: this is the caller's own record, not one of the three
  // by-id reads, so it stays unconditional.
  //
  // One row per place the reader may claim that shows the point (ADR-0100):
  // the point's own place first — the Temple of Karnak, a part offered where
  // Ancient Thebes is — then the wholes it is a part of.
  const locResult = await pool.query<
    Pick<ExperienceLocationsRow, 'id' | 'name' | 'experience_id'> & { experience_name: ExperiencesRow['name']; of_part: boolean }
  >(`
    SELECT el.id, el.name, pp.place_id AS experience_id, e.name as experience_name,
           (pp.place_id = el.experience_id AND EXISTS (
              SELECT 1 FROM experience_parts prt WHERE prt.part_id = el.experience_id)) AS of_part
    FROM ${placePointsSql()} pp
    JOIN experience_locations el ON el.id = pp.location_id
    JOIN experiences e ON e.id = pp.place_id
    WHERE el.id = $1 AND ${claimableToReaderSql()}
    ORDER BY (pp.place_id = el.experience_id) DESC, pp.place_id
  `, [locationId]);

  if (locResult.rows.length === 0) throw notFound('Location not found');

  const location = locResult.rows[0];

  // The visit itself: on the part, as a place visit, where the point is a
  // part's (ADR-0100 decision 5); on the point otherwise.
  const result = location.of_part
    ? await pool.query<Pick<UserVisitedLocationsRow, 'id' | 'visited_at' | 'notes'>>(`
        INSERT INTO user_visited_experiences (user_id, experience_id, notes, visited_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id, experience_id) DO UPDATE SET
          notes = COALESCE($3, user_visited_experiences.notes),
          visited_at = NOW()
        RETURNING id, visited_at, notes
      `, [userId, location.experience_id, notes])
    : await pool.query<Pick<UserVisitedLocationsRow, 'id' | 'visited_at' | 'notes'>>(`
        INSERT INTO user_visited_locations (user_id, location_id, notes, visited_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id, location_id) DO UPDATE SET
          notes = COALESCE($3, user_visited_locations.notes),
          visited_at = NOW()
        RETURNING id, visited_at, notes
      `, [userId, locationId, notes]);

  // Every place that shows the point is a place the reader has been to: the
  // visit cascades to the wholes (ADR-0046 decision 7).
  await pool.query(`
    INSERT INTO user_visited_experiences (user_id, experience_id, visited_at)
    SELECT $1, place_id, NOW() FROM unnest($2::int[]) AS place_id
    ON CONFLICT (user_id, experience_id) DO NOTHING
  `, [userId, locResult.rows.map(row => row.experience_id)]);

  const visit = result.rows[0];
  return {
    success: true,
    locationId,
    locationName: location.name,
    experienceId: location.experience_id,
    experienceName: location.experience_name,
    id: visit.id,
    visited_at: visit.visited_at?.toISOString() ?? null,
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
  const userId = caller.id;

  // The places that show the point, before deleting: its own, and the wholes
  // it is a part of (ADR-0100), the point's own place first.
  const locResult = await pool.query<{ experience_id: number; of_part: boolean }>(`
    SELECT pp.place_id AS experience_id,
           (pp.place_id = el.experience_id AND EXISTS (
              SELECT 1 FROM experience_parts prt WHERE prt.part_id = el.experience_id)) AS of_part
    FROM ${placePointsSql()} pp
    JOIN experience_locations el ON el.id = pp.location_id
    JOIN experiences e ON e.id = pp.place_id
    WHERE el.id = $1
    -- The place the tick was answered under first, as markLocationVisited names it.
    ORDER BY ${claimablePlaceSql()} DESC, (pp.place_id = el.experience_id) DESC, pp.place_id
  `, [locationId]);

  if (locResult.rows.length === 0) throw notFound('Location not found');

  const experienceId = locResult.rows[0].experience_id;
  const places = locResult.rows.map(row => row.experience_id);
  const part = locResult.rows.find(row => row.of_part)?.experience_id;

  // Delete the visit record: the part's, where the point is a part's
  // (ADR-0100 decision 5), the point's own otherwise.
  // A tick on the point itself is taken too, should one outlive its parting.
  const pointVisit = await pool.query(
    'DELETE FROM user_visited_locations WHERE user_id = $1 AND location_id = $2 RETURNING id', [userId, locationId],
  );
  const partVisit = part === undefined
    ? { rowCount: 0 }
    : await pool.query(
      'DELETE FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2 RETURNING id', [userId, part],
    );
  const result = { rowCount: (pointVisit.rowCount ?? 0) + (partVisit.rowCount ?? 0) };

  if (result.rowCount === 0) throw notFound('Visit record not found');

  // Does the reader still hold a visit to a point this experience offers? If
  // not, the experience-level record goes with the last one.
  //
  // Offered points only, or unticking the last visible point leaves a record
  // nothing can reach: a surviving visit on a withdrawn point would keep the
  // count at one, the list would keep its check, and the progress view — which
  // shows offered points only — would report none visited with no tick on
  // screen to remove. Before locations were kept, the withdrawn row and its
  // visit were deleted together and this count reached zero on its own.
  //
  // Asked of every place that shows the point: a whole keeps its record while
  // the reader holds a visit to another of its parts.
  await pool.query(`
    DELETE FROM user_visited_experiences uve
    WHERE uve.user_id = $1 AND uve.experience_id = ANY($2::int[])
      AND NOT EXISTS (
        SELECT 1 FROM ${pointsShownSql('uve.experience_id', 'el')}
        JOIN ${visitedPointsSql('$1')} uvl ON uvl.location_id = el.id
        WHERE ${offeredLocationSql()})
  `, [userId, places]);

  return { success: true, locationId, experienceId };
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

  // Get locations for this experience, optionally filtered by region
  let locationsQuery: string;
  let locationsParams: number[];

  // "All of them" means the ones on offer. A point the source withdrew is on
  // no list this reader can see, so recording a visit to it would be a claim
  // they never made. The same is true of a point nobody has read yet: gated
  // on curation_state, both the container's and the location's own
  // (ADR-0025), or "mark all" would write a visit to a `pending` location no
  // read ever showed this reader and answer `locationsMarked` with a count
  // that discloses the size of the unread set (#520 — the write path this
  // read's own predicate assumed could not exist).
  if (regionId) {
    // Only locations that are in the specified region
    locationsQuery = `
      SELECT el.id, ${partOfPointSql()} AS part_id
      FROM ${placePointsSql()} pp
      JOIN experience_locations el ON el.id = pp.location_id
      JOIN experience_location_regions elr ON elr.location_id = el.id
      JOIN experiences e ON e.id = pp.place_id
      WHERE pp.place_id = $1 AND elr.region_id = $2
        AND ${claimableToReaderSql()}
    `;
    locationsParams = [experienceId, regionId];
  } else {
    // All locations
    locationsQuery = `SELECT el.id, ${partOfPointSql()} AS part_id FROM ${placePointsSql()} pp
       JOIN experience_locations el ON el.id = pp.location_id
       JOIN experiences e ON e.id = pp.place_id
       WHERE pp.place_id = $1 AND ${claimableToReaderSql()}`;
    locationsParams = [experienceId];
  }

  const locationsResult = await pool.query<{ id: number; part_id: number | null }>(locationsQuery, locationsParams);

  if (locationsResult.rows.length === 0) throw notFound('Experience not found or has no locations in this region');

  // Mark locations as visited in a single transaction, on one client — see the
  // note in curationEditController: pg.Pool hands out an arbitrary idle client per
  // call, so a transaction has to be pinned or its statements land on different
  // connections, and the BEGIN goes back to the pool with nothing to close it.
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');

    // A part's point is visited on the part (ADR-0100 decision 5).
    for (const loc of locationsResult.rows) {
      await (loc.part_id === null
        ? client.query(`
          INSERT INTO user_visited_locations (user_id, location_id, visited_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (user_id, location_id) DO NOTHING
        `, [userId, loc.id])
        : client.query(`
          INSERT INTO user_visited_experiences (user_id, experience_id, visited_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (user_id, experience_id) DO NOTHING
        `, [userId, loc.part_id]));
    }

    // Also mark the experience itself as visited for backward compatibility
    await client.query(`
      INSERT INTO user_visited_experiences (user_id, experience_id, visited_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, experience_id) DO NOTHING
    `, [userId, experienceId]);
    // And the sites it is a part of (ADR-0100).
    await visitWholes(userId, experienceId, client);

    await client.query('COMMIT');
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
    locationsMarked: locationsResult.rows.length,
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

  // One client for the whole transaction, as in `markAllLocationsVisited` above.
  // This half is the sharper one: its body is deletes, so a ROLLBACK that
  // reached a shared connection would resurrect visits a different reader had
  // just cleared.
  const client = await pool.connect();
  let unusable: Error | undefined;
  let locationsUnmarked: number;
  try {
    await client.query('BEGIN');

    // The points to clear, the region's alone where one is named.
    const points = regionId
      ? `SELECT pp.location_id FROM ${placePointsSql()} pp
           JOIN experience_location_regions elr ON elr.location_id = pp.location_id
          WHERE pp.place_id = $2 AND elr.region_id = $3`
      : `SELECT pp.location_id FROM ${placePointsSql()} pp WHERE pp.place_id = $2`;
    const params = regionId ? [userId, experienceId, regionId] : [userId, experienceId];

    const pointVisits = await client.query(`
      DELETE FROM user_visited_locations
      WHERE user_id = $1 AND location_id IN (${points})
    `, params);
    // A part's point was visited on the part (ADR-0100 decision 5).
    const partVisits = await client.query(`
      DELETE FROM user_visited_experiences
      WHERE user_id = $1 AND experience_id IN (
        SELECT el.experience_id FROM experience_locations el
         WHERE el.id IN (${points})
           AND EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.part_id = el.experience_id))
    `, params);

    // The same question as in `unmarkLocationVisited`, asked the same way — see
    // the note there. It matters on the region-scoped branch above, which
    // clears one region's visits and can leave a withdrawn point's visit
    // standing somewhere else.
    const remainingResult = await client.query(`
      SELECT COUNT(*) as count
      FROM ${visitedPointsSql('$1')} uvl
      JOIN experience_locations el ON uvl.location_id = el.id
      JOIN ${placePointsSql()} pp ON pp.location_id = el.id
      WHERE pp.place_id = $2
        AND ${offeredLocationSql()}
    `, [userId, experienceId]);

    if (parseInt(remainingResult.rows[0].count) === 0) {
      await client.query(
        'DELETE FROM user_visited_experiences WHERE user_id = $1 AND experience_id = $2',
        [userId, experienceId]
      );
    }
    // And the sites it is a part of, once none of their points is visited (ADR-0100).
    await dropUnvisitedWholes(userId, experienceId, client);

    await client.query('COMMIT');
    locationsUnmarked = (pointVisits.rowCount ?? 0) + (partVisits.rowCount ?? 0);
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

  // Get all locations with their visited status
  // The place's own columns, the two coordinates it computes, and the visit the
  // LEFT JOIN may not find, so each visit column may be null.
  const result = await pool.query<
    Pick<ExperienceLocationsRow, 'name' | 'ordinal'> & { location_id: number; longitude: number; latitude: number }
    & { visit_id: number | null; visited_at: UserVisitedLocationsRow['visited_at']; notes: UserVisitedLocationsRow['notes'] }
  >(`
    SELECT
      el.id as location_id,
      -- A reader's read: a part's unnamed point is called by its place (#1924).
      ${pointNameSql('el')} AS name,
      el.ordinal,
      ST_X(el.location) as longitude,
      ST_Y(el.location) as latitude,
      uvl.location_id as visit_id,
      uvl.visited_at,
      uvl.notes
    FROM ${placePointsSql()} pp
    JOIN experience_locations el ON el.id = pp.location_id
    -- The row this reader is asking about has to be one the catalogue offers.
    -- Without this join no admission predicate reached here at all, so any
    -- authenticated account got a refused museum's points back -- coordinates,
    -- ordinals and a confident totalLocations -- at the very moment the two
    -- reads under /:id, the row itself and its locations, both answered 404
    -- (ADR-0024, #503). Admission and not existence, matching those two.
    -- The pending gate rides beside it, unrelaxed: this read is not one of the
    -- three by-id reads ADR-0025 widens for a curator, so an unread museum's
    -- points stay out of a progress denominator the same way a refused one does.
    -- A part of a serial site is asked about as its whole offers it (ADR-0100).
    JOIN experiences e ON e.id = pp.place_id AND ${claimablePlaceSql()}
    -- Its own visit, or its part's (ADR-0100 decision 5).
    LEFT JOIN ${visitedPointsSql('$2')} uvl ON uvl.location_id = el.id
    WHERE pp.place_id = $1
      -- Offered points only, like every other read that shows a place.
      --
      -- Not a withdrawn point this reader has visited, even to keep their
      -- record of it in view: a replaced point shows why. Identity is the point together with the
      -- source's reference, so an edit to either — a component moved to a new place, one
      -- renumbered and moved (ADR-0090) — is a withdrawal plus an insert, and the reader
      -- would meet the same place twice, once ticked and once not, with this
      -- denominator
      -- disagreeing with the location_count every list shows. The visit row is
      -- untouched, which is what this slice protects; giving it a place on
      -- screen needs the curator verdict on whether the place is gone at all.
      --
      -- The admission join above is untouched by all of that, and follows the
      -- same line from the other side. The rule: the catalogue's reads refuse a
      -- kept-out row; a record of what a person did is theirs and stays. This
      -- read is the catalogue describing an experience — a denominator and a
      -- list of its points — so it closes. A person's own record of what they
      -- visited does not, and neither does the write path: if a traveller stood
      -- in the British Museum, that is true whether or not this kind calls it
      -- an art museum.
      AND ${offeredLocationSql()}
      AND ${publishedContentSql('el')}
    ORDER BY el.ordinal, el.id
  `, [experienceId, userId]);

  if (result.rows.length === 0) throw notFound('Experience not found or has no locations');

  const totalLocations = result.rows.length;
  const visitedLocations = result.rows.filter(r => r.visit_id !== null).length;

  // Compute visited status
  let visitedStatus: VisitedStatus;
  if (visitedLocations === 0) {
    visitedStatus = 'not_visited';
  } else if (visitedLocations === totalLocations) {
    visitedStatus = 'visited';
  } else {
    visitedStatus = 'partial';
  }

  return {
    experienceId,
    visitedStatus,
    totalLocations,
    visitedLocations,
    locations: result.rows.map(r => ({
      id: r.location_id,
      name: r.name,
      ordinal: r.ordinal,
      longitude: r.longitude,
      latitude: r.latitude,
      isVisited: r.visit_id !== null,
      visitedAt: r.visited_at?.toISOString() ?? null,
      notes: r.notes,
    })),
  };
}
