/**
 * Whether a moved coordinate on a review card crosses a division (#2203).
 *
 * A card warned "may fall in a different region" on every move over a
 * kilometre, and on 2026-11-01 28 of the 34 open ones stayed inside one GADM
 * division — the Summer Palace's 14.5 km move stays in Beijing — so the warning
 * was read past on the moves it was for: Kinabalu Park's point moving from Kota
 * Belud into Ranau. The card now says which division each point falls in,
 * read by the rule the short-move gate reads (`leavesSql`, ADR-0140), and the
 * client words a crossing only where the two differ.
 *
 * One statement per page: every coordinate move on the page's cards — the
 * object's own and its parts' — is looked up at once, after the cards are
 * built, and the answer is written onto each move's field.
 */

import { pool } from '../../db/index.js';
import { leavesSql } from '../../db/leafDivisions.js';
import type { MoveDivision, MoveDivisions, ReviewQueueItem } from '../../api/responses/reviewQueue.js';

interface Point { lon: number; lat: number }

function pointOf(value: unknown): Point | null {
  const point = value as { lon?: unknown; lat?: unknown } | null;
  if (!point || typeof point !== 'object') return null;
  if (typeof point.lon !== 'number' || typeof point.lat !== 'number') return null;
  return Number.isFinite(point.lon) && Number.isFinite(point.lat) ? { lon: point.lon, lat: point.lat } : null;
}

/** What a move's divisions are written onto: a coordinate field, or a point the source moved. */
type MoveHolder = { divisions?: MoveDivisions };

/**
 * Every coordinate move on the cards, with its two points: the object's and
 * its parts' held or conflicted coordinate, and an unread point that replaces
 * a stored one (a serial site's component the source moved).
 */
function movesOf(items: readonly ReviewQueueItem[]): Array<{ holder: MoveHolder; from: Point; to: Point }> {
  const fields = items.flatMap(item => [
    ...(item.proposed ?? []),
    ...(item.proposed_parts ?? []).flatMap(part => part.fields),
  ]);
  const ofFields = fields.flatMap((field) => {
    if (field.field !== 'location') return [];
    const from = pointOf(field.old);
    const to = pointOf(field.new);
    return from && to ? [{ holder: field as MoveHolder, from, to }] : [];
  });
  const ofPoints = items.flatMap(item => item.pending_points ?? []).flatMap((point) => {
    if (!point.replaces || point.latitude == null || point.longitude == null) return [];
    return [{
      holder: point as MoveHolder,
      from: { lon: point.replaces.longitude, lat: point.replaces.latitude },
      to: { lon: point.longitude, lat: point.latitude },
    }];
  });
  return [...ofFields, ...ofPoints];
}

/**
 * Writes `divisions` onto every coordinate move of these cards: the leaf
 * division under each point, its country, and whether the two points share a
 * leaf. A point in no division (Aegospotami's old point, in the sea) is null.
 */
export async function attachMoveDivisions(items: readonly ReviewQueueItem[]): Promise<void> {
  const moves = movesOf(items);
  if (moves.length === 0) return;
  const points = moves.flatMap(move => [move.from, move.to]);
  // The country is the leaf's ancestor one below the root: the tree's roots
  // are continents, and a leaf directly under a root is its own country.
  const answer = await pool.query<{ i: number; leaves: number[]; name: string | null; country: string | null }>(`
    WITH p AS (
      SELECT i::int AS i, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom
        FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS t(lon, lat, i)
    ), leaves AS (
      SELECT p.i, ${leavesSql('p.geom')} AS leaves FROM p
    )
    SELECT l.i, l.leaves, leaf.name, country.name AS country
      FROM leaves l
      LEFT JOIN administrative_divisions leaf ON leaf.id = l.leaves[1]
      LEFT JOIN LATERAL (
        WITH RECURSIVE up AS (
          SELECT d.id, d.parent_id, d.name, 0 AS depth FROM administrative_divisions d WHERE d.id = leaf.id
          UNION ALL
          SELECT a.id, a.parent_id, a.name, up.depth + 1 FROM administrative_divisions a JOIN up ON a.id = up.parent_id
        )
        SELECT name FROM up ORDER BY depth DESC OFFSET 1 LIMIT 1
      ) country ON TRUE
  `, [points.map(point => point.lon), points.map(point => point.lat)]);
  const byIndex = new Map(answer.rows.map(row => [row.i, row]));
  const divisionAt = (i: number): MoveDivision | null => {
    const row = byIndex.get(i);
    if (!row?.name) return null;
    return { name: row.name, country: row.country ?? row.name };
  };
  moves.forEach((move, k) => {
    const from = byIndex.get(2 * k + 1)?.leaves ?? [];
    const to = byIndex.get(2 * k + 2)?.leaves ?? [];
    move.holder.divisions = {
      from: divisionAt(2 * k + 1),
      to: divisionAt(2 * k + 2),
      // One leaf in common is no crossing: a point on a shared border stands
      // in both, and two leaves of one name in two counties are two leaves.
      same: from.some(leaf => to.includes(leaf)),
    };
  });
}
