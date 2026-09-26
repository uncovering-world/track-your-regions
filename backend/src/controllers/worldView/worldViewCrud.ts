/**
 * World Views CRUD operations
 */

import type { z } from 'zod/v4';
import { NO_CONTENT } from '../../api/route.js';
import type { DeleteImpact, WorldView, WorldViews } from '../../api/responses/worldViews.js';
import { pool } from '../../db/index.js';
import type { WorldViewsRow } from '../../db/schema.generated.js';
import { badRequest, notFound } from '../../middleware/errorHandler.js';
import type {
  createWorldViewBodySchema, updateWorldViewBodySchema, worldViewIdParamSchema,
} from '../../types/index.js';
import {
  deleteImpactOf, WORLD_VIEW_COLUMNS_SQL, worldViewOf, type DeleteImpactRow, type WorldViewRow,
} from './worldViewAnswerRows.js';

type WorldViewParams = z.output<typeof worldViewIdParamSchema>;

/**
 * Get all World Views visible to the caller.
 *
 * Non-admins see only published (`is_public`) world views. The filter lives here
 * rather than in the client so a hidden world view is not merely absent from a
 * dropdown — it is absent from the response.
 */
export async function getWorldViews(
  { caller }: { caller: Express.User | undefined },
): Promise<WorldViews> {
  // The rows depend on who is asking. The headers that keep a shared cache
  // from serving an admin's list to a visitor come from the route's
  // `revalidate` policy, as on every read whose answer is shaped by the caller.
  const isAdmin = caller?.role === 'admin';
  const result = await pool.query<WorldViewRow>(`
    SELECT ${WORLD_VIEW_COLUMNS_SQL}
    FROM world_views
    WHERE is_active = true
      AND ($1::boolean OR is_public)
    ORDER BY is_default DESC, name
  `, [isAdmin]);

  return result.rows.map(worldViewOf);
}

/**
 * Create a new World View
 */
export async function createWorldView(
  { body: { name, description, source } }: { body: z.output<typeof createWorldViewBodySchema> },
): Promise<WorldView> {
  const result = await pool.query<WorldViewRow>(
    `INSERT INTO world_views (name, description, source, is_default, is_active)
     VALUES ($1, $2, $3, false, true)
     RETURNING ${WORLD_VIEW_COLUMNS_SQL}`,
    [name, description || null, source || null]
  );

  return worldViewOf(result.rows[0]);
}

/**
 * Update a World View
 */
export async function updateWorldView(
  { params: { worldViewId }, body: { name, description, source, isPublic } }: {
    params: WorldViewParams;
    body: z.output<typeof updateWorldViewBodySchema>;
  },
): Promise<WorldView> {
  const result = await pool.query<WorldViewRow>(
    `UPDATE world_views
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         source = COALESCE($3, source),
         is_public = COALESCE($4, is_public),
         updated_at = NOW()
     WHERE id = $5
     RETURNING ${WORLD_VIEW_COLUMNS_SQL}`,
    // `?? null`, not `|| null`: false is a meaningful value here.
    [name || null, description || null, source || null, isPublic ?? null, worldViewId]
  );

  if (result.rows.length === 0) {
    throw notFound(`World View ${worldViewId} not found`);
  }

  return worldViewOf(result.rows[0]);
}

/**
 * Get a preview of what deleting a World View will destroy.
 * Returns counts of regions, experience-to-region assignments, and user visit
 * records so admins can see the blast radius before confirming deletion.
 */
export async function getDeleteImpact(
  { params: { worldViewId } }: { params: WorldViewParams },
): Promise<DeleteImpact> {
  const check = await pool.query<Pick<WorldViewsRow, 'is_default'>>(
    'SELECT is_default FROM world_views WHERE id = $1',
    [worldViewId],
  );
  if (check.rows.length === 0) {
    throw notFound(`World View ${worldViewId} not found`);
  }

  const result = await pool.query<DeleteImpactRow>(`
    SELECT
      (SELECT COUNT(*) FROM regions WHERE world_view_id = $1)::int AS region_count,
      (SELECT COUNT(*) FROM experience_regions er
       JOIN regions r ON r.id = er.region_id
       WHERE r.world_view_id = $1)::int AS experience_assignment_count,
      (SELECT COUNT(*) FROM user_visited_regions uvr
       JOIN regions r ON r.id = uvr.region_id
       WHERE r.world_view_id = $1)::int AS user_visit_count
  `, [worldViewId]);

  return deleteImpactOf(result.rows[0], check.rows[0].is_default);
}

/**
 * Delete a World View
 */
export async function deleteWorldView(
  { params: { worldViewId } }: { params: WorldViewParams },
): Promise<typeof NO_CONTENT> {
  // Check if it's the default World View
  const check = await pool.query(
    'SELECT is_default FROM world_views WHERE id = $1',
    [worldViewId]
  );

  if (check.rows.length === 0) {
    throw notFound(`World View ${worldViewId} not found`);
  }

  if (check.rows[0].is_default) {
    throw badRequest('Cannot delete the default GADM World View');
  }

  // The one delete that takes visits with it: getDeleteImpact counted them
  // and the admin confirmed. Every other region delete is refused by the
  // visits' foreign key, which is checked at the end of the statement, so the
  // visits go in the same statement as the regions they stand on (#764).
  await pool.query(`
    WITH visits_gone AS (
      DELETE FROM user_visited_regions uvr USING regions r
      WHERE r.id = uvr.region_id AND r.world_view_id = $1
    )
    DELETE FROM world_views WHERE id = $1
  `, [worldViewId]);

  return NO_CONTENT;
}
