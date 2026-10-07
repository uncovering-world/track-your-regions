/**
 * The admin's one pass over the catalogue as it stands: every place that
 * shares a Wikidata item with another merged into one (ADR-0046 decision 2).
 * POST /api/admin/places/merge-equal-items
 */

import type { EqualItemMerges } from '../../api/responses/admin.js';
import { mergeEqualItems } from '../experience/equalItemMerges.js';

export async function mergePlacesSharingAnItem(): Promise<EqualItemMerges> {
  return mergeEqualItems();
}
