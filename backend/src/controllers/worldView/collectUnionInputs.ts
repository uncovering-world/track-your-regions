/**
 * The collect step of the union pipeline, shared by the writers of
 * `regions.geom`.
 *
 * A region's geometry is made of two kinds of shape and the step gathers both:
 * the divisions it holds directly (`region_members`, each with its optional
 * `custom_geom` override) and the child regions under it. The complexity gate
 * sums both, and the union that follows is meant to see both.
 *
 * It keeps the members a second time on their own, because the neighbour snap
 * that may run between here and the union reads the children alone. Its result
 * replaces the geometry the union is given, so the members have to be carried
 * across it — see `snapChildRegionsForGroup`, which collects them back in
 * (#736); they are read here, once, and both stay in the database.
 *
 * Every input is taken at full resolution, however many points the region
 * holds: no statement on the way to `regions.geom` coarsens a shape (rule 1 of
 * `docs/tech/geometry-columns.md`, #459). A union too large for the bound its
 * runtime sets fails loudly instead (`geometryTimeouts.ts`).
 */

import type { PoolClient } from 'pg';
import { UNION_WORK_TABLE } from './unionWork.js';

export interface CollectedUnionInputs {
  /** How many shapes of both kinds were gathered. */
  geomCount: number;
  /** Whether anything was gathered at all: a region with nothing to merge has no union to make. */
  hasGeometry: boolean;
}

/**
 * Gather the region's members and child regions into its `union_work` row
 * (`unionWork.ts`): both together as the union's input, the members alone for
 * the snap to carry across itself. Only the count comes back to Node.
 */
export async function collectUnionInputs(
  client: PoolClient,
  regionId: number,
): Promise<CollectedUnionInputs> {
  await client.query(UNION_WORK_TABLE);
  const collectResult = await client.query(`
    WITH direct_member_geoms AS (
      SELECT ST_MakeValid(COALESCE(rm.custom_geom, ad.geom)) as geom
      FROM region_members rm
      JOIN administrative_divisions ad ON rm.division_id = ad.id
      WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
    ),
    child_group_geoms AS (
      SELECT ST_MakeValid(geom) as geom
      FROM regions
      WHERE parent_region_id = $1 AND geom IS NOT NULL
    )
    INSERT INTO union_work (region_id, collected, members, geom_count)
    SELECT $1, ST_Collect(geom), ST_Collect(geom) FILTER (WHERE is_member), COUNT(*)
    FROM (
      SELECT geom, true as is_member FROM direct_member_geoms WHERE geom IS NOT NULL
      UNION ALL
      SELECT geom, false as is_member FROM child_group_geoms WHERE geom IS NOT NULL
    ) all_geoms
    ON CONFLICT (region_id) DO UPDATE
      SET collected = EXCLUDED.collected, members = EXCLUDED.members, geom_count = EXCLUDED.geom_count
    RETURNING geom_count, collected IS NOT NULL AS has_geometry
  `, [regionId]);

  return {
    geomCount: parseInt(collectResult.rows[0]?.geom_count || '0'),
    hasGeometry: collectResult.rows[0]?.has_geometry === true,
  };
}
