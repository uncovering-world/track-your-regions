/**
 * Shared simplify helpers for the WorldView Import controllers.
 *
 * Exports `runSimplifyHierarchy`, used both by the direct simplify endpoints
 * (`simplifyHierarchy`/`simplifyChildren`) and the smart-simplify apply flow.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';

type TreeDbClient = PoolClient;

async function findFullyCoveredParents(
  client: TreeDbClient,
  regionId: number,
): Promise<Array<{ parentId: number; memberIds: number[]; count: number }>> {
  const members = await client.query(`
    SELECT rm.id AS member_id, rm.division_id, ad.parent_id
    FROM region_members rm
    JOIN administrative_divisions ad ON ad.id = rm.division_id
    WHERE rm.region_id = $1 AND rm.custom_geom IS NULL
  `, [regionId]);

  const byParent = new Map<number, Array<{ memberId: number; divisionId: number }>>();
  for (const row of members.rows) {
    if (row.parent_id == null) continue;
    const parentId = row.parent_id as number;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push({ memberId: row.member_id, divisionId: row.division_id });
  }

  const replacements: Array<{ parentId: number; memberIds: number[]; count: number }> = [];
  for (const [parentId, childrenEntries] of byParent) {
    const totalResult = await client.query(
      'SELECT count(*)::int AS cnt FROM administrative_divisions WHERE parent_id = $1',
      [parentId],
    );
    const totalChildren = totalResult.rows[0].cnt as number;
    if (childrenEntries.length === totalChildren) {
      replacements.push({
        parentId,
        memberIds: childrenEntries.map(c => c.memberId),
        count: childrenEntries.length,
      });
    }
  }
  return replacements;
}

async function applySimplifyReplacement(
  client: TreeDbClient,
  regionId: number,
  rep: { parentId: number; memberIds: number[]; count: number },
): Promise<{ parentName: string; parentPath: string; replacedCount: number }> {
  await client.query(
    'DELETE FROM region_members WHERE id = ANY($1::int[])',
    [rep.memberIds],
  );

  const existing = await client.query(
    'SELECT id FROM region_members WHERE region_id = $1 AND division_id = $2 AND custom_geom IS NULL',
    [regionId, rep.parentId],
  );
  if (existing.rows.length === 0) {
    await client.query(
      'INSERT INTO region_members (region_id, division_id) VALUES ($1, $2)',
      [regionId, rep.parentId],
    );
  }

  const pathResult = await client.query(`
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id, 1 AS depth
      FROM administrative_divisions WHERE id = $1
      UNION ALL
      SELECT ad.id, ad.name, ad.parent_id, a.depth + 1
      FROM administrative_divisions ad
      JOIN ancestors a ON ad.id = a.parent_id
    )
    SELECT name FROM ancestors ORDER BY depth DESC
  `, [rep.parentId]);
  const names = pathResult.rows.map(r => r.name as string);
  const parentPath = names.join(' > ');
  const parentName = names[names.length - 1];

  return { parentName, parentPath, replacedCount: rep.count };
}

/**
 * Core simplification logic: merge child divisions into parents when 100% coverage is found.
 * Recursive: keeps merging upward until no more simplifications possible.
 * Opens its own connection and transaction. Returns the list of replacements made.
 */
export async function runSimplifyHierarchy(
  regionId: number,
  _worldViewId: number,
): Promise<{ replacements: Array<{ parentName: string; parentPath: string; replacedCount: number }> }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const allReplacements: Array<{ parentName: string; parentPath: string; replacedCount: number }> = [];

    for (;;) {
      const replacements = await findFullyCoveredParents(client, regionId);
      if (replacements.length === 0) break;

      for (const rep of replacements) {
        const entry = await applySimplifyReplacement(client, regionId, rep);
        allReplacements.push(entry);
      }
    }

    await client.query('COMMIT');
    return { replacements: allReplacements };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
