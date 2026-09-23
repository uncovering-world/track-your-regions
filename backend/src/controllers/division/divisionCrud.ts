/**
 * Division CRUD operations
 */

import { Request, Response } from 'express';
import { respond } from '../../api/respond.js';
import { AdministrativeDivision, AdministrativeDivisions } from '../../api/responses/divisions.js';
// ADR-0064: raw parameterized SQL on the pool, typed by the generated rows.
import { pool } from '../../db/index.js';
import type { AdministrativeDivisionsRow } from '../../db/schema.generated.js';
import { notFound } from '../../middleware/errorHandler.js';
import { DIVISION_COLUMNS, divisionOf, type DivisionRow } from './divisionAnswerRows.js';

/**
 * Get root divisions (no parent)
 */
export async function getRootDivisions(_req: Request, res: Response): Promise<void> {
  const result = await pool.query<DivisionRow>(
    `SELECT ${DIVISION_COLUMNS}
     FROM administrative_divisions
     WHERE parent_id IS NULL`,
  );

  respond(res, AdministrativeDivisions, result.rows.map(divisionOf));
}

/**
 * Get a specific division by ID
 */
export async function getDivisionById(req: Request, res: Response): Promise<void> {
  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));

  const result = await pool.query<DivisionRow>(
    `SELECT ${DIVISION_COLUMNS}
     FROM administrative_divisions
     WHERE id = $1
     LIMIT 1`,
    [divisionId],
  );

  if (result.rows.length === 0) {
    throw notFound(`Division ${divisionId} not found`);
  }

  respond(res, AdministrativeDivision, divisionOf(result.rows[0]));
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
  const exists = await pool.query<Pick<AdministrativeDivisionsRow, 'id'>>(
    'SELECT id FROM administrative_divisions WHERE id = $1 LIMIT 1',
    [divisionId],
  );

  if (exists.rows.length === 0) {
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
      SELECT ${DIVISION_COLUMNS}
      FROM subdivisions
      ORDER BY depth, name
      LIMIT $2 OFFSET $3
    `;
  } else {
    query = `
      SELECT ${DIVISION_COLUMNS}
      FROM administrative_divisions
      WHERE parent_id = $1
      ORDER BY name
      LIMIT $2 OFFSET $3
    `;
  }

  const result = await pool.query<DivisionRow>(query, [divisionId, limit, offset]);

  respond(res, AdministrativeDivisions, result.rows.map(divisionOf));
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
    SELECT ${DIVISION_COLUMNS}
    FROM ancestors
    ORDER BY depth DESC
  `;

  const result = await pool.query<DivisionRow>(query, [divisionId]);

  if (result.rows.length === 0) {
    throw notFound(`Division ${divisionId} not found`);
  }

  respond(res, AdministrativeDivisions, result.rows.map(divisionOf));
}

/**
 * Get siblings for a division
 */
export async function getSiblings(req: Request, res: Response): Promise<void> {
  const divisionId = parseInt(String(req.params.divisionId || req.params.regionId));

  const divisionResult = await pool.query<Pick<AdministrativeDivisionsRow, 'parent_id'>>(
    'SELECT parent_id FROM administrative_divisions WHERE id = $1 LIMIT 1',
    [divisionId],
  );

  if (divisionResult.rows.length === 0) {
    throw notFound(`Division ${divisionId} not found`);
  }

  const parentId = divisionResult.rows[0].parent_id;

  // A root's siblings are the other roots, and NULL is never `= $1`.
  const result = parentId === null
    ? await pool.query<DivisionRow>(
      `SELECT ${DIVISION_COLUMNS}
       FROM administrative_divisions
       WHERE parent_id IS NULL`,
    )
    : await pool.query<DivisionRow>(
      `SELECT ${DIVISION_COLUMNS}
       FROM administrative_divisions
       WHERE parent_id = $1`,
      [parentId],
    );

  respond(res, AdministrativeDivisions, result.rows.map(divisionOf));
}
