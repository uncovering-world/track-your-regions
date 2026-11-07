/**
 * The window around one membership (ADR-0180, #2282), as the review page's
 * current screens read it: every place of one kind and type within the radius
 * of the card's place, best known first.
 *
 * GET /api/experiences/review/crowding/around/:membershipId?type=
 *
 * The crowded-city window becomes the region's list with a place's own circle
 * (ADR-0183, #2358, `crowdingWindow.ts`); this read stays only until the web's
 * window moves to those reads, and goes with the screens that call it.
 *
 * A curator in scope of the card's membership reads the window. A row another
 * curator's scope holds is listed with `canAnswer` false when a reader is
 * shown it or it waits in its tail; an unread arrival outside the caller's
 * scope is not listed, as the review queue does not show it either.
 */

import type { z } from 'zod/v4';
import type { CrowdingWindow } from '../../api/responses/crowding.js';
import type { ImageCredit } from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import { FAME, KINDS, MEMBERSHIPS, membershipCrowdedSql } from '../../db/membership.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type { crowdingWindowParamSchema, crowdingWindowQuerySchema } from '../../types/index.js';
import { aroundSql } from './crowdingWindow.js';
import { answeredSourceId, resolveExperienceScope } from './experienceScope.js';
import type { CrowdingPin } from './membershipWriter.js';
import { queueScopeSql } from './reviewQueueKeys.js';

/** The most rows one window lists: the densest type on dev, Rome's churches, holds about 150. */
const WINDOW_ROWS_MAX = 500;

/** The card's membership and the rule its kind declares. */
interface Centre {
  id: number;
  experience_id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  kind_id: number;
  kind_name: string;
  type: string | null;
  crowding_limit: number | null;
  crowding_radius_km: number | null;
  crowding_exempt_types: string[];
}

interface WindowRow {
  membership_id: number;
  experience_id: number;
  name: string;
  latitude: number;
  longitude: number;
  distance_m: number;
  wikipedia_url: string | null;
  image_url: string | null;
  image_credit: ImageCredit | null;
  readers: number | null;
  guide_editions: number | null;
  wikipedia_editions: number | null;
  score: number | null;
  outranked_by: number | null;
  arriving: boolean;
  crowded: boolean;
  pin: CrowdingPin | null;
  holds_works: boolean;
  outranks_centre: boolean | null;
  can_answer: boolean;
}

/**
 * The window over a crowded city around a membership: every place of its
 * kind and type within the kind's radius, best known first.
 */
export async function getCrowdingWindow(
  { params: { membershipId }, query, caller }: {
    params: z.output<typeof crowdingWindowParamSchema>;
    query: z.output<typeof crowdingWindowQuerySchema>;
    caller: Express.User;
  },
): Promise<CrowdingWindow> {
  const centre = await readCentre(membershipId);
  if (!centre) throw notFound('Membership not found');
  const sourceId = await answeredSourceId(centre.experience_id, membershipId, 'named');
  if (sourceId === null) throw notFound('Membership not found');
  const { permitted } = await resolveExperienceScope(caller.id, caller.role, centre.experience_id, sourceId);
  if (!permitted) throw createError('You do not have curator permissions for this experience', 403);
  if (centre.crowding_limit === null || centre.crowding_radius_km === null) {
    throw new Refusal(409, { error: `${centre.kind_name} shows every place it admits: no crowded city to answer` });
  }
  if (centre.latitude === null || centre.longitude === null) {
    throw new Refusal(409, { error: 'This place has no point, so nothing lies around it' });
  }

  const isAdmin = caller.role === 'admin';
  const type = query.type ?? centre.type;
  const exempt = type !== null && centre.crowding_exempt_types.includes(type);
  const sameType = type === centre.type;
  // $1 the caller (the scope's prelude), $2 the kind, $3 the centre's place, $4 the radius.
  const around = [caller.id, centre.kind_id, centre.experience_id, centre.crowding_radius_km];
  const centrePoint = `CROSS JOIN (SELECT ce.location AS point FROM experiences ce WHERE ce.id = $3) centre`;

  const [rows, types] = await Promise.all([
    pool.query<WindowRow>(`${CURATOR_SCOPED_REGIONS_CTE}
      SELECT m.id AS membership_id, e.id AS experience_id, e.name,
             ST_Y(e.location) AS latitude, ST_X(e.location) AS longitude,
             round(ST_Distance(e.location::geography, centre.point::geography))::int AS distance_m,
             -- What the place is, as its review card shows it (#2345): its article,
             -- its picture and whose photograph that is, which the row draws together.
             e.metadata->>'wikipediaUrl' AS wikipedia_url, e.image_url,
             e.metadata->'imageCredit' AS image_credit,
             f.readers, f.guide_editions, f.wikipedia_editions, f.score,
             crowding_outranked_by(m.id) AS outranked_by,
             m.curation_state = 'pending' AS arriving,
             ${membershipCrowdedSql('m')} AS crowded,
             m.crowding_pin AS pin,
             place_shows_works(e.id) AS holds_works,
             -- Whether the row is one of those the centre's own count counts:
             -- which places shadow the card's place (#2228).
             (m.id <> $6 AND m.crowding_pin IS DISTINCT FROM 'shadow' AND NOT place_shows_works(e.id)
               AND (m.crowding_pin = 'list'
                    OR f.score > (SELECT cf.score FROM ${FAME} cf WHERE cf.membership_id = $6))) AS outranks_centre,
             ${queueScopeSql(isAdmin, 'm.source_id')} AS can_answer
        FROM ${MEMBERSHIPS} m
        JOIN experiences e ON e.id = m.experience_id
        LEFT JOIN ${FAME} f ON f.membership_id = m.id
        ${centrePoint}
       WHERE ${aroundSql(isAdmin)} AND m.type IS NOT DISTINCT FROM $5::text
       ORDER BY f.score DESC NULLS LAST, e.name, m.id
       LIMIT ${WINDOW_ROWS_MAX}`, [...around, type, centre.id]),
    pool.query<{ type: string | null; places: number }>(`${CURATOR_SCOPED_REGIONS_CTE}
      SELECT m.type, count(*)::int AS places
        FROM ${MEMBERSHIPS} m
        JOIN experiences e ON e.id = m.experience_id
        ${centrePoint}
       WHERE ${aroundSql(isAdmin)}
       GROUP BY m.type
       ORDER BY count(*) DESC, m.type`, around),
  ]);

  const limit = centre.crowding_limit;
  return {
    centre: {
      membershipId: centre.id,
      experienceId: centre.experience_id,
      name: centre.name,
      latitude: centre.latitude,
      longitude: centre.longitude,
      type: centre.type,
    },
    kind: { id: centre.kind_id, name: centre.kind_name, limit, radiusKm: centre.crowding_radius_km },
    type,
    typeExempt: exempt,
    types: types.rows.map(row => ({
      type: row.type,
      places: row.places,
      exempt: row.type !== null && centre.crowding_exempt_types.includes(row.type),
    })),
    rows: rows.rows.map(row => {
      // Where the rule puts the place whatever its own pin says: never in the
      // shadow while it holds works or its type is exempt, nor before it is scored.
      const ruleCrowded = !exempt && !row.holds_works && row.score !== null
        && row.outranked_by !== null && row.outranked_by >= limit;
      return {
        membershipId: row.membership_id,
        experienceId: row.experience_id,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        distanceM: row.distance_m,
        wikipediaUrl: row.wikipedia_url,
        imageUrl: row.image_url,
        imageCredit: row.image_credit,
        readers: row.readers,
        guideEditions: row.guide_editions,
        guideUsed: row.guide_editions === null ? null : row.guide_editions > 0,
        wikipediaEditions: row.wikipedia_editions,
        score: row.score,
        outrankedBy: exempt ? null : row.outranked_by,
        standing: standingOf(row),
        crowded: row.crowded,
        ruleCrowded,
        pin: row.pin,
        holdsWorks: row.holds_works,
        pinnable: !exempt && !row.holds_works,
        outranksCentre: sameType && !exempt ? Boolean(row.outranks_centre) : null,
        canAnswer: row.can_answer,
      };
    }),
  };
}

/** Where a row stands now: a new arrival nobody has passed, in the tail, or in the list. */
function standingOf(row: Pick<WindowRow, 'arriving' | 'crowded'>): 'new' | 'shadowed' | 'listed' {
  if (row.arriving) return 'new';
  return row.crowded ? 'shadowed' : 'listed';
}

async function readCentre(membershipId: number): Promise<Centre | undefined> {
  const result = await pool.query<Centre>(
    `SELECT m.id, m.experience_id, e.name, ST_Y(e.location) AS latitude, ST_X(e.location) AS longitude,
            m.kind_id, k.name AS kind_name, m.type,
            k.crowding_limit, k.crowding_radius_km, k.crowding_exempt_types
       FROM ${MEMBERSHIPS} m
       JOIN experiences e ON e.id = m.experience_id
       JOIN ${KINDS} k ON k.id = m.kind_id
      WHERE m.id = $1`,
    [membershipId],
  );
  return result.rows[0];
}
