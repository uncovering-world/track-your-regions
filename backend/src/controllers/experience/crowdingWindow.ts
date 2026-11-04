/**
 * What a curator reads before answering a crowded city (ADR-0180, #2282): the
 * window over every place of one kind and type around a place, and the
 * arrivals the city's display would shadow, grouped for the review page.
 *
 * GET /api/experiences/review/crowding/around/:membershipId?type=
 * GET /api/experiences/review/crowding/arrivals?worldViewId=&region=
 *
 * Whether a place belongs in a city's list or in its shadow is a question of
 * priorities among its neighbours, not of the place alone (the maintainer,
 * 2026-11-02), so the window draws the whole type around the card's place,
 * ordered by fame (`membership_fame.score`), with what the rule counts for each
 * row (`crowding_outranked_by()`) beside the curator's pin. Both reads touch
 * the serving tables only: the fame the run's after-step wrote, the crowded-out
 * set the schema keeps, the pins and the works (ADR-0124).
 *
 * A curator in scope of the card's membership reads the window. A row another
 * curator's scope holds is listed with `canAnswer` false when a reader is
 * shown it or it waits in its tail; an unread arrival outside the caller's
 * scope is not listed, as the review queue does not show it either.
 */

import type { z } from 'zod/v4';
import type { CrowdingWindow, ShadowedArrivals } from '../../api/responses/crowding.js';
import type { ImageCredit } from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import {
  FAME, KINDS, MEMBERSHIPS, membershipAdmittedSql, membershipCrowdedSql, membershipVisibleSql,
} from '../../db/membership.js';
import { hideLostSql } from '../../db/readerPredicates.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import { createError, notFound, Refusal } from '../../middleware/errorHandler.js';
import type {
  crowdingWindowParamSchema, crowdingWindowQuerySchema, shadowedArrivalsQuerySchema,
} from '../../types/index.js';
import { answeredSourceId, resolveExperienceScope } from './experienceScope.js';
import type { CrowdingPin } from './membershipWriter.js';
import { queueScopeSql, regionSubtreeCte } from './reviewQueueKeys.js';

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
 * An unread arrival is listed only within the caller's scope, and only while
 * its source still offers it (`arrivalOpenSql`'s terms but its crowding one);
 * a place a reader is shown or that waits in a tail is listed whoever asks.
 * Over the aliases `m` and `e`, with the scope's prelude bound.
 */
function listedSql(isAdmin: boolean): string {
  return `(${membershipVisibleSql('m')} OR (e.missing_since IS NULL AND ${queueScopeSql(isAdmin, 'm.source_id')}))`;
}

/** Where the places are counted around: the kind, the centre's point and the radius, as SQL expressions. */
export interface AroundAt { kind: string; point: string; radiusKm: string }

/**
 * Every place of the kind within the radius of a point, admitted and standing,
 * over the aliases `m` and `e`, with the scope's prelude bound. The window
 * reads it around its centre (`$2`, `centre.point`, `$4`); a review card's
 * count reads it around the card's place (`reviewQueueCrowding.ts`), so the
 * button's number is the window's.
 */
export function aroundSql(isAdmin: boolean, at: AroundAt = { kind: '$2', point: 'centre.point', radiusKm: '$4' }): string {
  return `m.kind_id = ${at.kind}
     AND e.location && crowding_box(${at.point}, ${at.radiusKm})
     AND ST_DWithin(e.location::geography, ${at.point}::geography, ${at.radiusKm} * 1000)
     AND ${membershipAdmittedSql('m')} AND ${hideLostSql('e')}
     AND ${listedSql(isAdmin)}`;
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

/**
 * The arrivals a crowded city would shadow, grouped by region, kind and type:
 * "Berlin · Squares & streets · square: 11 new". The review queue asks about
 * none of them (`arrivalOpenSql`), so this is where they are asked. Each group
 * names its arrivals best known first, so the window opens on the first and
 * steps on to one it did not cover.
 *
 * The region an arrival is grouped under is a leaf of the world view asked
 * for, or else of the first public world view that places it: a place lies in
 * a leaf of each world view that covers it, and counting it under each would
 * count it twice. An arrival no world view places is grouped under none. A
 * world view only an admin reads names its regions to an admin alone.
 *
 * A region asked for (#2349) keeps the groups within it: each arrival placed
 * in the region or under it, as the queue's Region chip reads "within"
 * (`regionSubtreeCte`), grouped under its leaf there — Berlin's squares by
 * Berlin's districts, a leaf's under the leaf itself. `none` keeps the
 * arrivals grouped under no region.
 */
export async function listShadowedArrivals(
  { query, caller }: { query: z.output<typeof shadowedArrivalsQuerySchema>; caller: Express.User },
): Promise<ShadowedArrivals> {
  const isAdmin = caller.role === 'admin';
  const within = typeof query.region === 'number';
  let regionKept = 'TRUE';
  if (query.region === 'none') regionKept = 'leaf.region_id IS NULL';
  else if (within) regionKept = 'leaf.region_id IS NOT NULL';
  const result = await pool.query<{
    region_id: number | null; region_name: string | null; world_view_id: number | null;
    kind_id: number; kind_name: string; type: string | null; arrivals: number; membership_ids: number[];
  }>(`${CURATOR_SCOPED_REGIONS_CTE}${within ? regionSubtreeCte('$4') : ''}
    SELECT leaf.region_id, leaf.region_name, leaf.world_view_id,
           m.kind_id, k.name AS kind_name, m.type, count(*)::int AS arrivals,
           array_agg(m.id ORDER BY f.score DESC NULLS LAST, m.id) AS membership_ids
      FROM ${MEMBERSHIPS} m
      JOIN experiences e ON e.id = m.experience_id
      JOIN ${KINDS} k ON k.id = m.kind_id AND k.crowding_limit IS NOT NULL
      LEFT JOIN ${FAME} f ON f.membership_id = m.id
      LEFT JOIN LATERAL (
        SELECT r.id AS region_id, r.name AS region_name, r.world_view_id
          FROM experience_regions er
          JOIN regions r ON r.id = er.region_id AND r.is_leaf
          ${within ? 'JOIN region_subtree rs ON rs.id = r.id' : ''}
          JOIN world_views wv ON wv.id = r.world_view_id
         WHERE er.experience_id = e.id
           AND (wv.is_public OR $3::boolean)
           AND ($2::int IS NULL OR r.world_view_id = $2::int)
         ORDER BY r.world_view_id, r.id
         LIMIT 1) leaf ON TRUE
     WHERE m.curation_state = 'pending' AND ${membershipAdmittedSql('m')} AND e.missing_since IS NULL
       AND ${hideLostSql('e')} AND ${membershipCrowdedSql('m')}
       AND ${queueScopeSql(isAdmin, 'm.source_id')} AND ${regionKept}
     GROUP BY leaf.region_id, leaf.region_name, leaf.world_view_id, m.kind_id, k.name, k.display_priority, m.type
     ORDER BY count(*) DESC, leaf.region_name, k.display_priority, m.type`,
    [caller.id, query.worldViewId ?? null, isAdmin, ...(within ? [query.region] : [])],
  );
  return {
    groups: result.rows.map(row => ({
      regionId: row.region_id,
      regionName: row.region_name,
      worldViewId: row.world_view_id,
      kindId: row.kind_id,
      kindName: row.kind_name,
      type: row.type,
      arrivals: row.arrivals,
      membershipIds: row.membership_ids,
    })),
  };
}
