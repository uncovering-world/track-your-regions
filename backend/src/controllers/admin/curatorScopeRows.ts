/**
 * A curator assignment, from the row its read answers to the `CuratorScope` the
 * answers declare (`api/responses/auth.ts`, ADR-0066): key by key, its
 * timestamp as the ISO string the wire carries.
 *
 * Two answers carry assignments, the account read (`GET /api/users/me`) and the
 * curator directory (`GET /api/admin/curators`), and both read them with
 * `CURATOR_SCOPES_SQL` and map them here.
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

/** An assignment as `CURATOR_SCOPES_SQL` reads it, with the account it belongs to. */
export type CuratorScopeOfUserRow = CuratorScopeRow & Pick<CuratorAssignmentsRow, 'user_id'>;

/**
 * Every assignment of the accounts in `$1` (an array of user ids), newest
 * first, with the names of the region and source each reaches.
 */
export const CURATOR_SCOPES_SQL = `
  SELECT
    ca.user_id, ca.id, ca.scope_type, ca.region_id, r.name AS region_name,
    ca.source_id, es.name AS source_name, ca.assigned_at, ca.notes
  FROM curator_assignments ca
  LEFT JOIN regions r ON ca.region_id = r.id
  LEFT JOIN experience_sources es ON ca.source_id = es.id
  WHERE ca.user_id = ANY($1::int[])
  ORDER BY ca.assigned_at DESC
`;

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
