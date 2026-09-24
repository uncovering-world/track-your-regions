/**
 * A hierarchy edit never deletes a traveller's visit (#764).
 *
 * `user_visited_regions.region_id` references `regions` with `ON DELETE NO
 * ACTION`, so the database refuses any delete of a visited region, whichever
 * writer asks — region CRUD, flatten, the import review's tree operations and
 * smart flatten. That is the guarantee. This module is how the refusal
 * reaches the curator:
 *
 * - a writer that runs in one transaction lets the violation through (a
 *   handler that answers its own failures, like `smartFlatten`, rethrows this
 *   one), and `errorHandler` answers it 409 with `VISITED_REGION_REFUSAL`;
 * - a writer that is not one transaction (`deleteRegion`, `flattenSubregion`
 *   write before they delete, and `smartFlatten` auto-matches before its
 *   transaction opens) asks `visitsUnder` or `visitsOn` first and refuses
 *   before its first write, since failing at the delete would leave the
 *   writes before it standing.
 *
 * The world view delete is the one path that removes visits: its preview
 * counts them and the admin confirms.
 */

import { pool } from './index.js';

/** The foreign key a visited region's delete violates; its name is the schema's. */
export const VISITED_REGION_FK = 'user_visited_regions_region_id_fkey';

export const VISITED_REGION_REFUSAL =
  'Travellers have recorded visits on a region this change would delete. '
  + 'A hierarchy edit does not delete a visit, so this edit was not made.';

/** Is this the database refusing to delete a visited region? */
export function isVisitedRegionDelete(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, constraint } = err as { code?: unknown; constraint?: unknown };
  return code === '23503' && constraint === VISITED_REGION_FK;
}

/**
 * The visits recorded on a region, and on every region under it when the
 * edit takes its descendants too.
 */
export async function visitsUnder(regionId: number, withDescendants: boolean): Promise<number> {
  const result = await pool.query<{ visits: number }>(
    withDescendants
      ? `WITH RECURSIVE subtree AS (
           SELECT id FROM regions WHERE id = $1
           UNION ALL
           SELECT r.id FROM regions r JOIN subtree s ON r.parent_region_id = s.id
         )
         SELECT count(*)::int AS visits FROM user_visited_regions
         WHERE region_id IN (SELECT id FROM subtree)`
      : 'SELECT count(*)::int AS visits FROM user_visited_regions WHERE region_id = $1',
    [regionId],
  );
  return result.rows[0].visits;
}

/** The visits recorded on exactly these regions — a writer that already listed what it will delete. */
export async function visitsOn(regionIds: number[]): Promise<number> {
  const result = await pool.query<{ visits: number }>(
    'SELECT count(*)::int AS visits FROM user_visited_regions WHERE region_id = ANY($1::int[])',
    [regionIds],
  );
  return result.rows[0].visits;
}

/** The refusal a writer gives before its first write, with the count it found. */
export function visitedRegionRefusal(visits: number): string {
  const noun = visits === 1 ? 'visit' : 'visits';
  return `Travellers have recorded ${visits} ${noun} on this region or a region this change would delete. `
    + 'A hierarchy edit does not delete a visit, so this edit was not made.';
}
