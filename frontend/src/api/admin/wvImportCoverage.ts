/**
 * Admin WorldView Import — Coverage Analysis
 *
 * GADM coverage gap detection (sync + SSE streaming progress), geo-suggest,
 * dismiss / approve / undismiss gaps, finalize review, children region geometry.
 */

import { authFetchJson, ensureFreshToken } from '../fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Coverage Types
// =============================================================================

export interface SubtreeNode {
  id: number;
  name: string;
  children: SubtreeNode[];
}

export interface CoverageGap {
  id: number;
  name: string;
  parentName: string | null;
  suggestion: {
    action: 'add_member' | 'create_region';
    targetRegionId: number;
    targetRegionName: string;
  } | null;
  /** GADM descendant tree for non-leaf gaps (helps admin understand what's underneath) */
  subtree?: SubtreeNode[];
}

export interface CoverageResult {
  gaps: CoverageGap[];
  dismissedCount: number;
  dismissedGaps: Array<{ id: number; name: string; parentName: string | null }>;
}

export interface CoverageProgressEvent {
  type: 'progress' | 'complete' | 'error';
  step?: string;
  elapsed?: number;
  message?: string;
  data?: CoverageResult;
}

/** Nested tree node for geo-suggest hierarchy selection */
export interface RegionContextNode {
  id: number;
  name: string;
  children: RegionContextNode[];
  isSuggested: boolean;
}

export interface GeoSuggestResult {
  suggestion: {
    action: 'add_member' | 'create_region';
    targetRegionId: number;
    targetRegionName: string;
  } | null;
  suggestionDivisionId?: number;
  suggestionDivisionName?: string;
  gapCenter?: [number, number];
  suggestionCenter?: [number, number];
  /** Distance from gap centroid to nearest boundary of neighbor polygon (km) */
  distanceKm?: number;
  /** Nested hierarchy tree: root → ... → suggested region (with children) */
  contextTree?: RegionContextNode;
}

export interface SiblingRegionGeometry {
  regionId: number;
  name: string;
  geometry: GeoJSON.Geometry;
}

// =============================================================================
// Coverage API Functions
// =============================================================================

export async function getCoverage(worldViewId: number): Promise<CoverageResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage`);
}

/**
 * Check GADM coverage with SSE streaming for progress updates.
 * Mirrors computeRegionGeometryWithProgress from geometry.ts.
 */
export function getCoverageWithProgress(
  worldViewId: number,
  onProgress: (event: CoverageProgressEvent) => void,
): Promise<CoverageResult> {
  return new Promise((resolve, reject) => {
    ensureFreshToken().then(token => {
      const params = new URLSearchParams();
      if (token) params.append('token', token);
      const query = params.toString();
      const url = `${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage-stream${query ? '?' + query : ''}`;

      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as CoverageProgressEvent;
          onProgress(data);

          if (data.type === 'complete' || data.type === 'error') {
            eventSource.close();
            if (data.type === 'error') {
              reject(new Error(data.message || 'Coverage check failed'));
            } else if (data.data) {
              resolve(data.data);
            } else {
              reject(new Error('Coverage check completed without a result payload'));
            }
          }
        } catch (e) {
          console.error('Failed to parse SSE event:', e);
          eventSource.close();
          reject(new Error('Invalid coverage SSE payload'));
        }
      };

      eventSource.onerror = (e) => {
        console.error('Coverage SSE error:', e);
        eventSource.close();
        reject(new Error('Connection to server lost'));
      };
    }).catch(reject);
  });
}

export async function geoSuggestGap(
  worldViewId: number,
  divisionId: number,
): Promise<GeoSuggestResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/geo-suggest-gap`, {
    method: 'POST',
    body: JSON.stringify({ divisionId }),
  });
}

export async function dismissCoverageGap(
  worldViewId: number,
  divisionId: number,
): Promise<{ dismissed: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/dismiss-gap`, {
    method: 'POST',
    body: JSON.stringify({ divisionId }),
  });
}

export async function approveCoverageSuggestion(
  worldViewId: number,
  divisionId: number,
  regionId: number,
  action: 'add_member' | 'create_region',
  gapName?: string,
): Promise<{ approved: boolean; regionId: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/approve-coverage`, {
    method: 'POST',
    body: JSON.stringify({ divisionId, regionId, action, gapName }),
  });
}

export async function undismissCoverageGap(
  worldViewId: number,
  divisionId: number,
): Promise<{ undismissed: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/undismiss-gap`, {
    method: 'POST',
    body: JSON.stringify({ divisionId }),
  });
}

export async function finalizeReview(
  worldViewId: number,
): Promise<{ finalized: boolean; worldViewId: number }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/finalize`, {
    method: 'POST',
  });
}

/** Get per-child region geometries for drill-down on the gap context map */
export async function getChildrenRegionGeometry(
  worldViewId: number,
  regionId: number,
): Promise<{ childRegions: SiblingRegionGeometry[] }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/children-geometry/${regionId}`);
}

// =============================================================================
// Children Coverage (per-region container coverage %)
// =============================================================================

/**
 * Per-region coverage cache:
 * - `coverage[regionId]` — fraction (0..1) of the region's GADM coverage relative to its members
 * - `geoshapeCoverage[regionId]` — fraction relative to the matched Wikidata geoshape (when available)
 */
export interface ChildrenCoverageResult {
  coverage: Record<string, number>;
  geoshapeCoverage: Record<string, number>;
}

/**
 * Fetch children-coverage for a world view. Three call shapes:
 * - getChildrenCoverage(worldViewId)                   → all regions
 * - getChildrenCoverage(worldViewId, regionId)         → ancestors of regionId
 * - getChildrenCoverage(worldViewId, undefined, ancestorId) → single ancestor only
 *
 * Wire-format note: the third shape sends `?onlyId=<id>`, which matches the
 * backend's Zod schema (childrenCoverageQuerySchema accepts `regionId` and
 * `onlyId` only). The JS argument is named `ancestorId` because that's the
 * caller's intent — a specific ancestor's row to refresh after a mutation —
 * but it maps to the backend's `onlyId` filter that short-circuits to
 * `targetAncestorIds = new Set([onlyId])` (fast single-ancestor path).
 */
export async function getChildrenCoverage(
  worldViewId: number,
  regionId?: number,
  ancestorId?: number,
): Promise<ChildrenCoverageResult> {
  const params = new URLSearchParams();
  if (regionId != null) params.set('regionId', String(regionId));
  if (ancestorId != null) params.set('onlyId', String(ancestorId));
  const query = params.toString();
  const url = `${API_URL}/api/admin/wv-import/matches/${worldViewId}/children-coverage${query ? '?' + query : ''}`;
  return authFetchJson(url);
}

// =============================================================================
// Coverage Geometry / Gap Analysis
// =============================================================================

export interface CoverageGeometryResult {
  parentGeometry: GeoJSON.Geometry | null;
  childrenGeometry: GeoJSON.Geometry | null;
  geoshapeGeometry?: GeoJSON.Geometry | null;
}

export async function getCoverageGeometry(
  worldViewId: number,
  regionId: number,
): Promise<CoverageGeometryResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage-geometry/${regionId}`);
}

export interface CoverageGapDivision {
  divisionId: number;
  name: string;
  path: string;
  geometry?: GeoJSON.Geometry | null;
  areaKm2: number;
  gadmParentId: number | null;
  suggestedTarget?: { regionId: number } | null;
}

export interface AnalyzeCoverageGapsResult {
  gapDivisions: CoverageGapDivision[];
  siblingRegions: SiblingRegionGeometry[];
}

export async function analyzeCoverageGaps(
  worldViewId: number,
  regionId: number,
): Promise<AnalyzeCoverageGapsResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/analyze-coverage-gaps`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

// =============================================================================
// Geometry preview (union / split / vision-match)
// =============================================================================

export interface UnionGeometryResult {
  geometry: GeoJSON.FeatureCollection;
}

export async function getUnionGeometry(
  worldViewId: number,
  divisionIds: number[],
  regionId?: number,
): Promise<UnionGeometryResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/union-geometry`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, regionId }),
  });
}

export interface SplitDeeperResult {
  divisions: Array<{ divisionId: number; name: string; path?: string }>;
  geometry: GeoJSON.FeatureCollection;
  points?: Array<{ name: string; lat: number; lon: number }>;
}

export async function splitDivisionsDeeper(
  worldViewId: number,
  divisionIds: number[],
  wikidataId: string,
  regionId: number,
  source?: 'geoshape' | 'points' | 'image',
): Promise<SplitDeeperResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/split-divisions-deeper`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, wikidataId, regionId, source }),
  });
}

export interface VisionMatchDivisionsResult {
  suggestedIds: number[];
  rejectedIds?: number[];
  unclearIds?: number[];
  reasoning?: string;
  debugImages?: { regionMap: string; divisionsMap: string };
}

export async function visionMatchDivisions(
  worldViewId: number,
  divisionIds: number[],
  regionId: number,
  regionMapUrl: string,
): Promise<VisionMatchDivisionsResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/vision-match-divisions`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, regionId, regionMapUrl }),
  });
}
