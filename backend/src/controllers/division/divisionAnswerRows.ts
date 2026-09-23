/**
 * GADM's divisions, from the rows their queries answer to the shapes the
 * answers declare (`api/responses/divisions.ts`, ADR-0066).
 *
 * The five tree reads (roots, one division, children, ancestors, siblings)
 * select `DIVISION_COLUMNS`, and the search selects `FOCUS_JSON_COLUMNS` beside
 * its own path and score; every one of them maps through `divisionOf`, so no
 * producer can drop the stored focus a selection is framed by. Each mapper
 * writes the keys its schema names and nothing else a query selects.
 */

import type {
  AdministrativeDivision, DivisionGeometry, DivisionSearchResult,
} from '../../api/responses/divisions.js';
import type { MultiPolygon } from '../../api/responses/experiences.js';
import type { AnchorPoint, FocusBbox } from '../../api/responses/regions.js';
import type { AdministrativeDivisionsRow } from '../../db/schema.generated.js';
import { FOCUS_JSON_COLUMNS } from './focusColumns.js';

/** One select list for every division read. */
export const DIVISION_COLUMNS = `id, parent_id, name, has_children, ${FOCUS_JSON_COLUMNS}`;

/**
 * The row every division read answers with: the four scalars and the stored
 * focus, aliased the way `FOCUS_JSON_COLUMNS` names it.
 */
export type DivisionRow = Pick<AdministrativeDivisionsRow, 'id' | 'name' | 'parent_id' | 'has_children'> & {
  focus_bbox_json: FocusBbox | null;
  anchor_point_json: AnchorPoint | null;
};

export function divisionOf(row: DivisionRow): AdministrativeDivision {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    hasChildren: row.has_children,
    focusBbox: row.focus_bbox_json,
    anchorPoint: row.anchor_point_json,
  };
}

/** How the asked-for world view uses a found division; all zero when none was named. */
export interface DivisionUsage {
  usageCount: number;
  usedAsSubdivisionCount: number;
  hasUsedSubdivisions: boolean;
}

export function divisionSearchResultOf(row: DivisionRow & { path: string }, usage: DivisionUsage): DivisionSearchResult {
  return {
    ...divisionOf(row),
    path: row.path,
    usageCount: usage.usageCount,
    usedAsSubdivisionCount: usage.usedAsSubdivisionCount,
    hasUsedSubdivisions: usage.hasUsedSubdivisions,
  };
}

export function divisionGeometryOf(id: number, geometry: MultiPolygon): DivisionGeometry {
  return { type: 'Feature', properties: { id }, geometry };
}
