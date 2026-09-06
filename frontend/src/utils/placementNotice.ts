/**
 * What to tell a curator when their answer landed and the regions did not.
 *
 * Through `worldViewList`, like every other placement report: an admin fixes this per
 * world view, so the sentence has to name them — and it has to carry their ids, because
 * a curator reporting "Base layer" and an admin searching for a world view id are the
 * two halves of one handover. A list derived here instead would drop them.
 *
 * Its own module rather than a function of the withdrawn card, where it was written:
 * a verdict on a lost place and a correction to a live one re-place the point the same
 * way and fail the same way, and the dialog that corrects opens from three surfaces. A
 * shared sentence imported from one card would make that card a dependency of the map.
 */

import { worldViewList } from './worldViewList';

export function placementNotice(
  item: { name: string },
  data?: { placementFailed?: true; placementFailedWorldViews?: Array<{ id: number | null; name: string | null }> },
): string | undefined {
  if (!data?.placementFailed) return undefined;
  return `${item.name}: the answer was recorded, but the point could not be re-placed in `
    + `${worldViewList(data.placementFailedWorldViews)}. Its regions are out of date until an `
    + 'admin re-runs placement.';
}
