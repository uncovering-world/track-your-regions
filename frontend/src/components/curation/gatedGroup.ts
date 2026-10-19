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
  /**
   * On the "This place" section alone (`liftSharedFacts`, #1599): every kind
   * whose run proposes the facts it holds, with that run. Its answers go under
   * `membershipId`, the one of them that holds every lifted fact.
   */
  sharedBy?: Array<{ kindName: string; runId: number | null; membershipId: number | null; proposesAll: boolean }>;
  /**
   * On a kind's section some of whose rows were lifted into "This place"
   * (#1599): its proposal still holds them, so its button publishes the rows
   * it shows by name rather than the whole proposal.
   */
  narrowed?: true;
}

/** The kind a section asks for — every half of it is that one membership's. */
export function sectionKind(group: GatedGroup): string {
  return (group.arrival ?? group.held ?? group.contents)?.kind_name ?? '';
}

/** A section's name on a card with several: "This place", or the kind it asks for. */
export function sectionLabel(group: GatedGroup): string {
  return group.sharedBy ? 'This place' : sectionKind(group);
}

/** Every kind a place's sections speak for, each once, in their order: "This place" for each of its runs' kinds. */
export function sectionsKinds(sections: readonly GatedGroup[]): string[] {
  const kinds = sections.flatMap(group => group.sharedBy?.map(run => run.kindName) ?? [sectionKind(group)]);
  return [...new Set(kinds)];
}

/** The kinds a "This place" section speaks for, in words: "Art Museums and Archaeology". */
export function sharedKinds(group: GatedGroup): string {
  const kinds = (group.sharedBy ?? []).filter(run => run.proposesAll).map(run => run.kindName);
  return kinds.length <= 1 ? kinds.join('') : `${kinds.slice(0, -1).join(', ')} and ${kinds.at(-1)}`;
}
