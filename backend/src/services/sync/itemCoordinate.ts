/**
 * Which of a Wikidata item's coordinates a run writes for the place it is
 * writing (ADR-0204, #2119).
 *
 * An item may carry several coordinates at its best rank, and how finely one
 * is written says nothing about which is right: Pergamon's item holds the
 * acropolis and, to six decimals, a whole arc-minute in the town 1.4 km off.
 * The run therefore chooses with what it knows of the place, in this order:
 *
 * 1. Coordinates within a short move of each other (`SHORT_MOVE_METERS`) are
 *    one place written twice: the one the place shows stands, else the
 *    first (`preferredCoordinate`'s order). Nobody is asked.
 * 2. Farther apart, the one nearest the place's outline, inside counting as
 *    zero, where that leaves exactly one. An outline more than a kilometre
 *    from a coordinate says nothing about it: it is another thing's.
 * 3. Else the one nearest another source's view of the place, counting a
 *    view only within a short move of a coordinate, where the two sources
 *    read one spot. A view farther from every coordinate says nothing.
 * 4. Else the one the run reported last, so a move it already proposed stays
 *    the curator's question and no new one is raised on a guess, then the
 *    one the place shows, then the first. The choice is undecided, and the
 *    catalogue check `item-coordinates-disagree` puts it to a curator.
 *
 * The choice is the run's view of the place: the point and the record carry
 * it, and a move it makes goes through the gate like any other (ADR-0140).
 */

import type { PoolClient } from 'pg';
import { distanceMeters, LOCATION_UNCHANGED_METERS, SHORT_MOVE_METERS } from '@tyr/shared/moves';
import { MEMBERSHIPS } from '../../db/membership.js';
import { BEST } from './subset/entities.js';
import { preferredCoordinate } from './wikidataUtils.js';

/** The globe Wikidata names for a coordinate on this planet. */
const EARTH = 'http://www.wikidata.org/entity/Q2';

export interface ItemPoint {
  lat: number;
  lon: number;
}

/** What tells an item's coordinates apart, per candidate, in metres; null where the place has none of it. */
export interface CoordinateEvidence {
  /** To the place's outline, zero inside. */
  outlineM: Array<number | null>;
  /** To the nearest view of the place another source reports. */
  otherViewM: Array<number | null>;
  /** To the coordinate the place shows. */
  shownM: Array<number | null>;
  /** To the coordinate the run's own record reported last. */
  reportedM: Array<number | null>;
}

/** How far from a coordinate an outline still says something about it. */
const OUTLINE_REACH_M = 1000;

/**
 * How far from a coordinate another source's view still says something about
 * it: a short move, one spot read twice. On the development catalogue on
 * 2026-11-13 the views that told an item's coordinates apart stood 0 to 21 m
 * from one of them; the others stood 255 to 471 m from both, between them.
 */
const VIEW_REACH_M = SHORT_MOVE_METERS;

/** Why the run took the coordinate it took. */
export type CoordinateBasis = 'one' | 'close' | 'outline' | 'other-view' | 'reported' | 'shown' | 'first';

export interface CoordinateChoice {
  point: ItemPoint;
  basis: CoordinateBasis;
  /** The greatest distance between two of the item's coordinates. */
  spreadM: number;
  /** Nothing told them apart, and they stand farther apart than a short move: a curator's question. */
  undecided: boolean;
}

const wktOf = (point: ItemPoint): string => `Point(${point.lon} ${point.lat})`;

/** The first of `points` in the order every reader keeps before it knows the place (`preferredCoordinate`). */
function firstOf(points: readonly ItemPoint[]): ItemPoint {
  const wkt = preferredCoordinate(points.map(wktOf));
  return points.find(point => wktOf(point) === wkt) ?? points[0];
}

/** The indexes among `among` with the least distance, where a distance is known. */
function nearest(among: readonly number[], metres: ReadonlyArray<number | null>): number[] {
  const known = among.filter(i => metres[i] !== null);
  if (known.length === 0) return [...among];
  const least = Math.min(...known.map(i => metres[i]!));
  return known.filter(i => metres[i]! - least < LOCATION_UNCHANGED_METERS);
}

/** The greatest distance between two of `points`. */
export function spreadOf(points: readonly ItemPoint[]): number {
  let spread = 0;
  for (const a of points) {
    for (const b of points) spread = Math.max(spread, distanceMeters(a.lon, a.lat, b.lon, b.lat));
  }
  return spread;
}

/**
 * The coordinate among `points` the run writes, by the order above, and why.
 * `points` holds at least one; `evidence` holds one entry per point.
 */
export function chooseItemCoordinate(points: readonly ItemPoint[], evidence: CoordinateEvidence): CoordinateChoice {
  const spreadM = spreadOf(points);
  if (points.length === 1) return { point: points[0], basis: 'one', spreadM, undecided: false };
  const all = points.map((_, i) => i);
  const shown = all.filter(i => evidence.shownM[i] !== null && evidence.shownM[i]! < LOCATION_UNCHANGED_METERS);
  const kept = (among: number[], basis: CoordinateBasis, undecided: boolean): CoordinateChoice => ({
    point: firstOf(among.map(i => points[i])), basis, spreadM, undecided,
  });
  if (spreadM <= SHORT_MOVE_METERS) return shown.length > 0 ? kept(shown, 'close', false) : kept(all, 'close', false);

  const within = (metres: ReadonlyArray<number | null>, reach: number) => metres.map(m => (m !== null && m <= reach ? m : null));
  let among = all;
  for (const [metres, basis] of [
    [within(evidence.outlineM, OUTLINE_REACH_M), 'outline'], [within(evidence.otherViewM, VIEW_REACH_M), 'other-view'],
  ] as const) {
    const near = nearest(among, metres);
    if (near.length === 1 && near.length < among.length) return kept(near, basis, false);
    among = near;
  }
  for (const [metres, basis] of [[evidence.reportedM, 'reported'], [evidence.shownM, 'shown']] as const) {
    const at = among.filter(i => metres[i] !== null && metres[i]! < LOCATION_UNCHANGED_METERS);
    if (at.length > 0) return kept(at, basis, true);
  }
  return kept(among, 'first', true);
}

/**
 * What the place `placeId` says about each of `points`: its outline, the
 * other sources' views of it, its own coordinate and the run's last view of
 * it. A view under the run's own item is no other reading (ADR-0085), so the
 * views counted are those under another id: a World Heritage site's
 * coordinate, a list line's, another item's. A place the run is creating
 * (null) says nothing.
 */
export async function coordinateEvidence(
  query: Pick<PoolClient, 'query'>,
  placeId: number | null,
  externalId: string,
  points: readonly ItemPoint[],
): Promise<CoordinateEvidence> {
  const result = await query.query<{
    outline_m: number | null; other_view_m: number | null; shown_m: number | null; reported_m: number | null;
  }>(
    `WITH candidate AS (
       SELECT ord, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography AS at
         FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS c(lon, lat, ord)
     ), place AS (
       SELECT e.boundary AS outline, e.location
         FROM (SELECT 1) one LEFT JOIN experiences e ON e.id = $3::integer
     )
     SELECT ST_Distance(c.at, p.outline::geography) AS outline_m,
            (SELECT min(ST_Distance(c.at, other.reported_location::geography))
               FROM ${MEMBERSHIPS} other
              WHERE other.experience_id = $3::integer AND other.reported_location IS NOT NULL
                AND other.external_id <> $4) AS other_view_m,
            ST_Distance(c.at, p.location::geography) AS shown_m,
            (SELECT min(ST_Distance(c.at, own.reported_location::geography))
               FROM ${MEMBERSHIPS} own
              WHERE own.experience_id = $3::integer AND own.external_id = $4 AND own.kind_id IS NOT NULL) AS reported_m
       FROM candidate c CROSS JOIN place p
      ORDER BY c.ord`,
    [points.map(p => p.lon), points.map(p => p.lat), placeId, externalId],
  );
  const metres = (value: number | null) => (value === null ? null : Number(value));
  return {
    outlineM: result.rows.map(row => metres(row.outline_m)),
    otherViewM: result.rows.map(row => metres(row.other_view_m)),
    shownM: result.rows.map(row => metres(row.shown_m)),
    reportedM: result.rows.map(row => metres(row.reported_m)),
  };
}

/**
 * Every coordinate the item `qid` carries at its best rank on this planet, as
 * the local Wikidata subset holds it (ADR-0105), in the subset's statement
 * order: what the gather read the item's one coordinate from. Empty where the
 * subset does not hold the item.
 */
export async function itemPointsOf(query: Pick<PoolClient, 'query'>, qid: string): Promise<ItemPoint[]> {
  const result = await query.query<{ lat: number; lon: number }>(
    `SELECT (c.value->>'latitude')::float8 AS lat, (c.value->>'longitude')::float8 AS lon
       FROM wikidata_claims c
      WHERE c.subject = $1 AND c.property = 'P625' AND c.rank >= 0 AND ${BEST('c')}
        AND c.value ? 'latitude'
        AND COALESCE(c.value->>'globe', '${EARTH}') = '${EARTH}'
      ORDER BY c.statement_id`,
    [qid],
  );
  return result.rows.map(row => ({ lat: Number(row.lat), lon: Number(row.lon) }));
}

/**
 * The run's record with its coordinate chosen among its item's for the place
 * it writes (`chooseItemCoordinate`): the item's coordinates as the subset
 * holds them, and the one the run sends, which a live read may know and the
 * subset not yet. A record the run knows by another id than an item, or whose
 * coordinate is an anchor or an edition's (`chooses` false), is as sent.
 * Answers the choice too: which basis decided it, and whether anything did.
 */
export async function withChosenCoordinate<T extends { lon: number; lat: number; externalId: string }>(
  query: Pick<PoolClient, 'query'>,
  placeId: number | null,
  record: T,
  chooses: boolean,
): Promise<{ record: T; choice: CoordinateChoice | null }> {
  if (!chooses || !/^Q\d+$/.test(record.externalId)) return { record, choice: null };
  const sent = { lon: record.lon, lat: record.lat };
  const held = await itemPointsOf(query, record.externalId);
  const points = held.some(point => distanceMeters(point.lon, point.lat, sent.lon, sent.lat) < 1) ? held : [...held, sent];
  if (points.length < 2) return { record, choice: null };
  const choice = chooseItemCoordinate(points, await coordinateEvidence(query, placeId, record.externalId, points));
  return { record: { ...record, lon: choice.point.lon, lat: choice.point.lat }, choice };
}
