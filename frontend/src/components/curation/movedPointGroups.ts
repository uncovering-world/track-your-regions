/**
 * A point the source moved, as a group of the held-changes table (#524).
 *
 * A gated run that finds a point somewhere else keeps the stored pin and writes
 * the new position as an unread point naming the one it replaces
 * (`locationWriter.ts`), so the object does not vanish from the map while the
 * move waits. To a curator that is a change to what readers see, not an
 * arrival: it sits beside a place's held rename, headed by the place, with one
 * `coordinates` row — the stored position against the moved one, the distance,
 * and the map (`MoveFact`) — and an answer that publishes or turns down that
 * point by id (`movedPointId`).
 *
 * The point that *is* the object's own held coordinate moving
 * (`coordinates_move_point_id`) gets no group: the object's `coordinates` row
 * is the same question, and publishing it takes the point along (#1233).
 */

import type { ReviewQueueItem } from '../../api/reviewQueue';
import { rowsFor, type FactGroup } from './factRows';

export function movedPointGroups(contents: ReviewQueueItem | undefined, objectName: string): FactGroup[] {
  const paired = contents?.coordinates_move_point_id ?? null;
  return (contents?.pending_points ?? [])
    .filter(point => point.replaces && point.id !== paired && point.latitude != null && point.longitude != null)
    .map(point => {
      const field = {
        field: 'location',
        old: { lon: point.replaces!.longitude, lat: point.replaces!.latitude },
        new: { lon: point.longitude!, lat: point.latitude! },
      };
      return {
        subject: {
          kind: 'place' as const,
          label: point.name ?? objectName,
          key: `moved:${point.id}`,
          detail: point.externalRef ?? null,
          // No door of its own: the row's "see the move on the map" is where
          // the point is looked at, both pins and the arrow between them.
          movedPointId: point.id,
        },
        rows: rowsFor([field], { proposed: [field] }),
      };
    });
}
