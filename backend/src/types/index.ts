import { z } from 'zod';

/**
 * Types for Track Your Regions Backend
 *
 * Terminology:
 * - AdministrativeDivision: Official GADM boundary (Germany, Bavaria, Munich)
 * - WorldView: Custom hierarchy for organizing regions
 * - Region: User-defined grouping within a WorldView
 * - RegionMember: A member of a Region (can be division or subregion)
 */

// =============================================================================
// Administrative Divisions (GADM boundaries)
// =============================================================================

export interface AdministrativeDivision {
  id: number;
  name: string;
  parentId: number | null;
  hasChildren: boolean;
}

export interface AdministrativeDivisionWithPath extends AdministrativeDivision {
  path: string;
  relevance?: number;
  usageCount?: number;
  usedAsSubdivisionCount?: number;
  hasUsedSubdivisions?: boolean;
}

// =============================================================================
// World Views
// =============================================================================

export interface WorldView {
  id: number;
  name: string;
  description: string | null;
  source: string | null;
  isDefault: boolean;
}

// =============================================================================
// Regions (user-defined groupings within a WorldView)
// =============================================================================

export interface Region {
  id: number;
  worldViewId: number;
  name: string;
  description: string | null;
  parentRegionId: number | null;
  color: string | null;
  hasSubregions?: boolean;
  isCustomBoundary?: boolean;
}

// =============================================================================
// Region Members
// =============================================================================

export interface RegionMember {
  id: number;
  name: string;
  parentId: number | null;
  hasChildren: boolean;
  memberType: 'division' | 'subregion';
  isSubregion: boolean;
  color?: string;
  path?: string;
  hasCustomGeometry?: boolean;
}

// =============================================================================
// Views
// =============================================================================

export interface View {
  id: number;
  name: string;
  description: string | null;
  worldViewId: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// GeoJSON types
// =============================================================================

export interface GeoJSONGeometry {
  type: 'MultiPolygon' | 'Polygon';
  coordinates: number[][][] | number[][][][];
}

export interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: GeoJSONGeometry;
}

// =============================================================================
// API query params
// =============================================================================

export const worldViewIdSchema = z.coerce.number().int().positive().default(1);
export const divisionIdSchema = z.coerce.number().int().positive();
export const regionIdSchema = z.coerce.number().int().positive();
export const viewIdSchema = z.coerce.number().int().positive();
export const detailLevelSchema = z.enum(['low', 'medium', 'high']).default('medium');
export const booleanStringSchema = z.enum(['true', 'false']).default('false');
export const limitSchema = z.coerce.number().int().min(1).max(1000).default(100);
export const offsetSchema = z.coerce.number().int().min(0).default(0);

// =============================================================================
// Request validation schemas
// =============================================================================

export const getSubdivisionsQuerySchema = z.object({
  worldViewId: worldViewIdSchema,
  getAll: booleanStringSchema,
  limit: limitSchema,
  offset: offsetSchema,
});

export const getGeometryQuerySchema = z.object({
  worldViewId: worldViewIdSchema,
  detail: detailLevelSchema,
  resolveEmpty: booleanStringSchema,
});

export const searchQuerySchema = z.object({
  query: z.string().max(255).optional().transform(v => v ?? ''),
  worldViewId: worldViewIdSchema,
  limit: limitSchema,
});

export const createViewSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  worldViewId: z.number().int().positive(),
  isActive: z.boolean().default(true),
});

export const updateViewSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const addDivisionsToViewSchema = z.object({
  divisionIds: z.array(z.number().int().positive()).min(1),
});

export const removeDivisionsFromViewSchema = z.object({
  divisionIds: z.array(z.number().int().positive()).min(1),
});

// =============================================================================
// Reusable param schemas (for path params)
// =============================================================================

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const regionIdParamSchema = z.object({
  regionId: z.coerce.number().int().positive(),
});

export const worldViewIdParamSchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
});

export const experienceIdParamSchema = z.object({
  experienceId: z.coerce.number().int().positive(),
});

export const locationIdParamSchema = z.object({
  locationId: z.coerce.number().int().positive(),
});

export const treasureIdParamSchema = z.object({
  treasureId: z.coerce.number().int().positive(),
});

export const markTreasureViewedBodySchema = z.object({
  experienceId: z.number().int().positive().optional(),
});

// =============================================================================
// Experience schemas
// =============================================================================

export const experienceSearchQuerySchema = z.object({
  q: z.string().min(2).max(255),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const experienceListQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  category: z.string().max(255).optional(),
  country: z.string().max(255).optional(),
  regionId: z.coerce.number().int().positive().optional(),
  search: z.string().max(255).optional(),
  bbox: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const experiencesByRegionQuerySchema = z.object({
  includeChildren: booleanStringSchema.default('true'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const experienceRegionCountsQuerySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
  parentRegionId: z.coerce.number().int().positive().optional(),
});

export const experienceLocationsQuerySchema = z.object({
  regionId: z.coerce.number().int().positive().optional(),
});

export const regionLocationsQuerySchema = z.object({
  includeChildren: booleanStringSchema.default('true'),
});

// Curation schemas
export const rejectExperienceBodySchema = z.object({
  regionId: z.number().int().positive(),
  reason: z.string().max(1000).optional(),
});

export const unrejectExperienceBodySchema = z.object({
  regionId: z.number().int().positive(),
});

export const assignExperienceBodySchema = z.object({
  regionId: z.number().int().positive(),
});

const safeUrlSchema = z.string().max(2000).optional().refine(
  (val) => !val || !/^(javascript|data|vbscript|blob):/i.test(val),
  { message: 'URL uses an unsafe scheme' },
);

export const editExperienceBodySchema = z.object({
  name: z.string().min(1).max(500).optional(),
  shortDescription: z.string().max(1000).optional(),
  description: z.string().max(10000).optional(),
  category: z.string().max(255).optional(),
  imageUrl: safeUrlSchema,
  tags: z.array(z.string().max(100)).max(50).optional(),
  websiteUrl: safeUrlSchema,
  wikipediaUrl: safeUrlSchema,
});

export const createManualExperienceBodySchema = z.object({
  name: z.string().min(1).max(500),
  shortDescription: z.string().max(1000).optional(),
  category: z.string().max(255).optional(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  imageUrl: safeUrlSchema,
  tags: z.array(z.string().max(100)).max(50).optional(),
  countryCode: z.string().max(10).optional(),
  countryName: z.string().max(255).optional(),
  regionId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  websiteUrl: safeUrlSchema,
  wikipediaUrl: safeUrlSchema,
});

export const idAndRegionIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  regionId: z.coerce.number().int().positive(),
});

// =============================================================================
// User visited schemas
// =============================================================================

export const markVisitedBodySchema = z.object({
  notes: z.string().max(2000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

export const updateVisitBodySchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});

export const markLocationVisitedBodySchema = z.object({
  notes: z.string().max(2000).optional(),
});

export const visitedExperiencesQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const visitedIdsQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
});

export const visitedLocationIdsQuerySchema = z.object({
  experienceId: z.coerce.number().int().positive().optional(),
});

export const viewedTreasureIdsQuerySchema = z.object({
  experienceId: z.coerce.number().int().positive().optional(),
});

export const markAllLocationsQuerySchema = z.object({
  regionId: z.coerce.number().int().positive().optional(),
});

export const visitedRegionBodySchema = z.object({
  notes: z.string().max(2000).optional(),
});

// =============================================================================
// Admin schemas
// =============================================================================

export const categoryIdParamSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
});

export const logIdParamSchema = z.object({
  logId: z.coerce.number().int().positive(),
});

export const assignmentIdParamSchema = z.object({
  assignmentId: z.coerce.number().int().positive(),
});

export const userIdParamSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const startSyncBodySchema = z.object({
  force: z.boolean().optional(),
});

export const reorderCategoriesBodySchema = z.object({
  categoryIds: z.array(z.number().int().positive()).min(1),
});

export const startRegionAssignmentBodySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive().optional(),
});

export const regionAssignmentStatusQuerySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
});

export const experienceCountsQuerySchema = z.object({
  worldViewId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive().optional(),
});

export const syncLogsQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createCuratorAssignmentBodySchema = z.object({
  userId: z.number().int().positive(),
  scopeType: z.enum(['region', 'category', 'global']),
  regionId: z.number().int().positive().optional(),
  categoryId: z.number().int().positive().optional(),
  notes: z.string().max(1000).optional(),
});

export const curatorActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const adminUserSearchQuerySchema = z.object({
  q: z.string().min(2).max(255),
});

// =============================================================================
// Wikivoyage extraction schemas
// =============================================================================

export const wvExtractStartSchema = z.object({
  name: z.string().min(1).max(255).default('Wikivoyage Regions'),
  useCache: z.boolean().default(true),
});

// =============================================================================
// WorldView import schemas
// =============================================================================

/** Recursive schema for ImportTreeNode */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const importTreeNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(500),
    regionMapUrl: z.string().url().max(2000).optional(),
    mapImageCandidates: z.array(z.string().url().max(2000)).max(20).optional(),
    wikidataId: z.string().regex(/^Q\d+$/).optional(),
    sourceUrl: z.string().url().max(2000).optional(),
    children: z.array(importTreeNodeSchema).default([]),
  }),
);

export const wvImportBodySchema = z.object({
  name: z.string().min(1).max(255),
  tree: importTreeNodeSchema,
  matchingPolicy: z.enum(['country-based', 'none']).default('country-based'),
});

export const wvImportAcceptMatchSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  divisionId: z.coerce.number().int().positive(),
});

export const wvImportAcceptBatchSchema = z.object({
  assignments: z.array(z.object({
    regionId: z.coerce.number().int().positive(),
    divisionId: z.coerce.number().int().positive(),
  })).min(1).max(1000),
});

export const wvImportRegionIdSchema = z.object({
  regionId: z.coerce.number().int().positive(),
});

export const wvImportMarkManualFixSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  needsManualFix: z.boolean(),
  fixNote: z.string().max(500).optional(),
});

export const wvImportSelectMapImageSchema = z.object({
  regionId: z.coerce.number().int().positive(),
  imageUrl: z.string().url().nullable(),
});

export const wikidataIdParamSchema = z.object({
  wikidataId: z.string().regex(/^Q\d+$/),
});

export const divisionIdBodySchema = z.object({
  divisionId: z.coerce.number().int().positive(),
});

export const wvImportApproveCoverageSchema = z.object({
  divisionId: z.coerce.number().int().positive(),
  regionId: z.coerce.number().int().positive(),
  action: z.enum(['add_member', 'create_region']),
  gapName: z.string().max(255).optional(),
});

// =============================================================================
// World View schemas
// =============================================================================

export const createWorldViewBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  source: z.string().max(1000).optional(),
});

export const updateWorldViewBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  source: z.string().max(1000).optional(),
});

export const createRegionBodySchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  parentRegionId: z.number().int().positive().optional(),
  parentGroupId: z.number().int().positive().optional(),
  color: z.string().max(50).optional(),
  customGeometry: z.any().optional(),
});

export const updateRegionBodySchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  parentRegionId: z.number().int().positive().nullable().optional(),
  parentGroupId: z.number().int().positive().nullable().optional(),
  color: z.string().max(50).nullable().optional(),
  usesHull: z.boolean().optional(),
});

export const deleteRegionQuerySchema = z.object({
  moveChildrenToParent: booleanStringSchema.default('false'),
});

export const regionSearchQuerySchema = z.object({
  query: z.string().min(2).max(255),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const addDivisionsToRegionBodySchema = z.object({
  divisionIds: z.array(z.number().int().positive()).optional(),
  regionIds: z.array(z.number().int().positive()).optional(),
  createAsGroups: z.boolean().optional(),
  createAsSubregions: z.boolean().optional(),
  includeSiblings: z.boolean().optional(),
  includeChildren: z.boolean().optional(),
  inheritColor: z.boolean().default(true),
  childIds: z.array(z.number().int().positive()).optional(),
  customGroupName: z.string().max(500).optional(),
  customName: z.string().max(500).optional(),
  customGeometry: z.any().optional(),
});

export const removeDivisionsFromRegionBodySchema = z.object({
  divisionIds: z.array(z.number().int().positive()).optional(),
  regionIds: z.array(z.number().int().positive()).optional(),
  memberRowIds: z.array(z.number().int().positive()).optional(),
});

export const moveMemberBodySchema = z.object({
  memberRowId: z.number().int().positive(),
  toRegionId: z.number().int().positive(),
});

export const addChildDivisionsBodySchema = z.object({
  childIds: z.array(z.number().int().positive()).optional(),
  removeOriginal: z.boolean().default(true),
  inheritColor: z.boolean().default(true),
  createAsSubregions: z.boolean().default(true),
  createAsSubgroups: z.boolean().default(true),
  /** Explicit GADM child → existing region assignments (skips name-match, skips create) */
  assignments: z.array(z.object({
    gadmChildId: z.number().int().positive(),
    existingRegionId: z.number().int().positive(),
  })).optional(),
});

export const expandToSubregionsBodySchema = z.object({
  inheritColor: z.boolean().default(true),
});

export const divisionUsageBodySchema = z.object({
  divisionIds: z.array(z.number().int().positive()).optional(),
  regionIds: z.array(z.number().int().positive()).optional(),
});

export const hullPreviewBodySchema = z.object({
  bufferKm: z.number().min(0).max(1000).optional(),
  concavity: z.number().min(0).max(100).optional(),
  simplifyTolerance: z.number().min(0).max(10).optional(),
  customGeometry: z.any().optional(),
});

export const hullSaveBodySchema = z.object({
  bufferKm: z.number().min(0).max(1000).optional(),
  concavity: z.number().min(0).max(100).optional(),
  simplifyTolerance: z.number().min(0).max(10).optional(),
});

export const updateGeometryBodySchema = z.object({
  geometry: z.any(),
  isCustomBoundary: z.boolean().default(true),
  hullGeometry: z.any().optional(),
});

export const subregionGeometriesQuerySchema = z.object({
  useDisplay: booleanStringSchema.default('false'),
});

export const computeGeometryQuerySchema = z.object({
  force: booleanStringSchema.default('false'),
});

export const computeSSEQuerySchema = z.object({
  force: booleanStringSchema.default('false'),
  skipSnapping: booleanStringSchema.default('false'),
  token: z.string().optional(), // JWT passed as query param (EventSource can't send headers)
});

export const coverageSSEQuerySchema = z.object({
  token: z.string().optional(), // JWT passed as query param (EventSource can't send headers)
});

export const regenerateDisplayQuerySchema = z.object({
  regionId: z.coerce.number().int().positive().optional(),
});

export const regionGeometryDetailQuerySchema = z.object({
  detail: z.enum(['high', 'display', 'hull', 'anchor']).optional(),
});

// =============================================================================
// Geocode schemas
// =============================================================================

export const geocodeSearchQuerySchema = z.object({
  q: z.string().min(2).max(255),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export const suggestImageQuerySchema = z.object({
  name: z.string().max(500).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  wikidataId: z.string().max(50).optional(),
});

export const aiGeocodeBodySchema = z.object({
  description: z.string().min(2).max(1000),
});

// =============================================================================
// AI schemas
// =============================================================================

export const setModelBodySchema = z.object({
  modelId: z.string().min(1).max(255),
});

export const suggestGroupBodySchema = z.object({
  regionPath: z.string().max(1000),
  regionName: z.string().max(500),
  availableGroups: z.array(z.string().max(500)),
  parentRegion: z.string().max(500),
  groupDescriptions: z.record(z.string()).optional(),
  useWebSearch: z.boolean().optional(),
  worldViewSource: z.string().max(1000).optional(),
  escalationLevel: z.enum(['fast', 'reasoning', 'reasoning_search']).optional(),
});

export const suggestGroupsBatchBodySchema = z.object({
  regions: z.array(z.object({
    path: z.string().max(1000),
    name: z.string().max(500),
  })).min(1).max(100),
  availableGroups: z.array(z.string().max(500)),
  parentRegion: z.string().max(500),
  worldViewDescription: z.string().max(2000).optional(),
  worldViewSource: z.string().max(1000).optional(),
  useWebSearch: z.boolean().optional(),
  groupDescriptions: z.record(z.string()).optional(),
});

export const generateDescriptionsBodySchema = z.object({
  groups: z.array(z.string().max(500)).min(1).max(100),
  parentRegion: z.string().max(500),
  worldViewDescription: z.string().max(2000).optional(),
  worldViewSource: z.string().max(1000).optional(),
  useWebSearch: z.boolean().optional(),
});

// =============================================================================
// Type exports for validated requests
// =============================================================================

export type GetSubdivisionsQuery = z.infer<typeof getSubdivisionsQuerySchema>;
export type GetGeometryQuery = z.infer<typeof getGeometryQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type CreateViewBody = z.infer<typeof createViewSchema>;
export type UpdateViewBody = z.infer<typeof updateViewSchema>;
