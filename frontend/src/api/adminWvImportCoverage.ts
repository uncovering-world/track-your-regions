/**
 * Admin WorldView Import — Coverage Analysis
 *
 * GADM coverage gap detection, SSE streaming progress, geo-suggest,
 * dismiss/approve gaps, children coverage, coverage geometry.
 */

import { authFetchJson, ensureFreshToken } from './fetchUtils';

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
  /** Nested hierarchy tree: root -> ... -> suggested region (with children) */
  contextTree?: RegionContextNode;
}

export interface ChildrenCoverageResult {
  coverage: Record<string, number>;
  geoshapeCoverage: Record<string, number>;
}

export interface SplitDeeperDivision {
  divisionId: number;
  name: string;
  path: string;
  parentId: number | null;
  coverage: number | null;
  hasPoints: boolean;
  assignedTo: string | null;
}

export interface SplitDeeperResult {
  divisions: SplitDeeperDivision[];
  geometry: GeoJSON.FeatureCollection | null;
  points?: Array<{ name: string; lat: number; lon: number }>;
}

export interface SiblingRegionGeometry {
  regionId: number;
  name: string;
  geometry: GeoJSON.Geometry;
}

export interface CoverageGeometryResult {
  parentGeometry: GeoJSON.Geometry | null;
  childrenGeometry: GeoJSON.Geometry | null;
  geoshapeGeometry?: GeoJSON.Geometry | null;
}

export interface CoverageGapDivision {
  divisionId: number;
  gadmParentId: number | null;
  name: string;
  path: string;
  level: number;
  areaKm2: number;
  overlapWithGap: number;
  geometry: GeoJSON.Geometry | null;
  suggestedTarget: { regionId: number; regionName: string } | null;
}

export interface CoverageGapAnalysisResult {
  gapDivisions: CoverageGapDivision[];
  siblingRegions: SiblingRegionGeometry[];
  message?: string;
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
            } else {
              resolve(data.data!);
            }
          }
        } catch (e) {
          console.error('Failed to parse SSE event:', e);
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

export async function getChildrenCoverage(
  worldViewId: number,
  regionId?: number,
  onlyId?: number,
): Promise<ChildrenCoverageResult> {
  const searchParams = new URLSearchParams();
  if (regionId != null) searchParams.set('regionId', String(regionId));
  if (onlyId != null) searchParams.set('onlyId', String(onlyId));
  const qs = searchParams.toString();
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/children-coverage${qs ? `?${qs}` : ''}`);
}

export async function getUnionGeometry(
  worldViewId: number,
  divisionIds: number[],
  regionId?: number,
): Promise<{ geometry: GeoJSON.FeatureCollection }> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/union-geometry`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, ...(regionId != null ? { regionId } : {}) }),
  });
}

export async function splitDivisionsDeeper(
  worldViewId: number,
  divisionIds: number[],
  wikidataId: string,
  regionId: number,
  source?: 'geoshape' | 'points' | 'image',
): Promise<SplitDeeperResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/split-deeper`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, wikidataId, regionId, ...(source ? { source } : {}) }),
  });
}

export async function getCoverageGeometry(
  worldViewId: number,
  regionId: number,
): Promise<CoverageGeometryResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage-geometry/${regionId}`);
}

export async function analyzeCoverageGaps(
  worldViewId: number,
  regionId: number,
): Promise<CoverageGapAnalysisResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage-gap-analysis/${regionId}`, {
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
