/**
 * The regions a reader has marked visited: /api/users/me/visited-regions.
 */

import type { z } from 'zod/v4';
import { NO_CONTENT } from '../../api/route.js';
import type { VisitedRegion, VisitedRegions } from '../../api/responses/visited.js';
import { pool } from '../../db/index.js';
import type { UserVisitedRegionsRow } from '../../db/schema.generated.js';
import { failure, notFound } from '../../middleware/errorHandler.js';
import type { regionIdParamSchema, visitedRegionBodySchema, worldViewIdParamSchema } from '../../types/index.js';

/** A visited region as the three region statements select it. */
type VisitedRegionRow = Pick<UserVisitedRegionsRow, 'region_id' | 'visited_at' | 'notes'>;

/** A visited region as the answer declares it, key by key. */
function visitedRegionOf(row: VisitedRegionRow): VisitedRegion {
  return { region_id: row.region_id, visited_at: row.visited_at?.toISOString() ?? null, notes: row.notes };
}

/** Every region the caller has marked visited, most recent first. */
export async function getVisitedRegions({ caller }: { caller: Express.User }): Promise<VisitedRegions> {
  let rows: VisitedRegionRow[];
  try {
    const result = await pool.query<VisitedRegionRow>(
      `SELECT region_id, visited_at, notes
       FROM user_visited_regions
       WHERE user_id = $1
       ORDER BY visited_at DESC`,
      [caller.id],
    );
    rows = result.rows;
  } catch (error) {
    console.error('Error getting visited regions:', error);
    throw failure('Failed to get visited regions', 500);
  }
  return rows.map(visitedRegionOf);
}

/** The caller's visited regions in one world view. */
export async function getVisitedRegionsInWorldView(
  { params: { worldViewId }, caller }: { params: z.output<typeof worldViewIdParamSchema>; caller: Express.User },
): Promise<VisitedRegions> {
  let rows: VisitedRegionRow[];
  try {
    const result = await pool.query<VisitedRegionRow>(
      `SELECT uvr.region_id, uvr.visited_at, uvr.notes
       FROM user_visited_regions uvr
       JOIN regions r ON r.id = uvr.region_id
       WHERE uvr.user_id = $1 AND r.world_view_id = $2
       ORDER BY uvr.visited_at DESC`,
      [caller.id, worldViewId],
    );
    rows = result.rows;
  } catch (error) {
    console.error('Error getting visited regions:', error);
    throw failure('Failed to get visited regions', 500);
  }
  return rows.map(visitedRegionOf);
}

/** Mark a region visited, or refresh the mark and keep its notes unless new ones are given. */
export async function markRegionVisited(
  { params: { regionId }, body, caller }: {
    params: z.output<typeof regionIdParamSchema>;
    body: z.output<typeof visitedRegionBodySchema>;
    caller: Express.User;
  },
): Promise<VisitedRegion> {
  let row: VisitedRegionRow | undefined;
  try {
    const regionCheck = await pool.query('SELECT id FROM regions WHERE id = $1', [regionId]);
    if (regionCheck.rows.length > 0) {
      const result = await pool.query<VisitedRegionRow>(
        `INSERT INTO user_visited_regions (user_id, region_id, notes)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, region_id)
         DO UPDATE SET visited_at = NOW(), notes = COALESCE($3, user_visited_regions.notes)
         RETURNING region_id, visited_at, notes`,
        [caller.id, regionId, body.notes || null],
      );
      row = result.rows[0];
    }
  } catch (error) {
    console.error('Error marking region as visited:', error);
    throw failure('Failed to mark region as visited', 500);
  }
  if (!row) throw notFound('Region not found');
  return visitedRegionOf(row);
}

/** Take a region's visited mark away. */
export async function unmarkRegionVisited(
  { params: { regionId }, caller }: { params: z.output<typeof regionIdParamSchema>; caller: Express.User },
): Promise<typeof NO_CONTENT> {
  try {
    await pool.query(
      'DELETE FROM user_visited_regions WHERE user_id = $1 AND region_id = $2',
      [caller.id, regionId],
    );
  } catch (error) {
    console.error('Error unmarking region as visited:', error);
    throw failure('Failed to unmark region as visited', 500);
  }
  return NO_CONTENT;
}
