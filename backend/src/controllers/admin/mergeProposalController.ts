/**
 * The admin's pass over near places with similar names (#1249, ADR-0046
 * decision 2): every pair the rule finds is proposed for a person to answer,
 * and the response says what is open, what has been answered and what the
 * rule left apart. POST /api/admin/places/find-merge-proposals
 */

import type { MergeProposalPass } from '../../api/responses/admin.js';
import { findMergeProposals } from '../../services/sync/mergeProposalFinder.js';

export async function findPlacesThatMayBeOne(): Promise<MergeProposalPass> {
  return findMergeProposals();
}
