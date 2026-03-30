/**
 * Rename & Reparent Controller
 *
 * Provides endpoints to rename a region or move it to a new parent
 * within the import tree.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { pool } from '../../db/index.js';

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export async function renameRegion(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const worldViewId = Number(req.params.worldViewId);
  const { regionId, name, sourceUrl, sourceExternalId } = req.body as {
    regionId: number;
    name: string;
    sourceUrl?: string;
    sourceExternalId?: string;
  };

  // Verify region belongs to this world view
  const check = await pool.query(
    'SELECT id, name FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (check.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  const oldName = check.rows[0].name as string;
  await pool.query(
    'UPDATE regions SET name = $1 WHERE id = $2',
    [name.trim(), regionId],
  );

  // Update enrichment in region_import_state if provided
  if (sourceUrl !== undefined || sourceExternalId !== undefined) {
    const setClauses: string[] = [];
    const values: (string | number)[] = [];
    let paramIdx = 1;

    if (sourceUrl !== undefined) {
      setClauses.push(`source_url = $${paramIdx++}`);
      values.push(sourceUrl);
    }
    if (sourceExternalId !== undefined) {
      setClauses.push(`source_external_id = $${paramIdx++}`);
      values.push(sourceExternalId);
    }
    values.push(regionId);

    await pool.query(
      `UPDATE region_import_state SET ${setClauses.join(', ')} WHERE region_id = $${paramIdx}`,
      values,
    );
  }

  res.json({ renamed: true, regionId, oldName, newName: name.trim() });
}

// ---------------------------------------------------------------------------
// Reparent (Move)
// ---------------------------------------------------------------------------

export async function reparentRegion(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const worldViewId = Number(req.params.worldViewId);
  const { regionId, newParentId } = req.body as {
    regionId: number;
    newParentId: number | null;
  };

  // Verify region belongs to this world view
  const check = await pool.query(
    'SELECT id, parent_region_id FROM regions WHERE id = $1 AND world_view_id = $2',
    [regionId, worldViewId],
  );
  if (check.rows.length === 0) {
    res.status(404).json({ error: 'Region not found in this world view' });
    return;
  }

  const oldParentId = check.rows[0].parent_region_id as number | null;

  if (newParentId === oldParentId) {
    res.json({ reparented: true, regionId, oldParentId, newParentId, noChange: true });
    return;
  }

  // If moving to a new parent (not root), verify it exists and no circular ref
  if (newParentId != null) {
    const parentCheck = await pool.query(
      'SELECT id FROM regions WHERE id = $1 AND world_view_id = $2',
      [newParentId, worldViewId],
    );
    if (parentCheck.rows.length === 0) {
      res.status(404).json({ error: 'New parent region not found in this world view' });
      return;
    }

    // Circular reference check: newParentId must NOT be a descendant of regionId
    const circularCheck = await pool.query(
      `WITH RECURSIVE descendants AS (
        SELECT id FROM regions WHERE parent_region_id = $1 AND world_view_id = $2
        UNION ALL
        SELECT r.id FROM regions r
        JOIN descendants d ON r.parent_region_id = d.id
        WHERE r.world_view_id = $2
      )
      SELECT 1 FROM descendants WHERE id = $3 LIMIT 1`,
      [regionId, worldViewId, newParentId],
    );
    if (circularCheck.rows.length > 0) {
      res.status(400).json({ error: 'Cannot move region under its own descendant (circular reference)' });
      return;
    }
  }

  await pool.query(
    'UPDATE regions SET parent_region_id = $1 WHERE id = $2',
    [newParentId, regionId],
  );

  res.json({ reparented: true, regionId, oldParentId, newParentId });
}
