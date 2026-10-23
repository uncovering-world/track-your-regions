/**
 * The regions a curator may narrow the review feed to, found by name (#1920).
 * GET /api/experiences/review/regions/search?query=
 *
 * The feed's `?region=` already narrows to any region and its subtree
 * (`regionFilter` in `reviewQueueKeys.ts`); what was missing was a way to
 * name one below the roots the Region chip offers. This read finds regions of
 * every public world view by name, with the same matching the world view's own
 * search uses (`runRegionSearch`), each with its path and the world view it is
 * in, so two regions called Berlin tell apart. At most ten: the chip lists
 * them under the roots. No count per result, on purpose: counting a region
 * costs a subtree walk, and the picked region's count comes from the feed.
 *
 * Every public world view, whoever asks: a region-scoped curator's pick of a
 * region outside their scope shows an empty feed, which is the feed's own
 * answer, never another region's questions. Nothing leaves the product.
 */

import type { z } from 'zod/v4';
import type { ReviewRegionSearchResults } from '../../api/responses/reviewQueue.js';
import { pool } from '../../db/index.js';
import type { reviewRegionSearchQuerySchema } from '../../types/index.js';
import { runRegionSearch, type RegionSearchRowBase } from '../worldView/regionSearchSql.js';

/** How many regions the chip lists under the roots. */
export const REVIEW_REGION_RESULTS = 10;

interface ReviewRegionRow extends RegionSearchRowBase {
  world_view_id: number;
  world_view: string;
}

export async function searchReviewRegions(
  { query: { query } }: { query: z.output<typeof reviewRegionSearchQuerySchema> },
): Promise<ReviewRegionSearchResults> {
  const inputQuery = query.trim();
  if (inputQuery.length < 2) return [];
  const rows = await runRegionSearch<ReviewRegionRow>(pool, inputQuery, {
    predicate: 'w.is_public',
    params: [],
    extraColumns: 'world_view_id, (SELECT w.name FROM world_views w WHERE w.id = scored.world_view_id) AS world_view',
  }, REVIEW_REGION_RESULTS);
  return rows.map(row => ({
    id: row.id, name: row.name, path: row.path, worldViewId: row.world_view_id, worldView: row.world_view,
  }));
}
