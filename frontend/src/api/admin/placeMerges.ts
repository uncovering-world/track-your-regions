/**
 * The admin's one pass over places that are one place (#1247, ADR-0046
 * decision 2, ADR-0086).
 */

import type { EqualItemMerges } from '../client.generated';
import { postAdminPlacesMergeEqualItems } from '../client.generated';

// The answer is declared once, as a backend schema (ADR-0066), and generated
// into `client.generated.ts`; passed on from the module of the call.
export type { EqualItemMerges } from '../client.generated';

/**
 * Merge every place that shares a Wikidata item with another into one place:
 * one transaction per item, the lower id staying. What could not be made one
 * is in the answer with its reason.
 */
export async function mergePlacesSharingAnItem(): Promise<EqualItemMerges> {
  return postAdminPlacesMergeEqualItems();
}
