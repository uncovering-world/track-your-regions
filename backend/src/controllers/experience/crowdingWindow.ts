/**
 * What a curator reads before answering a crowded city (ADR-0180, ADR-0183, #2282,
 * #2358): a group's places as its region page shows them, one place in its own
 * circle, and the arrivals the city's display would shadow, grouped for the
 * review page.
 *
 * GET /api/experiences/review/crowding/group?region=&kind=&type=
 * GET /api/experiences/review/crowding/place/:membershipId
 * GET /api/experiences/review/crowding/arrivals?worldViewId=&region=
 *
 * What a curator decides is what a region's page shows, so the window is the
 * region's list (the maintainer, 2026-11-04): one region, one kind and one
 * type, every place of it, those shown, those the rule shadows and the new
 * arrivals, best known first (`membership_fame.score`). A place opened from it
 * is read in its own circle: every place of its type within the radius, and
 * which of them it is compared with — the ones that count above it, as the rule
 * itself lists them (`crowding_above()`), so the list and the count are one.
 * The reads touch the serving tables only: the fame the run's after-step
 * wrote, the crowded-out set the schema keeps, the pins and the works
 * (ADR-0124).
 *
 * A place another curator's scope holds is listed with `canAnswer` false when
 * a reader is shown it or it waits in its tail; an unread arrival outside the
 * caller's scope is not listed, as the review queue does not show it either.
 */

import type { z } from 'zod/v4';
import type {
  CrowdingGroup, CrowdingGroupPlace, CrowdingPlaceView, ShadowedArrivals,
} from '../../api/responses/crowding.js';
import type { ImageCredit } from '../../api/responses/experiences.js';
import { pool } from '../../db/index.js';
import {
  FAME, KINDS, MEMBERSHIPS, membershipAdmittedSql, membershipCrowdedSql, membershipVisibleSql,
} from '../../db/membership.js';
import { hideLostSql } from '../../db/readerPredicates.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import { notFound, Refusal } from '../../middleware/errorHandler.js';
import type {
  crowdingGroupQuerySchema, crowdingPlaceParamSchema, crowdingPlaceQuerySchema, shadowedArrivalsQuerySchema,
} from '../../types/index.js';
import { notRejectedInSql } from './experienceRegionQuery.js';
import { measurableSql } from '../../services/sync/crowding.js';
import type { CrowdingPin } from './membershipWriter.js';
import { queueScopeSql, regionSubtreeCte } from './reviewQueueKeys.js';

/** The most places one group lists: England's streets, the longest group on dev, hold about 260. */
const GROUP_PLACES_MAX = 1000;

/** The most places one circle lists: the densest type on dev, Rome's churches, holds about 150 within 10 km. */
const AROUND_MAX = 500;

/**
 * The source of the run in progress whose end measures fame again: every run
 * that is not a dry run measures every place of a kind with the rule in its
 * after-step (`refreshCrowding`), so a place not measured yet waits for the
 * first such run to end (#2420). Alive as the swap of a dump copy reads it:
 * `running`, with its progress written in the last five minutes. Null where
 * none runs. The after-step runs once a run's row has closed, so for those
 * minutes a place reads as waiting for the next run, which is still true.
 */
export async function measuringRun(): Promise<string | null> {
  const result = await pool.query<{ name: string }>(
    `SELECT s.name
       FROM experience_sync_logs l JOIN experience_sources s ON s.id = l.source_id
      WHERE l.status = 'running' AND NOT l.is_dry_run
        AND COALESCE(l.progress_at, l.started_at) > NOW() - interval '5 minutes'
      ORDER BY l.started_at
      LIMIT 1`);
  return result.rows[0]?.name ?? null;
}

/** How many of the better-known places a hover names. */
const NAMED_ABOVE = 3;

/** A kind and the rule it declares. */
interface KindRule {
  id: number;
  name: string;
  crowding_limit: number | null;
  crowding_radius_km: number | null;
  crowding_exempt_types: string[];
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
 * over the aliases `m` and `e`, with the scope's prelude bound. A place's
 * circle reads it around the place (`$2`, `centre.point`, `$4`); a review
 * card's count reads it around the card's place (`reviewQueueCrowding.ts`),
 * so the button's number is the circle's.
 */
export function aroundSql(isAdmin: boolean, at: AroundAt = { kind: '$2', point: 'centre.point', radiusKm: '$4' }): string {
  return `m.kind_id = ${at.kind}
     AND e.location && crowding_box(${at.point}, ${at.radiusKm})
     AND ST_DWithin(e.location::geography, ${at.point}::geography, ${at.radiusKm} * 1000)
     AND ${membershipAdmittedSql('m')} AND ${hideLostSql('e')}
     AND ${listedSql(isAdmin)}`;
}

/**
 * The leaf region a place is grouped under, as `leaf`: one a curator did not
 * reject the place from, where it has one, then a leaf of the world view
 * asked for, or else of the first public world view that places it. A place
 * lies in a leaf of each world view that covers it, and counting it under each
 * would count it twice. A world view only an admin reads names its regions to
 * an admin alone. With `within`, only a leaf of `region_subtree`.
 */
function groupLeafSql({ isAdmin, worldView, within }: { isAdmin: string; worldView: string; within: boolean }): string {
  return `LEFT JOIN LATERAL (
        SELECT r.id AS region_id, r.name AS region_name, r.world_view_id
          FROM experience_regions er
          JOIN regions r ON r.id = er.region_id AND r.is_leaf
          ${within ? 'JOIN region_subtree rs ON rs.id = r.id' : ''}
          JOIN world_views wv ON wv.id = r.world_view_id
         WHERE er.experience_id = e.id
           AND (wv.is_public OR ${isAdmin}::boolean)
           AND (${worldView}::int IS NULL OR r.world_view_id = ${worldView}::int)
         ORDER BY ${notRejectedInSql('r.id')} DESC, r.world_view_id, r.id
         LIMIT 1) leaf ON TRUE`;
}

interface PlaceRow {
  membership_id: number;
  /** Whether a run can measure it (`measurableSql`). */
  measurable: boolean;
  experience_id: number;
  name: string;
  latitude: number;
  longitude: number;
  wikipedia_url: string | null;
  image_url: string | null;
  image_credit: ImageCredit | null;
  readers: number | null;
  wikipedia_editions: number | null;
  guide_used: boolean | null;
  score: number | null;
  arriving: boolean;
  crowded: boolean;
  pin: CrowdingPin | null;
  holds_works: boolean;
  /** Whether the rule's count was read for the place: in the tail, pinned, or asked for. */
  reads: boolean;
  better: number;
  better_known: string[] | null;
  can_answer: boolean;
}

/** What a place's score is made of and the score, as a row reads them (`FAME_SIGNALS`). */
type Signals = Pick<PlaceRow, 'readers' | 'wikipedia_editions' | 'guide_used' | 'score'>;

/**
 * What a place's score is made of and the score itself, over its fame row `f`
 * (#2400). A signal no reading is dated for is the zero the row is ranked at
 * before its first reading, not a measurement (ADR-0175 decision 6), so it is
 * read as null; a place with no fame row reads null throughout.
 */
const FAME_SIGNALS = `CASE WHEN f.readers_read_at IS NOT NULL THEN f.readers END AS readers,
             f.wikipedia_editions,
             CASE WHEN f.guides_read_at IS NOT NULL THEN f.guide_editions > 0 END AS guide_used,
             f.score`;

/** The signals of a row as the response names them. */
function signalsOf(row: Signals): Pick<CrowdingGroupPlace, 'readers' | 'wikipediaEditions' | 'guideUsed' | 'score'> {
  return { readers: row.readers, wikipediaEditions: row.wikipedia_editions, guideUsed: row.guide_used, score: row.score };
}

/**
 * A place's columns and the joins they need, over the aliases `m` and `e`, the
 * kind's radius `radiusKm`. The rule's count and the names of the best known
 * above the place are read where `reads` holds, through `crowding_above()`
 * itself: for a place in the tail or pinned on the region's list, which
 * a hover explains, and for the place a circle opens on. A place the region
 * page shows unpinned has fewer than the limit above it, and its circle says
 * how many. The names are of published places only, so no unread arrival of
 * another curator's scope is named.
 */
function placeColumnsSql(isAdmin: boolean, radiusKm: string, reads: string): { columns: string; joins: string } {
  return {
    columns: `m.id AS membership_id, e.id AS experience_id, e.name,
             ST_Y(e.location) AS latitude, ST_X(e.location) AS longitude,
             -- What the place is, as its review card shows it (#2345): its article,
             -- its picture and whose photograph that is, which the row draws together.
             e.metadata->>'wikipediaUrl' AS wikipedia_url, e.image_url,
             e.metadata->'imageCredit' AS image_credit,
             ${FAME_SIGNALS},
             m.curation_state = 'pending' AS arriving,
             ${membershipCrowdedSql('m')} AS crowded,
             m.crowding_pin AS pin,
             ${measurableSql('m')} AS measurable,
             place_shows_works(e.id) AS holds_works,
             (${reads}) AS reads, above.better, above.names AS better_known,
             ${queueScopeSql(isAdmin, 'm.source_id')} AS can_answer`,
    joins: `LEFT JOIN ${FAME} f ON f.membership_id = m.id
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS better,
                 (array_agg(de.name ORDER BY df.score DESC NULLS LAST, de.name)
                    FILTER (WHERE ${membershipVisibleSql('d')}))[1:${NAMED_ABOVE}] AS names
            FROM crowding_above(m.kind_id, m.type, m.id, e.location, ${radiusKm}, f.score) a
            JOIN ${MEMBERSHIPS} d ON d.id = a.membership_id
            JOIN experiences de ON de.id = d.experience_id
            LEFT JOIN ${FAME} df ON df.membership_id = d.id
           WHERE ${reads}) above`,
  };
}

/** A place's row as the window reads it. */
function toPlace(row: PlaceRow, kind: KindRule, exempt: boolean): CrowdingGroupPlace {
  const outrankedBy = row.reads && !exempt ? row.better : null;
  // Where the rule puts the place whatever its own pin says: never in the
  // shadow while it holds works or its type is exempt, nor before it is scored.
  const ruleCrowded = !exempt && !row.holds_works && row.score !== null
    && outrankedBy !== null && outrankedBy >= (kind.crowding_limit ?? Infinity);
  return {
    membershipId: row.membership_id,
    experienceId: row.experience_id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    wikipediaUrl: row.wikipedia_url,
    imageUrl: row.image_url,
    imageCredit: row.image_credit,
    ...signalsOf(row),
    standing: standingOf(row),
    crowded: row.crowded,
    outrankedBy,
    betterKnown: outrankedBy === null ? [] : row.better_known ?? [],
    ruleCrowded,
    pin: row.pin,
    holdsWorks: row.holds_works,
    pinnable: !exempt && !row.holds_works,
    canAnswer: row.can_answer,
  };
}

/** Where a place stands now: a new arrival nobody has passed, in the tail, or on the region page. */
function standingOf(row: Pick<PlaceRow, 'arriving' | 'crowded'>): 'new' | 'shadowed' | 'shown' {
  if (row.arriving) return 'new';
  return row.crowded ? 'shadowed' : 'shown';
}

/** The kind's rule, or a refusal where it has none: a kind that shows every place has no crowded city. */
async function readRule(kindId: number): Promise<KindRule & { crowding_limit: number; crowding_radius_km: number }> {
  const result = await pool.query<KindRule>(
    `SELECT id, name, crowding_limit, crowding_radius_km, crowding_exempt_types FROM ${KINDS} WHERE id = $1`, [kindId]);
  const kind = result.rows[0];
  if (!kind) throw notFound('Kind not found');
  if (kind.crowding_limit === null || kind.crowding_radius_km === null) {
    throw new Refusal(409, { error: `${kind.name} shows every place it admits: no crowded city to answer` });
  }
  return { ...kind, crowding_limit: kind.crowding_limit, crowding_radius_km: kind.crowding_radius_km };
}

function kindOf(kind: KindRule & { crowding_limit: number; crowding_radius_km: number }) {
  return { id: kind.id, name: kind.name, limit: kind.crowding_limit, radiusKm: kind.crowding_radius_km };
}

/**
 * A crowded city's group as its region page shows it (#2358): every place of
 * the kind and type placed in the region or under it (`regionSubtreeCte`, as
 * the Region chip reads "within") and not rejected from it, or for `none` the
 * places no leaf of a public world view places, as the shadowed arrivals'
 * `none` group reads them, best known first.
 */
export async function getCrowdingGroup(
  { query, caller }: { query: z.output<typeof crowdingGroupQuerySchema>; caller: Express.User },
): Promise<CrowdingGroup> {
  const kind = await readRule(query.kind);
  const isAdmin = caller.role === 'admin';
  const type = query.type ?? null;
  const exempt = type !== null && kind.crowding_exempt_types.includes(type);

  let regionName: string | null = null;
  if (query.region !== 'none') {
    const region = await pool.query<{ name: string }>(
      `SELECT r.name FROM regions r JOIN world_views wv ON wv.id = r.world_view_id
        WHERE r.id = $1 AND (wv.is_public OR $2::boolean)`, [query.region, isAdmin]);
    if (!region.rows[0]) throw notFound('Region not found');
    regionName = region.rows[0].name;
  }
  const within = query.region !== 'none';
  // The places the region's page holds: placed in it or under it, less what a curator rejected
  // from it. For `none`, the places no leaf of a public world view places (`groupLeafSql`), the
  // world view asked for where one is, as the shadowed arrivals' `none` group reads them, so every
  // arrival that group counts is answered here.
  const inRegion = within
    ? `EXISTS (SELECT 1 FROM experience_regions er JOIN region_subtree rs ON rs.id = er.region_id
                WHERE er.experience_id = e.id)
       AND ${notRejectedInSql('SELECT id FROM region_subtree')}`
    : 'leaf.region_id IS NULL';
  // $1 the caller (the scope's prelude), $2 the kind, $3 the type, $4 the radius; then $5 the
  // region, or for `none` $5 whether an admin asks and $6 the world view.
  const { columns, joins } = placeColumnsSql(isAdmin, '$4',
    `NOT ${exempt} AND (${membershipCrowdedSql('m')} OR m.crowding_pin IS NOT NULL)`);
  const leaf = within ? '' : groupLeafSql({ isAdmin: '$5', worldView: '$6', within: false });
  const result = await pool.query<PlaceRow>(`${CURATOR_SCOPED_REGIONS_CTE}${within ? regionSubtreeCte('$5') : ''}
    SELECT ${columns}
      FROM ${MEMBERSHIPS} m
      JOIN experiences e ON e.id = m.experience_id
      ${joins}
      ${leaf}
     WHERE m.kind_id = $2 AND m.type IS NOT DISTINCT FROM $3::text AND e.location IS NOT NULL
       AND ${membershipAdmittedSql('m')} AND ${hideLostSql('e')} AND ${listedSql(isAdmin)}
       AND ${inRegion}
     ORDER BY f.score DESC NULLS LAST, e.name, m.id
     LIMIT ${GROUP_PLACES_MAX + 1}`,
  [caller.id, kind.id, type, kind.crowding_radius_km,
    ...(within ? [query.region] : [isAdmin, query.worldViewId ?? null])]);

  return {
    group: { regionId: within ? Number(query.region) : null, regionName, kindId: kind.id, type },
    kind: kindOf(kind),
    typeExempt: exempt,
    places: result.rows.slice(0, GROUP_PLACES_MAX).map(row => toPlace(row, kind, exempt)),
    truncated: result.rows.length > GROUP_PLACES_MAX,
  };
}

/**
 * A place of a crowded city in its own circle (#2358): the place with the
 * rule's count, the group it is listed under (its leaf in the world view
 * asked for, as the group and arrivals reads group it), and every other place of its
 * kind and type within the radius (`aroundSql`, the card's count), each
 * marked where it counts above the place (`crowding_above()`). The rule
 * counts a new arrival the curator's scope leaves out, and one whose source no
 * longer lists it; the circle lists neither, as the review queue does not, and
 * says how many it leaves out (`comparedUnlisted`), so its list and the
 * place's count still add up. A place not measured yet is compared with
 * nothing, and the read names the run whose end measures it (`measuringRun`).
 */
export async function getCrowdingPlace(
  { params: { membershipId }, query, caller }: {
    params: z.output<typeof crowdingPlaceParamSchema>;
    query: z.output<typeof crowdingPlaceQuerySchema>;
    caller: Express.User;
  },
): Promise<CrowdingPlaceView> {
  const found = await pool.query<{ kind_id: number; type: string | null; experience_id: number; located: boolean }>(
    `SELECT m.kind_id, m.type, m.experience_id, e.location IS NOT NULL AS located
       FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id WHERE m.id = $1`, [membershipId]);
  const centre = found.rows[0];
  if (!centre) throw notFound('Membership not found');
  const kind = await readRule(centre.kind_id);
  if (!centre.located) throw new Refusal(409, { error: 'This place has no point, so nothing lies around it' });
  const isAdmin = caller.role === 'admin';
  const exempt = centre.type !== null && kind.crowding_exempt_types.includes(centre.type);

  const { columns, joins } = placeColumnsSql(isAdmin, '$4', 'TRUE');
  // What the place is compared with, as the rule lists it. $2 the kind, $3 the place,
  // $4 the radius, $5 the type, $6 the membership.
  const above = `, above AS (
        SELECT a.membership_id
          FROM experiences ce
          LEFT JOIN ${FAME} cf ON cf.membership_id = $6
          CROSS JOIN LATERAL crowding_above($2::int, $5::text, $6::int, ce.location, $4::float8, cf.score) a
         WHERE ce.id = $3)`;
  const aroundParams = [caller.id, kind.id, centre.experience_id, kind.crowding_radius_km, centre.type, membershipId];
  const [placeRead, aroundRead, unlistedRead] = await Promise.all([
    // $1 the caller (the scope's prelude), $2 the membership, $3 whether an admin asks, $4 the
    // radius, $5 the world view whose leaves group it, as the group and arrivals reads take it.
    pool.query<PlaceRow & { region_id: number | null; region_name: string | null }>(`${CURATOR_SCOPED_REGIONS_CTE}
      SELECT ${columns}, leaf.region_id, leaf.region_name
        FROM ${MEMBERSHIPS} m
        JOIN experiences e ON e.id = m.experience_id
        ${joins}
        ${groupLeafSql({ isAdmin: '$3', worldView: '$5', within: false })}
       WHERE m.id = $2 AND ${membershipAdmittedSql('m')} AND ${hideLostSql('e')} AND ${listedSql(isAdmin)}`,
    [caller.id, membershipId, isAdmin, kind.crowding_radius_km, query.worldViewId ?? null]),
    // $1 the caller, $2 the kind, $3 the place, $4 the radius, $5 the type, $6 the membership.
    pool.query<Signals & {
      membership_id: number; experience_id: number; name: string; latitude: number; longitude: number;
      distance_m: number; arriving: boolean; crowded: boolean; compared: boolean; holds_works: boolean; pin: CrowdingPin | null;
    }>(`${CURATOR_SCOPED_REGIONS_CTE}${above}
      SELECT m.id AS membership_id, e.id AS experience_id, e.name,
             ST_Y(e.location) AS latitude, ST_X(e.location) AS longitude,
             round(ST_Distance(e.location::geography, centre.point::geography))::int AS distance_m,
             ${FAME_SIGNALS},
             m.curation_state = 'pending' AS arriving,
             ${membershipCrowdedSql('m')} AS crowded,
             m.id IN (SELECT membership_id FROM above) AS compared,
             -- Why a better-known neighbour may not count: its works, or a curator's shadow (#2420).
             place_shows_works(e.id) AS holds_works, m.crowding_pin AS pin
        FROM ${MEMBERSHIPS} m
        JOIN experiences e ON e.id = m.experience_id
        LEFT JOIN ${FAME} f ON f.membership_id = m.id
        CROSS JOIN (SELECT ce.location AS point FROM experiences ce WHERE ce.id = $3) centre
       WHERE ${aroundSql(isAdmin)} AND m.type IS NOT DISTINCT FROM $5::text AND m.id <> $6
       ORDER BY f.score DESC NULLS LAST, e.name, m.id
       LIMIT ${AROUND_MAX}`, aroundParams),
    // The places the rule counts above it that the caller is not shown.
    pool.query<{ unlisted: number }>(`${CURATOR_SCOPED_REGIONS_CTE}${above}
      SELECT count(*)::int AS unlisted
        FROM above a
        JOIN ${MEMBERSHIPS} m ON m.id = a.membership_id
        JOIN experiences e ON e.id = m.experience_id
       WHERE NOT ${listedSql(isAdmin)}`, aroundParams),
  ]);
  const place = placeRead.rows[0];
  if (!place) throw notFound('Membership not found');
  const measuring = place.score === null && !exempt && place.measurable ? await measuringRun() : null;

  return {
    place: toPlace(place, kind, exempt),
    group: { regionId: place.region_id, regionName: place.region_name, kindId: kind.id, type: centre.type },
    kind: kindOf(kind),
    typeExempt: exempt,
    around: aroundRead.rows.map(row => ({
      membershipId: row.membership_id,
      experienceId: row.experience_id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceM: row.distance_m,
      ...signalsOf(row),
      standing: standingOf(row),
      compared: !exempt && row.compared,
      holdsWorks: row.holds_works,
      pin: row.pin,
    })),
    comparedUnlisted: exempt ? 0 : unlistedRead.rows[0]?.unlisted ?? 0,
    measurable: place.measurable,
    measuringRun: measuring,
  };
}

/**
 * The arrivals a crowded city would shadow, grouped by region, kind and type:
 * "Berlin · Squares & streets · square: 11 new". The review queue asks about
 * none of them (`arrivalOpenSql`), so this is where they are asked, each group
 * opening its region's list (`getCrowdingGroup`).
 *
 * An arrival is grouped under its leaf (`groupLeafSql`); one no world view
 * places is grouped under none. A region asked for (#2349) keeps the groups
 * within it: each arrival placed in the region or under it, as the queue's
 * Region chip reads "within" (`regionSubtreeCte`), grouped under its leaf
 * there — Berlin's squares by Berlin's districts, a leaf's under the leaf
 * itself. `none` keeps the arrivals grouped under no region. An arrival is
 * grouped under a leaf a curator did not reject it from where it has one
 * (`groupLeafSql`), and not counted where it has none, since a leaf's list
 * does not hold a place rejected from it (`getCrowdingGroup`).
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
    kind_id: number; kind_name: string; type: string | null; arrivals: number;
  }>(`${CURATOR_SCOPED_REGIONS_CTE}${within ? regionSubtreeCte('$4') : ''}
    SELECT leaf.region_id, leaf.region_name, leaf.world_view_id,
           m.kind_id, k.name AS kind_name, m.type, count(*)::int AS arrivals
      FROM ${MEMBERSHIPS} m
      JOIN experiences e ON e.id = m.experience_id
      JOIN ${KINDS} k ON k.id = m.kind_id AND k.crowding_limit IS NOT NULL
      ${groupLeafSql({ isAdmin: '$3', worldView: '$2', within })}
     WHERE m.curation_state = 'pending' AND ${membershipAdmittedSql('m')} AND e.missing_since IS NULL
       AND ${hideLostSql('e')} AND ${membershipCrowdedSql('m')}
       AND ${queueScopeSql(isAdmin, 'm.source_id')} AND ${regionKept}
       AND (leaf.region_id IS NULL OR ${notRejectedInSql('leaf.region_id')})
     GROUP BY leaf.region_id, leaf.region_name, leaf.world_view_id, m.kind_id, k.name, k.display_priority, m.type
     ORDER BY count(*) DESC, leaf.region_name, k.display_priority, m.type`,
  [caller.id, query.worldViewId ?? null, isAdmin, ...(within ? [query.region] : [])]);
  return {
    groups: result.rows.map(row => ({
      regionId: row.region_id,
      regionName: row.region_name,
      worldViewId: row.world_view_id,
      kindId: row.kind_id,
      kindName: row.kind_name,
      type: row.type,
      arrivals: row.arrivals,
    })),
  };
}
