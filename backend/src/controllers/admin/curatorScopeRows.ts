/**
 * A curator assignment, from the row its read answers to the `CuratorScope` the
 * answers declare (`api/responses/auth.ts`, ADR-0066): key by key, its
 * timestamp as the ISO string the wire carries.
 *
 * The account read (`GET /api/users/me`) maps its assignments here. It sits with
 * the admin controllers because the curator directory answers the same shape,
 * still built in SQL there (`curatorController.ts`), and that answer's slice of
 * #527 (#989) is to map through this one too.
 */

import type { CuratorScope } from '../../api/responses/auth.js';
import type { CuratorAssignmentsRow, ExperienceSourcesRow, RegionsRow } from '../../db/schema.generated.js';
import type { CuratorScopeType } from '../../types/auth.js';

/** One assignment, with the names of the region and source it reaches (null where it reaches neither). */
export type CuratorScopeRow = Pick<CuratorAssignmentsRow, 'id' | 'region_id' | 'source_id' | 'assigned_at' | 'notes'> & {
  scope_type: CuratorScopeType;
  region_name: RegionsRow['name'] | null;
  source_name: ExperienceSourcesRow['name'] | null;
};

export function curatorScopeOf(row: CuratorScopeRow): CuratorScope {
  return {
    id: row.id,
    scopeType: row.scope_type,
    regionId: row.region_id,
    regionName: row.region_name,
    sourceId: row.source_id,
    sourceName: row.source_name,
    assignedAt: row.assigned_at === null ? null : row.assigned_at.toISOString(),
    notes: row.notes,
  };
}
