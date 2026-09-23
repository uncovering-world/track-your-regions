/**
 * The import review's rows, from what the tree read selects to the answers
 * `api/responses/worldViewImport.ts` declares (ADR-0066): key by key. The
 * suggestions and assigned divisions a row carries are built in SQL as JSON,
 * and the marker points are stored JSON, so each is read out one key at a
 * time rather than passed through.
 */

import type {
  AssignedDivision,
  MarkerPoint,
  MatchStatus,
  MatchSuggestion,
  MatchTreeNode,
} from '../../api/responses/worldViewImport.js';
import type { RegionImportStateRow, RegionsRow } from '../../db/schema.generated.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordsOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The sibling holding a suggested division, or null. The donor's columns are
 * `ON DELETE SET NULL`, so a conflict whose donor region or division has since
 * been deleted names nobody to move the division from, and is no conflict.
 */
function conflictOf(value: unknown): MatchSuggestion['conflict'] {
  if (!isRecord(value) || (value.type !== 'direct' && value.type !== 'split')) return null;
  const { donorRegionId, donorRegionName, donorDivisionId, donorDivisionName } = value;
  if (typeof donorRegionId !== 'number' || typeof donorDivisionId !== 'number'
    || typeof donorRegionName !== 'string' || typeof donorDivisionName !== 'string') return null;
  return { type: value.type, donorRegionId, donorRegionName, donorDivisionId, donorDivisionName };
}

/** A suggestion as the tree read's `json_build_object` spells it. */
export function matchSuggestionOf(value: Record<string, unknown>): MatchSuggestion {
  return {
    divisionId: Number(value.divisionId),
    name: String(value.name),
    path: stringOrNull(value.path),
    score: numberOrNull(value.score),
    geoSimilarity: numberOrNull(value.geoSimilarity),
    conflict: conflictOf(value.conflict),
  };
}

function assignedDivisionOf(value: Record<string, unknown>): AssignedDivision {
  return {
    divisionId: Number(value.divisionId),
    name: String(value.name),
    path: String(value.path ?? value.name),
    hasCustomGeom: value.hasCustomGeom === true,
  };
}

function markerPointsOf(value: unknown): MarkerPoint[] | null {
  if (!Array.isArray(value)) return null;
  return recordsOf(value)
    .filter(point => typeof point.lat === 'number' && typeof point.lon === 'number')
    .map(point => ({ name: String(point.name ?? ''), lat: point.lat as number, lon: point.lon as number }));
}

/** A region as the tree read selects it. */
export type MatchTreeRow = Pick<RegionsRow, 'id' | 'name' | 'parent_region_id' | 'is_leaf'>
  & Pick<RegionImportStateRow, 'source_url' | 'region_map_url' | 'fix_note' | 'marker_points'>
  & {
    match_status: MatchStatus | null;
    map_image_reviewed: boolean | null;
    needs_manual_fix: boolean | null;
    wikidata_id: string | null;
    hierarchy_warnings: string[] | null;
    hierarchy_reviewed: boolean | null;
    geo_available: boolean | null;
    suggestions: unknown;
    map_image_candidates: unknown;
    member_count: string;
    assigned_divisions: unknown;
  };

export function matchTreeNodeOf(row: MatchTreeRow): MatchTreeNode {
  return {
    id: row.id,
    name: row.name,
    isLeaf: row.is_leaf === true,
    matchStatus: row.match_status,
    suggestions: recordsOf(row.suggestions).map(matchSuggestionOf),
    sourceUrl: row.source_url,
    regionMapUrl: row.region_map_url,
    mapImageCandidates: Array.isArray(row.map_image_candidates)
      ? row.map_image_candidates.filter((url): url is string => typeof url === 'string')
      : [],
    mapImageReviewed: row.map_image_reviewed === true,
    needsManualFix: row.needs_manual_fix === true,
    fixNote: row.fix_note,
    wikidataId: row.wikidata_id,
    memberCount: parseInt(row.member_count, 10),
    assignedDivisions: recordsOf(row.assigned_divisions).map(assignedDivisionOf),
    geoAvailable: row.geo_available,
    markerPoints: markerPointsOf(row.marker_points),
    hierarchyWarnings: row.hierarchy_warnings ?? [],
    hierarchyReviewed: row.hierarchy_reviewed === true,
    children: [],
  };
}
