/**
 * An arrival's answered neighbours in its kind (#2185): one place of the same
 * kind and type a curator kept, and one a curator turned away, which the card
 * shows under the place so a curator reads the kind's line from real answers.
 */

import { getExperiencesReviewKindNeighboursByMembershipId } from './client.generated';
import type { KindNeighbours } from './client.generated';

// What the call answers is declared once, as a backend schema (ADR-0066).
export type { KindNeighbours, KindNeighboursKept as KindNeighbour } from './client.generated';

/** The membership's kept and refused neighbours, either null where none was answered. */
export function fetchKindNeighbours(membershipId: number): Promise<KindNeighbours> {
  return getExperiencesReviewKindNeighboursByMembershipId(membershipId);
}
