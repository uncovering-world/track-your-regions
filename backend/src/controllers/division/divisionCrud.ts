/**
 * Division CRUD operations
 */

import { Request, Response } from 'express';
import { eq, isNull } from 'drizzle-orm';
import { db, pool } from '../../db/index.js';
import { administrativeDivisions } from '../../db/schema.js';
import { notFound } from '../../middleware/errorHandler.js';
import type { AdministrativeDivision } from './types.js';
import { FOCUS_JSON_COLUMNS, focusColumns } from './focusColumns.js';

const divisionColumns = {
  id: administrativeDivisions.id,
  name: administrativeDivisions.name,
  parentId: administrativeDivisions.parentId,
  hasChildren: administrativeDivisions.hasChildren,
  ...focusColumns,
};

/**
 * Get root divisions (no parent)
 */
export async function getRootDivisions(_req: Request, res: Response): Promise<void> {
  const result = await db.select(divisionColumns)
    .from(administrativeDivisions)
    .where(isNull(administrativeDivisions.parentId));

  const divisionList: AdministrativeDivision[] = result.map(d => ({
    id: d.id,
    name: d.name,
    parentId: d.parentId,
    hasChildren: d.hasChildren,
    focusBbox: d.focusBbox,
    anchorPoint: d.anchorPoint,
  }));

  res.json(divisionList);
}

/**
 * Get a specific division by ID
 */
export async function getDivisionById(req: Request, res: Response): Promise<void> {
  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));

  const result = await db.select(divisionColumns)
    .from(administrativeDivisions)
    .where(eq(administrativeDivisions.id, divisionId))
    .limit(1);

  if (result.length === 0) {
    throw notFound(`Division ${divisionId} not found`);
  }

  const d = result[0];
  res.json({
    id: d.id,
    name: d.name,
    parentId: d.parentId,
    hasChildren: d.hasChildren,
    focusBbox: d.focusBbox,
    anchorPoint: d.anchorPoint,
  });
}

/**
 * Get subdivisions for a specific division
 */
export async function getSubdivisions(req: Request, res: Response): Promise<void> {
  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));
  const getAll = req.query.getAll === 'true';
  const limit = parseInt(String(req.query.limit ?? '1000'));
  const offset = parseInt(String(req.query.offset ?? '0'));

  // Check if division exists
  const exists = await db.select({ id: administrativeDivisions.id })
    .from(administrativeDivisions)
    .where(eq(administrativeDivisions.id, divisionId))
    .limit(1);

  if (exists.length === 0) {
    throw notFound(`Division ${divisionId} not found`);
  }

  let query: string;

  if (getAll) {
    query = `
      WITH RECURSIVE subdivisions AS (
        SELECT id, parent_id, name, has_children, focus_bbox, anchor_point, 1 as depth
        FROM administrative_divisions
        WHERE parent_id = $1
        UNION ALL
        SELECT d.id, d.parent_id, d.name, d.has_children, d.focus_bbox, d.anchor_point, s.depth + 1
        FROM administrative_divisions d
        INNER JOIN subdivisions s ON d.parent_id = s.id
      )
      SELECT id, parent_id, name, has_children, ${FOCUS_JSON_COLUMNS}
      FROM subdivisions
      ORDER BY depth, name
      LIMIT $2 OFFSET $3
    `;
  } else {
    query = `
      SELECT id, parent_id, name, has_children, ${FOCUS_JSON_COLUMNS}
      FROM administrative_divisions
      WHERE parent_id = $1
      ORDER BY name
      LIMIT $2 OFFSET $3
    `;
  }

  const result = await pool.query(query, [divisionId, limit, offset]);

  const divisionList: AdministrativeDivision[] = result.rows.map(d => ({
    id: d.id,
    name: d.name,
    parentId: d.parent_id,
    hasChildren: d.has_children,
    focusBbox: d.focus_bbox_json,
    anchorPoint: d.anchor_point_json,
  }));

  res.json(divisionList);
}

/**
 * Get ancestors (parent chain) for a division
 */
export async function getAncestors(req: Request, res: Response): Promise<void> {
  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));

  const query = `
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, name, has_children, focus_bbox, anchor_point, 1 as depth
      FROM administrative_divisions
      WHERE id = $1
      UNION ALL
      SELECT d.id, d.parent_id, d.name, d.has_children, d.focus_bbox, d.anchor_point, a.depth + 1
      FROM administrative_divisions d
      INNER JOIN ancestors a ON d.id = a.parent_id
    )
    SELECT id, parent_id, name, has_children, ${FOCUS_JSON_COLUMNS}
    FROM ancestors
    ORDER BY depth DESC
  `;

  const result = await pool.query(query, [divisionId]);

  if (result.rows.length === 0) {
    throw notFound(`Division ${divisionId} not found`);
  }

  const divisionList: AdministrativeDivision[] = result.rows.map(d => ({
    id: d.id,
    name: d.name,
    parentId: d.parent_id,
    hasChildren: d.has_children,
    focusBbox: d.focus_bbox_json,
    anchorPoint: d.anchor_point_json,
  }));

  res.json(divisionList);
}

/**
 * Get siblings for a division
 */
export async function getSiblings(req: Request, res: Response): Promise<void> {
  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));

  const divisionResult = await db.select({ parentId: administrativeDivisions.parentId })
    .from(administrativeDivisions)
    .where(eq(administrativeDivisions.id, divisionId))
    .limit(1);

  if (divisionResult.length === 0) {
    throw notFound(`Division ${divisionId} not found`);
  }

  const parentId = divisionResult[0].parentId;

  const result = await db.select(divisionColumns)
    .from(administrativeDivisions)
    .where(parentId === null
      ? isNull(administrativeDivisions.parentId)
      : eq(administrativeDivisions.parentId, parentId));

  const divisionList: AdministrativeDivision[] = result.map(d => ({
    id: d.id,
    name: d.name,
    parentId: d.parentId,
    hasChildren: d.hasChildren,
    focusBbox: d.focusBbox,
    anchorPoint: d.anchorPoint,
  }));

  res.json(divisionList);
}
