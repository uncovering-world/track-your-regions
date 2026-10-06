/**
 * One membership's open gated questions about a place (#1264), and the kind
 * they are asked for. Its own module so the row text (`feed/rowSpecific.ts`)
 * and the row builder read it without importing the card that draws it.
 */

import type { ReviewQueueItem } from '../../api/reviewQueue';

/**
 * Whatever a gated run left open under one kind of a place: an arrival, or a
 * held proposal and the unread contents beside it. `membershipId` is the
 * membership every answer to it is written under.
 */
export interface GatedGroup {
  id: number;
  name: string;
  membershipId?: number | null;
  arrival?: ReviewQueueItem;
  held?: ReviewQueueItem;
  contents?: ReviewQueueItem;
}

/** The kind a section asks for — every half of it is that one membership's. */
export function sectionKind(group: GatedGroup): string {
  return (group.arrival ?? group.held ?? group.contents)?.kind_name ?? '';
}
