/**
 * Which region of each hierarchy a moved point leaves and enters (#2203).
 *
 * A move changes what a reader sees in a hierarchy where it places the place in
 * other regions, so that is what a card names: both points are placed by the
 * run's own placement (`regionsHoldingPoints`, `regionAssignmentService.ts`,
 * ADR-0054) in every public world view with geometry, and a world view where
 * the two share no region is a crossing, named by the smallest region holding
 * each point; one where only one of them is placed at all is a move out of its
 * regions or into them.
 *
 * One statement per page: every coordinate move on the page's cards — the
 * object's own and its parts' held or conflicted coordinate, and an unread
 * point that replaces a stored one — is looked up at once, after the cards are
 * built, and the answer is written onto each move.
 */

import { regionsHoldingPoints } from '../../services/sync/regionAssignmentService.js';
import type { RegionCrossing, ReviewQueueItem } from '../../api/responses/reviewQueue.js';

interface Point { lon: number; lat: number }

function pointOf(value: unknown): Point | null {
  const point = value as { lon?: unknown; lat?: unknown } | null;
  if (!point || typeof point !== 'object') return null;
  if (typeof point.lon !== 'number' || typeof point.lat !== 'number') return null;
  return Number.isFinite(point.lon) && Number.isFinite(point.lat) ? { lon: point.lon, lat: point.lat } : null;
}

/** What a move's crossings are written onto: a coordinate field, or a point the source moved. */
type MoveHolder = { regionCrossings?: RegionCrossing[] };

/** Every coordinate move on the cards, with its two points. */
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

type Placed = Awaited<ReturnType<typeof regionsHoldingPoints>>[number];

/** The crossings of one move: a world view per entry, in world-view order, where the two points share no region; each side's hits come smallest region first. */
function crossingsOf(from: readonly Placed[], to: readonly Placed[]): RegionCrossing[] {
  const views = new Map<number, string>();
  for (const hit of [...from, ...to]) views.set(hit.worldViewId, hit.worldView);
  return [...views].sort(([a], [b]) => a - b).flatMap(([view, name]) => {
    const a = from.filter(hit => hit.worldViewId === view);
    const b = to.filter(hit => hit.worldViewId === view);
    if (a.some(hit => b.some(other => other.regionId === hit.regionId))) return [];
    return [{ worldView: name, from: a[0]?.region ?? null, to: b[0]?.region ?? null }];
  });
}

/**
 * Writes `regionCrossings` onto every coordinate move of these cards: each
 * world view where the move places the place in other regions, or out of or
 * into its regions at all. Empty where the move keeps its regions.
 */
export async function attachRegionCrossings(items: readonly ReviewQueueItem[]): Promise<void> {
  const moves = movesOf(items);
  if (moves.length === 0) return;
  const placed = await regionsHoldingPoints(moves.flatMap((move, k) => [
    { id: 2 * k + 1, ...move.from },
    { id: 2 * k + 2, ...move.to },
  ]));
  const hitsAt = (id: number) => placed.filter(hit => hit.pointId === id);
  moves.forEach((move, k) => {
    move.holder.regionCrossings = crossingsOf(hitsAt(2 * k + 1), hitsAt(2 * k + 2));
  });
}
