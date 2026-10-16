/**
 * A region's groups in the Create Subregions dialog (#595): the subregions an
 * admin is sorting its members into, kept in `region_subdivision_groups` and
 * `region_member_group_assignments`. Admin-only working material.
 */

import type { z } from 'zod/v4';
import { NO_CONTENT } from '../../api/route.js';
import type { RegionSubdivisionGroups } from '../../api/responses/regions.js';
import { pool } from '../../db/index.js';
import { inRegionTransaction, lockRegion } from '../../db/regionWriter.js';
import { badRequest, notFound } from '../../middleware/errorHandler.js';
import type { regionIdParamSchema, regionSubdivisionGroupsBodySchema } from '../../types/index.js';

type RegionParams = z.output<typeof regionIdParamSchema>;
type GroupsBody = z.output<typeof regionSubdivisionGroupsBodySchema>;

interface GroupRow {
  name: string;
  color: string | null;
  existing_region_id: number | null;
  member_row_ids: number[];
}

/**
 * A region's groups in their order. A member row counts as assigned only while
 * it is still in the region: one moved to a child region by *Create* is not.
 */
export async function getRegionSubdivisionGroups(
  { params: { regionId } }: { params: RegionParams },
): Promise<RegionSubdivisionGroups> {
  const result = await pool.query<GroupRow>(
    `SELECT g.name, g.color, g.existing_region_id,
            COALESCE(array_agg(a.region_member_id ORDER BY a.region_member_id)
                     FILTER (WHERE rm.id IS NOT NULL), '{}') AS member_row_ids
       FROM region_subdivision_groups g
       LEFT JOIN region_member_group_assignments a ON a.group_id = g.id
       LEFT JOIN region_members rm ON rm.id = a.region_member_id AND rm.region_id = g.region_id
      WHERE g.region_id = $1
      GROUP BY g.id
      ORDER BY g.sort_order`,
    [regionId],
  );
  return {
    groups: result.rows.map((row) => ({
      name: row.name,
      color: row.color,
      existingRegionId: row.existing_region_id,
      memberRowIds: row.member_row_ids,
    })),
  };
}

/**
 * Replace a region's groups with the dialog's. Under the region's lock, so two
 * admins' saves land one after the other. A member row no longer in the region
 * is left out rather than refused — the dialog may hold one another admin has
 * just moved — and so is a child region that is no longer one; a member in two
 * groups is refused, since it can go to one subregion only.
 */
export async function saveRegionSubdivisionGroups(
  { params: { regionId }, body }: { params: RegionParams; body: GroupsBody },
): Promise<typeof NO_CONTENT> {
  const all = body.groups.flatMap((g) => g.memberRowIds);
  if (new Set(all).size !== all.length) throw badRequest('A member is in more than one group');

  await inRegionTransaction(async (tx) => {
    if (!(await lockRegion(tx, regionId, 'id'))) throw notFound('Region not found');
    const [members, children] = await Promise.all([
      tx.query<{ id: number }>('SELECT id FROM region_members WHERE region_id = $1 AND id = ANY($2::int[])', [regionId, all]),
      tx.query<{ id: number }>('SELECT id FROM regions WHERE parent_region_id = $1', [regionId]),
    ]);
    const inRegion = new Set(members.rows.map((r) => r.id));
    const childIds = new Set(children.rows.map((r) => r.id));

    await tx.query('DELETE FROM region_subdivision_groups WHERE region_id = $1', [regionId]);
    for (const [order, group] of body.groups.entries()) {
      const existing = group.existingRegionId != null && childIds.has(group.existingRegionId) ? group.existingRegionId : null;
      const { rows: [{ id }] } = await tx.query<{ id: number }>(
        `INSERT INTO region_subdivision_groups (region_id, name, color, existing_region_id, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [regionId, group.name, group.color ?? null, existing, order],
      );
      const memberIds = group.memberRowIds.filter((m) => inRegion.has(m));
      if (memberIds.length) {
        // A row moved here from another region by an UPDATE (Create, Quick
        // Expand, a smart simplify) keeps its id and its old assignment; the
        // row is checked to be this region's, so that assignment is stale and
        // is taken over rather than refusing the save.
        await tx.query(
          `INSERT INTO region_member_group_assignments (region_member_id, group_id) SELECT unnest($1::int[]), $2
           ON CONFLICT (region_member_id) DO UPDATE SET group_id = EXCLUDED.group_id`,
          [memberIds, id],
        );
      }
    }
  });
  return NO_CONTENT;
}

/**
 * Drop a region's groups, as *Create* does once they are subregions; a region
 * without any is answered the same. Under the region's lock, like a save, so a
 * save already holding it lands before the drop rather than after.
 */
export async function deleteRegionSubdivisionGroups(
  { params: { regionId } }: { params: RegionParams },
): Promise<typeof NO_CONTENT> {
  await inRegionTransaction(async (tx) => {
    if (!(await lockRegion(tx, regionId, 'id'))) return;
    await tx.query('DELETE FROM region_subdivision_groups WHERE region_id = $1', [regionId]);
  });
  return NO_CONTENT;
}
