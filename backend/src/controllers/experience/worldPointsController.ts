/**
 * The catalogue's places across the whole world, before a region is chosen
 * (#910).
 *
 * A world map of a kind is a read of *places*, not of objects: a serial World
 * Heritage site is one row and hundreds of places, and GET /api/experiences
 * answers objects and caps a page at 1000 of them. So this endpoint answers
 * points, and nothing else — it is the map's source, not a list.
 *
 * **Why an endpoint rather than a tile source.** The first build of this layer
 * was a Martin function (ADR-0061), and it worked; what it could not do was go
 * stale honestly. Martin holds an in-process cache keyed on the tile URL and
 * sends no cache headers, so a place a curator had just marked lost kept being
 * drawn: measured, the function answered 1336 bytes while Martin served the
 * old 1366 for as long as it was asked, and only a restart changed that. A
 * catalogue whose whole point is that curators change it cannot be served from
 * a cache nothing invalidates. Through the API the same read goes through React
 * Query, which the curation writes already invalidate.
 *
 * **Two tiers, because the map draws two different things.** Below the marker
 * band the layer is a density heatmap, which needs coordinates and nothing
 * else; above it every point is a pin with a name, a kind and a type. Measured
 * over the development catalogue on 2026-09-16, brotli q4 on the wire:
 *
 * | read | points | bytes |
 * |---|---|---|
 * | overview, every kind | 8 830 | 37 kB |
 * | overview, every kind, folded | 3 755 | 18 kB |
 * | overview, one kind (World Heritage) | 6 347 | 26 kB |
 * | markers, the widest box a reader can ask for | 4 692 | 103 kB |
 * | markers, a central-European box | 1 470 | 33 kB |
 * | every property over the whole catalogue | 8 830 | 267 kB |
 *
 * The last row is what a single-tier endpoint would cost on the first screen.
 * The central-European row is *less* than the 66 kB vector tile covering the
 * same extent — per-feature framing is most of a tile's weight at marker zoom.
 *
 * **Columnar, not GeoJSON.** One array per field instead of a Feature object
 * per point: measured 125 kB against 267 kB with the same values in it, because
 * every GeoJSON feature repeats its own keys. The frontend builds the
 * FeatureCollection MapLibre wants once per read (`worldPoints.ts`), which is
 * the one place that shape is needed.
 *
 * **What a stranger may read here.** The four reader-facing questions of
 * `db/readerPredicates.ts`, composed from the same fragments every other
 * reader-facing read composes them from — which is the second reason this is an
 * endpoint: the tile function had to spell all four in SQL, a second runtime
 * for a rule that already had one.
 */

import { Request, Response } from 'express';
import { respond } from '../../api/respond.js';
import { WorldPointsResponse } from '../../api/responses/worldPoints.js';
import type { PointsDetail } from './worldPointsVocabulary.js';
import { pool } from '../../db/index.js';
import { placeOfferedSql, rowKindJoinSql } from '../../db/membership.js';
import { bboxIntersectsSql, parseBbox } from '../../db/bboxEnvelopes.js';
import { hideLostSql, offeredLocationSql, publishedContentSql } from '../../db/readerPredicates.js';

/**
 * Decimals a coordinate is rounded to, per tier.
 *
 * **Two at the overview, measured against the tier's own worst zoom rather than
 * the one the map opens on.** Two decimals is about 1 113 m at the equator. A
 * screen pixel is 78 km at zoom 1, where the first screen sits, and 6.9 km at
 * zoom 4.5, where this tier hands over to the markers — so the rounding is a
 * seventieth of a pixel at the opening and a sixth of one at the handover, and
 * invisible at both. It was worth 10.4 kB — the overview of every kind measured
 * 47.6 kB at three decimals and 37.2 at two — which was exactly what the map
 * root's total-size budget needed: three decimals put the first screen 2 930 B
 * over it.
 *
 * One decimal was measured too — 26.5 kB, another 10.7 off — and refused: 11 km
 * is 1.6 pixels at zoom 4.5, which is visible jitter in the last half-zoom
 * before the pins arrive.
 *
 * Five at marker zoom, where a pin is a claim about where to stand and a reader
 * may keep zooming past the band — a metre at the equator, which is finer than
 * any coordinate this catalogue holds is accurate.
 */
const DECIMALS: Record<PointsDetail, number> = { overview: 2, markers: 5 };

/**
 * The most points one read answers.
 *
 * `bbox` is optional on both tiers — the overview *is* the whole world, and a
 * marker read wide enough to hold every longitude is a state
 * `worldPointsView.ts` can legitimately produce — so without a cap the work per
 * request grows with the catalogue and nothing bounds it. `publicReadLimiter`
 * bounds how often a stranger may ask, not how much each ask costs, and this is
 * the widest anonymous read the product has.
 *
 * 20 000 is more than twice the places the catalogue holds (8 842 on 2026-09-22), so it never fires today
 * and the measured payloads stay the measured payloads. It fires the day the
 * catalogue outgrows the tier design, and when it does the answer says
 * `truncated` rather than quietly drawing a heatmap of part of the world —
 * which is the failure a silent `LIMIT` would cause, since a density picture
 * built from a subset is wrong rather than incomplete.
 */
const MAX_POINTS = 20000;

/** A coordinate as the wire carries it: rounded in the database, sent as a number. */
function coordinateSql(axis: 'X' | 'Y', column: string, detail: PointsDetail): string {
  return `round(ST_${axis}(${column})::numeric, ${DECIMALS[detail]})::float8`;
}

interface PointRow {
  lng: number;
  lat: number;
  location_id?: number;
  experience_id?: number;
  location_name?: string | null;
  experience_name?: string;
  kind_id?: number | null;
  type?: string | null;
  location_count?: number;
}

/**
 * The columns a tier selects, over the aliases the two query shapes share.
 *
 * `location` is the geometry column's owner — `el` unfolded, the fold's CTE
 * folded — so one list serves both.
 */
function selectSql(detail: PointsDetail, folded: boolean, location: string, locationRow: string): string {
  const geometry = `${location}.location`;
  const columns = [
    `${coordinateSql('X', geometry, detail)} AS lng`,
    `${coordinateSql('Y', geometry, detail)} AS lat`,
  ];
  if (folded) columns.push(`${location}.location_count`);
  if (detail === 'markers') {
    columns.push(
      `${locationRow}.id AS location_id`,
      `${locationRow}.experience_id`,
      `${locationRow}.name AS location_name`,
      'e.name AS experience_name',
      'm.kind_id',
      'e.type',
    );
  }
  return columns.join(',\n        ');
}

/**
 * Everything that must be true of a place before this endpoint draws it.
 *
 * The four questions of `db/readerPredicates.ts`, in the order that file asks
 * them: does the source still offer this point and does it still stand, has
 * anyone looked at it — which is also what hides a point a curator turned down,
 * since a refusal leaves curation_state pending (ADR-0053) — does the object
 * still stand, and is some membership of it both admitted and passed.
 *
 * Composed, never spelled: six predicates in this family were each written as a
 * subset of themselves during ADR-0025's review, which is the note
 * `experienceOfferedToReaderSql` carries and the reason the fragments exist.
 */
function readerGuardsSql(): string {
  return `${offeredLocationSql('el')}
        AND ${publishedContentSql('el')}
        AND ${hideLostSql('e')}
        AND ${placeOfferedSql('e')}`;
}

/**
 * Get the catalogue's reader-visible places
 * GET /api/experiences/points
 *
 * Query params:
 * - kindId: only the places of this kind (optional; absent is every kind at once)
 * - bbox: west,south,east,north (optional; absent is the whole world)
 * - detail: overview (default) or markers
 * - folded: one point per object instead of one per place
 */
export async function getWorldPoints(req: Request, res: Response): Promise<void> {
  const detail: PointsDetail = req.query.detail === 'markers' ? 'markers' : 'overview';
  // `String` rather than a comparison against the literal, so the parsed
  // query's 'true' and a test calling the handler with a boolean read the
  // same — the shape `includeLost` accepts for the same reason.
  const folded = String(req.query.folded) === 'true';
  const kindId = req.query.kindId === undefined ? null : Number(req.query.kindId);
  const box = parseBbox(req.query.bbox);

  const params: number[] = [];
  const conditions = [readerGuardsSql()];

  if (kindId !== null) {
    // Optional, and absent means every kind rather than none: naming no kind is
    // a picture of the whole catalogue, not a missing scope. Nothing here is
    // scoped by a parameter — a place belongs to the catalogue, not to a lens —
    // so there is no id whose absence could widen the answer past what a reader
    // may see.
    params.push(kindId);
    conditions.push(`m.kind_id = $${params.length}`);
  }
  if (box) {
    const at = {
      west: params.push(box.west),
      south: params.push(box.south),
      east: params.push(box.east),
      north: params.push(box.north),
    };
    conditions.push(bboxIntersectsSql('el.location', box, at));
  }

  const where = conditions.join('\n        AND ');
  const query = folded
    ? foldedQuery(detail, where)
    : `SELECT
        ${selectSql(detail, false, 'el', 'el')}
      FROM experience_locations el
      JOIN experiences e ON e.id = el.experience_id
      ${rowKindJoinSql()}
      WHERE ${where}
      LIMIT ${MAX_POINTS + 1}`;

  // One more than the cap, so hitting it is distinguishable from filling it.
  const { rows } = await pool.query<PointRow>(query, params);
  const truncated = rows.length > MAX_POINTS;
  respond(res, WorldPointsResponse, toColumns(truncated ? rows.slice(0, MAX_POINTS) : rows, detail, folded, truncated));
}

/**
 * One point per object, at the place the catalogue answers "where is this" with
 * (ADR-0028 decision 2, `readerPositionSql`) — so a folded pin here sits where
 * a region's folded pin sits.
 *
 * Two passes, because the fold is not a property of the box. The first names
 * the objects with at least one visible place inside it; the second reads
 * *every* visible place of those objects, since the nearest one may well lie
 * outside the box, and picks it. That a folded pin can therefore fall outside
 * the requested box is the same answer the list endpoint gives — a serial site
 * matched on a part inside a box is answered at the part nearest its anchor —
 * and the map asks with a margin around the viewport anyway.
 *
 * Nearest **in metres, on geography, never in degrees**: this catalogue holds
 * 42 multi-place objects above 60 degrees, among them Struve Geodetic Arc's 34
 * points reaching 70.7 N, where a degree of longitude is a third of a degree of
 * latitude. Degree ordering was measured picking a different place for six
 * objects and sending the reader further in every one. `el.id` breaks ties, so
 * the answer is total.
 *
 * The count is a window over the same un-joined set rather than an aggregate:
 * the kind's LEFT JOIN is one row per place today, and a count that reads
 * through it would start counting memberships the day it is not (#755).
 * DISTINCT ON then keeps the nearest row of each object, the window having
 * already seen all of them.
 *
 * The second pass asks only the two location-level questions: the object-level
 * ones and the kind are what the first pass selected the objects by.
 */
function foldedQuery(detail: PointsDetail, where: string): string {
  return `WITH matched AS (
        SELECT DISTINCT el.experience_id
        FROM experience_locations el
        JOIN experiences e ON e.id = el.experience_id
        ${rowKindJoinSql()}
        WHERE ${where}
      ), folded AS (
        SELECT DISTINCT ON (el.experience_id)
          el.id, el.experience_id, el.location, el.name,
          count(*) OVER (PARTITION BY el.experience_id)::int AS location_count
        FROM experience_locations el
        JOIN matched ON matched.experience_id = el.experience_id
        JOIN experiences e ON e.id = el.experience_id
        WHERE ${offeredLocationSql('el')}
          AND ${publishedContentSql('el')}
        ORDER BY el.experience_id,
          el.location::geography <-> e.location::geography,
          el.id
      )
      SELECT
        ${selectSql(detail, true, 'folded', 'folded')}
      FROM folded
      JOIN experiences e ON e.id = folded.experience_id
      ${rowKindJoinSql()}
      LIMIT ${MAX_POINTS + 1}`;
}

/**
 * The rows as arrays.
 *
 * Built in one pass with the arrays pre-sized, because this is the hot path the
 * whole endpoint exists for: the overview answers every place in the catalogue — thousands of points — on the map's
 * first screen, and an intermediate object per point is exactly the cost the
 * columnar shape was chosen to avoid.
 */
function toColumns(
  rows: PointRow[],
  detail: PointsDetail,
  folded: boolean,
  truncated = false,
): WorldPointsResponse {
  const count = rows.length;
  const answer: WorldPointsResponse = {
    detail,
    folded,
    count,
    truncated: truncated ? true : undefined,
    lng: new Array<number>(count),
    lat: new Array<number>(count),
  };
  if (folded) answer.locationCount = new Array<number>(count);
  if (detail === 'markers') {
    answer.locationId = new Array<number>(count);
    answer.experienceId = new Array<number>(count);
    answer.name = new Array<string | null>(count);
    answer.experienceName = new Array<string>(count);
    answer.kindId = new Array<number | null>(count);
    answer.type = new Array<string | null>(count);
  }
  for (let index = 0; index < count; index += 1) {
    const row = rows[index];
    answer.lng[index] = row.lng;
    answer.lat[index] = row.lat;
    if (answer.locationCount) answer.locationCount[index] = row.location_count ?? 1;
    if (answer.locationId) {
      answer.locationId[index] = row.location_id as number;
      (answer.experienceId as number[])[index] = row.experience_id as number;
      (answer.name as (string | null)[])[index] = row.location_name ?? null;
      (answer.experienceName as string[])[index] = row.experience_name as string;
      (answer.kindId as (number | null)[])[index] = row.kind_id ?? null;
      (answer.type as (string | null)[])[index] = row.type ?? null;
    }
  }
  return answer;
}
