/**
 * Division CRUD operations
 */

import type { z } from 'zod/v4';
import type { AdministrativeDivision, AdministrativeDivisions } from '../../api/responses/divisions.js';
// ADR-0064: raw parameterized SQL on the pool, typed by the generated rows.
import { pool } from '../../db/index.js';
import type { AdministrativeDivisionsRow } from '../../db/schema.generated.js';
import { notFound } from '../../middleware/errorHandler.js';
import type { divisionIdParamSchema, getSubdivisionsQuerySchema } from '../../types/index.js';
import { DIVISION_COLUMNS, divisionOf, type DivisionRow } from './divisionAnswerRows.js';

/**
 * Get root divisions (no parent)
 */
export async function getRootDivisions(): Promise<AdministrativeDivisions> {
  const result = await pool.query<DivisionRow>(
    `SELECT ${DIVISION_COLUMNS}
     FROM administrative_divisions
     WHERE parent_id IS NULL`,
  );

  return result.rows.map(divisionOf);
}

type DivisionParams = z.output<typeof divisionIdParamSchema>;

/**
 * Get a specific division by ID
 */
export async function getDivisionById(
  { params: { divisionId } }: { params: DivisionParams },
): Promise<AdministrativeDivision> {

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

  return divisionOf(result.rows[0]);
}

/**
 * Get subdivisions for a specific division
 */
export async function getSubdivisions(
  { params: { divisionId }, query }: { params: DivisionParams; query: z.output<typeof getSubdivisionsQuerySchema> },
): Promise<AdministrativeDivisions> {
  const getAll = query.getAll === 'true';
  const { limit, offset } = query;

  // Check if division exists
  const exists = await pool.query<Pick<AdministrativeDivisionsRow, 'id'>>(
    'SELECT id FROM administrative_divisions WHERE id = $1 LIMIT 1',
    [divisionId],
  );

  if (exists.rows.length === 0) {
    throw notFound(`Division ${divisionId} not found`);
  }

  let sql: string;

  if (getAll) {
    sql = `
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
    sql = `
      SELECT ${DIVISION_COLUMNS}
      FROM administrative_divisions
      WHERE parent_id = $1
      ORDER BY name
      LIMIT $2 OFFSET $3
    `;
  }

  const result = await pool.query<DivisionRow>(sql, [divisionId, limit, offset]);

  return result.rows.map(divisionOf);
}

/**
 * Get ancestors (parent chain) for a division
 */
export async function getAncestors(
  { params: { divisionId } }: { params: DivisionParams },
): Promise<AdministrativeDivisions> {
  const sql = `
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

  const result = await pool.query<DivisionRow>(sql, [divisionId]);

  if (result.rows.length === 0) {
    throw notFound(`Division ${divisionId} not found`);
  }

  return result.rows.map(divisionOf);
}

/**
 * Get siblings for a division
 */
export async function getSiblings(
  { params: { divisionId } }: { params: DivisionParams },
): Promise<AdministrativeDivisions> {

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

  return result.rows.map(divisionOf);
}
