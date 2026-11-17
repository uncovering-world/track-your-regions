/**
 * A kind's rule as its code and its last run state it (#2185): what the kind
 * keeps out and the fame lines it admits by, shown behind ⓘ on an arrival's card.
 */

import { getExperiencesReviewKindRuleByKindId } from './client.generated';
import type { KindRule } from './client.generated';

// What the call answers is declared once, as a backend schema (ADR-0066).
export type { KindRule } from './client.generated';

/** The kind's rule; its parts are null where the kind declares none or no run read its bars. */
export function fetchKindRule(kindId: number): Promise<KindRule> {
  return getExperiencesReviewKindRuleByKindId(kindId);
}
