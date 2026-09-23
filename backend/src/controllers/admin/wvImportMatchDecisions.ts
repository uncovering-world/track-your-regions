/**
 * A reviewer's verdict on a region's match suggestions, for one division or a
 * selection of them: accept the chosen ones and reject the rest, or reject the
 * chosen ones.
 *
 * The single-suggestion routes (`accept-and-reject`, `reject`) and the batch
 * routes the review's selection toolbar calls (`accept-batch-and-reject-rest`,
 * `reject-batch`) are one rule applied to one division or to several, so both
 * go through the writers here, each in one transaction: a selection half
 * applied would leave a region with some of its chosen divisions accepted and
 * its status computed for a state that never existed.
 */

import type { Response } from 'express';
import type { PoolClient } from 'pg';
import { respond } from '../../api/respond.js';
import { SelectionAccepted, SelectionRejected } from '../../api/responses/wvImportTreeOps.js';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';

/** Runs `write` in a transaction; null when the region is not in the world view. */
async function inRegionTransaction<T>(
  worldViewId: number,
  regionId: number,
  write: (client: PoolClient) => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const region = await client.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [regionId, worldViewId],
    );
    if (region.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const result = await write(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled.
    unusable = await rollbackQuietly(client);
    throw err;
  } finally {
    client.release(unusable);
  }
}

/**
 * Make the chosen divisions members of the region, reject every other open
 * suggestion, and drop the chosen ones' suggestions: the region is matched by
 * hand now. Answers how many open suggestions were rejected.
 */
export function acceptDivisionsRejectRest(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<{ rejected: number } | null> {
  return inRegionTransaction(worldViewId, regionId, async (client) => {
    await client.query(
      `INSERT INTO region_members (region_id, division_id)
       SELECT $1, d FROM unnest($2::int[]) AS d
       ON CONFLICT DO NOTHING`,
      [regionId, divisionIds],
    );
    const rejected = await client.query(
      `UPDATE region_match_suggestions SET rejected = true
       WHERE region_id = $1 AND division_id <> ALL($2::int[]) AND rejected = false`,
      [regionId, divisionIds],
    );
    await client.query(
      `DELETE FROM region_match_suggestions
       WHERE region_id = $1 AND division_id = ANY($2::int[]) AND rejected = false`,
      [regionId, divisionIds],
    );
    await client.query(
      `UPDATE region_import_state SET match_status = 'manual_matched' WHERE region_id = $1`,
      [regionId],
    );
    return { rejected: rejected.rowCount ?? 0 };
  });
}

/**
 * Reject the chosen divisions' suggestions, so they are not suggested again,
 * and take them out of the region's members if they were there. The region's
 * status follows what is left: open suggestions to review, members it was
 * matched with, or nothing at all. Answers how many suggestions were rejected.
 */
export function rejectDivisions(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<{ rejected: number } | null> {
  return inRegionTransaction(worldViewId, regionId, async (client) => {
    const rejected = await client.query(
      `UPDATE region_match_suggestions SET rejected = true
       WHERE region_id = $1 AND division_id = ANY($2::int[])`,
      [regionId, divisionIds],
    );
    await client.query(
      'DELETE FROM region_members WHERE region_id = $1 AND division_id = ANY($2::int[])',
      [regionId, divisionIds],
    );
    await client.query(
      `UPDATE region_import_state SET match_status = CASE
         WHEN EXISTS (SELECT 1 FROM region_match_suggestions WHERE region_id = $1 AND rejected = false) THEN 'needs_review'
         WHEN EXISTS (SELECT 1 FROM region_members WHERE region_id = $1) THEN 'manual_matched'
         ELSE 'no_candidates'
       END
       WHERE region_id = $1`,
      [regionId],
    );
    return { rejected: rejected.rowCount ?? 0 };
  });
}

/**
 * Accept the selected suggestions of a region and reject the rest.
 * POST /api/admin/wv-import/matches/:worldViewId/accept-batch-and-reject-rest
 */
export async function acceptBatchAndRejectRest(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionIds } = req.body as { regionId: number; divisionIds: number[] };
  const outcome = await acceptDivisionsRejectRest(worldViewId, regionId, divisionIds);
  if (!outcome) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }
  respond(res, SelectionAccepted, { accepted: divisionIds.length, rejected: outcome.rejected });
}

/**
 * Reject the selected suggestions of a region.
 * POST /api/admin/wv-import/matches/:worldViewId/reject-batch
 */
export async function rejectBatchSuggestions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const worldViewId = parseInt(String(req.params.worldViewId));
  const { regionId, divisionIds } = req.body as { regionId: number; divisionIds: number[] };
  const outcome = await rejectDivisions(worldViewId, regionId, divisionIds);
  if (!outcome) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }
  respond(res, SelectionRejected, { rejected: outcome.rejected });
}
