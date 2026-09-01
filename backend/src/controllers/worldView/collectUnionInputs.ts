/**
 * The collect step of the union pipeline, shared by all three writers of
 * `regions.geom`.
 *
 * A region's geometry is made of two kinds of shape and the step gathers both:
 * the divisions it holds directly (`region_members`, each with its optional
 * `custom_geom` override) and the child regions under it. The complexity gate
 * sums both, and the union that follows is meant to see both.
 *
 *
 * `shouldSimplify` is the input-side timeout guard, not a tolerance the stored
 * shape is meant to carry: above 300,000 input points the inputs are coarsened
 * to 0.005 degrees so the union stays inside the five-minute bound the writers
 * set for themselves (#459). It is the one coarsening call any statement on the
 * way to `regions.geom` may make — rule 1 of `docs/tech/geometry-columns.md`.
 */

import { PoolClient } from 'pg';

export interface CollectedUnionInputs {
  /** Members and child regions together: what the union is made of. */
  collectedGeom: unknown;
  /** How many shapes of both kinds were gathered. */
  geomCount: number;
}

export async function collectUnionInputs(
  client: PoolClient,
  regionId: number,
  shouldSimplify: boolean,
): Promise<CollectedUnionInputs> {
  const collectResult = await client.query(`
    WITH direct_member_geoms AS (
      SELECT
        CASE WHEN $2 THEN
          ST_SimplifyPreserveTopology(ST_MakeValid(COALESCE(rm.custom_geom, ad.geom)), 0.005)
        ELSE
          ST_MakeValid(COALESCE(rm.custom_geom, ad.geom))
        END as geom
      FROM region_members rm
      JOIN administrative_divisions ad ON rm.division_id = ad.id
      WHERE rm.region_id = $1 AND (rm.custom_geom IS NOT NULL OR ad.geom IS NOT NULL)
    ),
    child_group_geoms AS (
      SELECT
        CASE WHEN $2 THEN
          ST_SimplifyPreserveTopology(ST_MakeValid(geom), 0.005)
        ELSE
          ST_MakeValid(geom)
        END as geom
      FROM regions
      WHERE parent_region_id = $1 AND geom IS NOT NULL
    )
    SELECT ST_Collect(geom) as collected_geom, COUNT(*) as geom_count
    FROM (
      SELECT geom FROM direct_member_geoms WHERE geom IS NOT NULL
      UNION ALL
      SELECT geom FROM child_group_geoms WHERE geom IS NOT NULL
    ) all_geoms
  `, [regionId, shouldSimplify]);

  return {
    collectedGeom: collectResult.rows[0]?.collected_geom,
    geomCount: parseInt(collectResult.rows[0]?.geom_count || '0'),
  };
}
