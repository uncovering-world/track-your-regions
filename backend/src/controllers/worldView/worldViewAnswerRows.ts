/**
 * World views, from the rows their queries answer to the shapes the answers
 * declare (`api/responses/worldViews.ts`, ADR-0066). Each mapper writes the
 * keys its schema names and nothing else a query selects.
 */

import type { DeleteImpact, WorldView } from '../../api/responses/worldViews.js';
import type { WorldViewsRow } from '../../db/schema.generated.js';

/** The columns every world view answer selects, as they are stored. */
export const WORLD_VIEW_COLUMNS_SQL = 'id, name, description, source, is_default, is_public, tile_version';

export type WorldViewRow = Pick<
  WorldViewsRow, 'id' | 'name' | 'description' | 'source' | 'is_default' | 'is_public' | 'tile_version'
>;

export function worldViewOf(row: WorldViewRow): WorldView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source,
    isDefault: row.is_default ?? false,
    isPublic: row.is_public,
    tileVersion: row.tile_version ?? 0,
  };
}

export interface DeleteImpactRow {
  region_count: number;
  experience_assignment_count: number;
  user_visit_count: number;
}

export function deleteImpactOf(row: DeleteImpactRow, isDefault: boolean | null): DeleteImpact {
  return {
    regionCount: row.region_count,
    experienceAssignmentCount: row.experience_assignment_count,
    userVisitCount: row.user_visit_count,
    isDefault: isDefault ?? false,
  };
}
