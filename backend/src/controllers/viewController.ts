import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { views } from '../db/schema.js';
import { notFound, badRequest } from '../middleware/errorHandler.js';

interface View {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
}

interface AdministrativeDivision {
  id: number;
  name: string;
  parentId: number | null;
  hasChildren: boolean;
}

/**
 * Get all views
 */
export async function getViews(_req: Request, res: Response): Promise<void> {
  const result = await db.select().from(views);

  const viewList: View[] = result.map(v => ({
    id: v.id,
    name: v.name,
    description: v.description,
    isActive: v.isActive ?? true,
    createdAt: v.createdAt ?? new Date(),
  }));

  res.json(viewList);
}

/**
 * Get a specific view by ID
 */
export async function getViewById(req: Request, res: Response): Promise<void> {
  const viewId = parseInt(String(req.params.viewId));

  const result = await db.select()
    .from(views)
    .where(eq(views.id, viewId))
    .limit(1);

  if (result.length === 0) {
    throw notFound(`View ${viewId} not found`);
  }

  const v = result[0];
  res.json({
    id: v.id,
    name: v.name,
    description: v.description,
    isActive: v.isActive ?? true,
    createdAt: v.createdAt ?? new Date(),
  });
}

/**
 * Create a new view
 */
export async function createView(req: Request, res: Response): Promise<void> {
  const { name, description } = req.body;

  if (!name) {
    throw badRequest('Name is required');
  }

  const query = `
    INSERT INTO views (name, description)
    VALUES ($1, $2)
    RETURNING id, name, description, is_active, created_at
  `;

  const result = await pool.query(query, [name, description ?? null]);
  const v = result.rows[0];

  res.status(201).json({
    id: v.id,
    name: v.name,
    description: v.description,
    isActive: v.is_active,
    createdAt: v.created_at,
  });
}

/**
 * Update a view
 */
export async function updateView(req: Request, res: Response): Promise<void> {
  const viewId = parseInt(String(req.params.viewId));
  const { name, description, isActive } = req.body;

  // Check if view exists
  const exists = await db.select({ id: views.id })
    .from(views)
    .where(eq(views.id, viewId))
    .limit(1);

  if (exists.length === 0) {
    throw notFound(`View ${viewId} not found`);
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(name);
  }
  if (description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(description);
  }
  if (isActive !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    values.push(isActive);
  }

  if (updates.length === 0) {
    throw badRequest('No fields to update');
  }

  values.push(viewId);

  const query = `
    UPDATE views SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, description, is_active, created_at
  `;

  const result = await pool.query(query, values);
  const v = result.rows[0];

  res.json({
    id: v.id,
    name: v.name,
    description: v.description,
    isActive: v.is_active,
    createdAt: v.created_at,
  });
}

/**
 * Delete a view
 */
export async function deleteView(req: Request, res: Response): Promise<void> {
  const viewId = parseInt(String(req.params.viewId));

  const result = await db.delete(views)
    .where(eq(views.id, viewId))
    .returning({ id: views.id });

  if (result.length === 0) {
    throw notFound(`View ${viewId} not found`);
  }

  res.status(204).send();
}

/**
 * Get all divisions in a view
 */
export async function getViewDivisions(req: Request, res: Response): Promise<void> {
  const viewId = parseInt(String(req.params.viewId));

  // Check if view exists
  const viewResult = await db.select()
    .from(views)
    .where(eq(views.id, viewId))
    .limit(1);

  if (viewResult.length === 0) {
    throw notFound(`View ${viewId} not found`);
  }

  const query = `
    SELECT ad.id, ad.name, ad.parent_id, ad.has_children
    FROM view_division_mapping vdm
    INNER JOIN administrative_divisions ad ON vdm.division_id = ad.id
    WHERE vdm.view_id = $1
    ORDER BY ad.name
  `;

  const result = await pool.query(query, [viewId]);

  const divisionList: AdministrativeDivision[] = result.rows.map(d => ({
    id: d.id,
    name: d.name,
    parentId: d.parent_id,
    hasChildren: d.has_children,
  }));

  res.json(divisionList);
}

/**
 * Add divisions to a view
 */
export async function addDivisionsToView(req: Request, res: Response): Promise<void> {
  const viewId = parseInt(String(req.params.viewId));
  const { divisionIds, regionIds } = req.body as { divisionIds?: number[]; regionIds?: number[] };

  // Support both new (divisionIds) and legacy (regionIds) param names
  const ids = divisionIds || regionIds;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw badRequest('divisionIds array is required');
  }

  // Check if view exists
  const viewResult = await db.select()
    .from(views)
    .where(eq(views.id, viewId))
    .limit(1);

  if (viewResult.length === 0) {
    throw notFound(`View ${viewId} not found`);
  }

  // Insert mappings (ignore conflicts)
  const query = `
    INSERT INTO view_division_mapping (view_id, division_id)
    SELECT $1, unnest($2::int[])
    ON CONFLICT (view_id, division_id) DO NOTHING
  `;

  await pool.query(query, [viewId, ids]);

  res.status(201).json({ added: ids.length });
}

/**
 * Remove divisions from a view
 */
export async function removeDivisionsFromView(req: Request, res: Response): Promise<void> {
  const viewId = parseInt(String(req.params.viewId));
  const { divisionIds, regionIds } = req.body as { divisionIds?: number[]; regionIds?: number[] };

  // Support both new (divisionIds) and legacy (regionIds) param names
  const ids = divisionIds || regionIds;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw badRequest('divisionIds array is required');
  }

  // Check if view exists
  const viewResult = await db.select({ id: views.id })
    .from(views)
    .where(eq(views.id, viewId))
    .limit(1);

  if (viewResult.length === 0) {
    throw notFound(`View ${viewId} not found`);
  }

  // Delete mappings
  const query = `
    DELETE FROM view_division_mapping
    WHERE view_id = $1 AND division_id = ANY($2::int[])
  `;

  const result = await pool.query(query, [viewId, ids]);

  res.json({ removed: result.rowCount ?? 0 });
}
