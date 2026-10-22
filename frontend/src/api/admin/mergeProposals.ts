/**
 * The admin's pass over near places with similar names (#1249, ADR-0046
 * decision 2): every pair the rule finds is proposed for a person to answer.
 */

import type { MergeProposalPass } from '../adminClient.generated';
import { postAdminPlacesFindMergeProposals } from '../adminClient.generated';

// The answer is declared once, as a backend schema (ADR-0066), and generated
// into `adminClient.generated.ts`; passed on from the module of the call.
export type { MergeProposalPass } from '../adminClient.generated';

/**
 * Propose every pair of near places with similar names for a person to
 * answer, and read what is open, what has been answered and what the rule
 * left apart.
 */
export async function findPlacesThatMayBeOne(): Promise<MergeProposalPass> {
  return postAdminPlacesFindMergeProposals();
}
