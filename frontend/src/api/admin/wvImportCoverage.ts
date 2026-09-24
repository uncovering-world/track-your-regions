/**
 * Admin WorldView Import — Coverage Analysis
 *
 * GADM coverage gap detection (sync + SSE streaming progress), geo-suggest,
 * dismiss / approve / undismiss gaps, finalize review, children region geometry.
 */

import type {
  ChildRegionGeometries, ChildrenCoverage, CoverageApproved, CoverageEvent, CoverageGapAnalysis, CoverageGeometry,
  CoverageResult, GapDismissed, GapUndismissed, GeoSuggestResult, ReviewFinalized, SplitDeeperResult,
  UnionGeometryResult, VisionMatchResult,
} from '@tyr/shared/api';
import { authFetchJson, ensureFreshToken } from '../fetchUtils';

// What the calls here answer, and every event of the coverage stream, is
// declared once, as a backend schema (ADR-0066), and generated into
// `@tyr/shared/api`. Passed on from here, so a component imports a call's answer
// from the module of the call.
export type {
  ChildRegionGeometries, ChildrenCoverage, CoverageApproved, CoverageComplete, CoverageEvent, CoverageFailed,
  CoverageGap, CoverageGapAnalysis, CoverageGapDivision, CoverageGeometry, CoverageProgress, CoverageResult,
  CoverageSuggestion, DismissedGap, DivisionPreview, DivisionShapeFeature, GapDismissed, GapSubtreeNode,
  GapUndismissed, GeoSuggestResult, MarkerPointFeature, RegionContextNode, ReviewFinalized, SiblingRegionGeometry,
  SplitDeeperResult, UnionGeometryResult, VisionMatchResult,
} from '@tyr/shared/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Coverage Types
// =============================================================================

// =============================================================================
// Coverage API Functions
// =============================================================================

export async function getCoverage(worldViewId: number): Promise<CoverageResult> {
  return authFetchJson<CoverageResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage`);
}

/**
 * Check GADM coverage with SSE streaming for progress updates.
 * Mirrors computeRegionGeometryWithProgress from geometry.ts.
 */
export function getCoverageWithProgress(
  worldViewId: number,
  onProgress: (event: CoverageEvent) => void,
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
          const data = JSON.parse(event.data) as CoverageEvent;
          onProgress(data);

          if (data.type === 'complete' || data.type === 'error') {
            eventSource.close();
            if (data.type === 'error') {
              reject(new Error(data.message || 'Coverage check failed'));
            } else {
              resolve(data.data);
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
  return authFetchJson<GeoSuggestResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/geo-suggest-gap`, {
    method: 'POST',
    body: JSON.stringify({ divisionId }),
  });
}

export async function dismissCoverageGap(
  worldViewId: number,
  divisionId: number,
): Promise<GapDismissed> {
  return authFetchJson<GapDismissed>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/dismiss-gap`, {
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
): Promise<CoverageApproved> {
  return authFetchJson<CoverageApproved>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/approve-coverage`, {
    method: 'POST',
    body: JSON.stringify({ divisionId, regionId, action, gapName }),
  });
}

export async function undismissCoverageGap(
  worldViewId: number,
  divisionId: number,
): Promise<GapUndismissed> {
  return authFetchJson<GapUndismissed>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/undismiss-gap`, {
    method: 'POST',
    body: JSON.stringify({ divisionId }),
  });
}

export async function finalizeReview(
  worldViewId: number,
): Promise<ReviewFinalized> {
  return authFetchJson<ReviewFinalized>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/finalize`, {
    method: 'POST',
  });
}

/** Get per-child region geometries for drill-down on the gap context map */
export async function getChildrenRegionGeometry(
  worldViewId: number,
  regionId: number,
): Promise<ChildRegionGeometries> {
  return authFetchJson<ChildRegionGeometries>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/children-geometry/${regionId}`);
}

// =============================================================================
// Children Coverage (per-region container coverage %)
// =============================================================================

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
): Promise<ChildrenCoverage> {
  const params = new URLSearchParams();
  if (regionId != null) params.set('regionId', String(regionId));
  if (ancestorId != null) params.set('onlyId', String(ancestorId));
  const query = params.toString();
  const url = `${API_URL}/api/admin/wv-import/matches/${worldViewId}/children-coverage${query ? '?' + query : ''}`;
  return authFetchJson<ChildrenCoverage>(url);
}

// =============================================================================
// Coverage Geometry / Gap Analysis
// =============================================================================

export async function getCoverageGeometry(
  worldViewId: number,
  regionId: number,
): Promise<CoverageGeometry> {
  return authFetchJson<CoverageGeometry>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage-geometry/${regionId}`);
}

export async function analyzeCoverageGaps(
  worldViewId: number,
  regionId: number,
): Promise<CoverageGapAnalysis> {
  return authFetchJson<CoverageGapAnalysis>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/coverage-gap-analysis/${regionId}`, {
    method: 'POST',
  });
}

// =============================================================================
// Geometry preview (union / split / vision-match)
// =============================================================================

export async function getUnionGeometry(
  worldViewId: number,
  divisionIds: number[],
  regionId?: number,
): Promise<UnionGeometryResult> {
  return authFetchJson<UnionGeometryResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/union-geometry`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, regionId }),
  });
}

export async function splitDivisionsDeeper(
  worldViewId: number,
  divisionIds: number[],
  wikidataId: string,
  regionId: number,
  source?: 'geoshape' | 'points' | 'image',
): Promise<SplitDeeperResult> {
  return authFetchJson<SplitDeeperResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/split-deeper`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, wikidataId, regionId, source }),
  });
}

export async function visionMatchDivisions(
  worldViewId: number,
  divisionIds: number[],
  regionId: number,
  regionMapUrl: string,
): Promise<VisionMatchResult> {
  return authFetchJson<VisionMatchResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/vision-match`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, regionId, imageUrl: regionMapUrl }),
  });
}
