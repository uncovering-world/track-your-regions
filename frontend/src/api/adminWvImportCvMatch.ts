/**
 * Admin WorldView Import — CV Match Pipeline
 *
 * Color matching, water/park/cluster review, guided match,
 * vision match, mapshape match.
 */

import type { SpatialAnomaly } from './adminWvImportTreeOps';
import { authFetchJson, ensureFreshToken, getAccessToken } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Color Match Types
// =============================================================================

/** Cluster info for interactive map preview */
export interface ClusterGeoInfo {
  clusterId: number;
  color: string;
  regionId: number | null;
  regionName: string | null;
}

export interface ColorMatchCluster {
  clusterId: number;
  color: string;
  pixelShare: number;
  suggestedRegion: { id: number; name: string } | null;
  divisions: Array<{ id: number; name: string; confidence: number; depth: number; parentDivisionId?: number }>;
  unsplittable: Array<{ id: number; name: string; confidence: number; splitClusters: Array<{ clusterId: number; share: number }> }>;
}

export interface AdjacencyEdge {
  divA: number;
  divB: number;
}

export interface DebugImage {
  label: string;
  dataUrl: string;
}

export interface ColorMatchResult {
  clusters: ColorMatchCluster[];
  childRegions?: Array<{ id: number; name: string }>;
  /** Divisions whose centroids fall outside the source map coverage */
  outOfBounds?: Array<{ id: number; name: string }>;
  debugImages?: DebugImage[];
  /** Interactive map preview -- GeoJSON FeatureCollection with cluster assignment properties */
  geoPreview?: {
    featureCollection: GeoJSON.FeatureCollection;
    clusterInfos: ClusterGeoInfo[];
  };
  stats?: {
    totalDivisions: number;
    assignedDivisions: number;
    cvClusters?: number;
    cvAssignedDivisions?: number;
    cvUnsplittable?: number;
    cvOutOfBounds?: number;
    countryName?: string;
  };
  spatialAnomalies?: SpatialAnomaly[];
  adjacencyEdges?: AdjacencyEdge[];
}

// =============================================================================
// Water Review Types
// =============================================================================

export interface WaterSubCluster {
  idx: number;
  pct: number;
  cropDataUrl: string;
}

export interface WaterComponent {
  id: number;
  pct: number;
  cropDataUrl: string;
  subClusters: WaterSubCluster[];
}

export interface WaterReviewDecision {
  approvedIds: number[];
  mixDecisions: Array<{ componentId: number; approvedSubClusters: number[] }>;
}

// =============================================================================
// Cluster Review Types
// =============================================================================

export interface ClusterReviewCluster {
  label: number;
  color: string;
  pct: number;
  isSmall: boolean;
  componentCount: number;
}

export interface ClusterReviewDecision {
  merges: Record<number, number>;
  excludes?: number[];
  recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy' };
  split?: number[];
}

// =============================================================================
// Park Review Types
// =============================================================================

export interface ParkComponent {
  id: number;
  pct: number;
}

export interface ParkReviewDecision {
  confirmedIds: number[];
}

// =============================================================================
// SSE Event
// =============================================================================

export interface ColorMatchSSEEvent {
  type: 'progress' | 'debug_image' | 'complete' | 'error' | 'water_review' | 'park_review' | 'cluster_review' | 'icp_adjustment_available';
  step?: string;
  elapsed?: number;
  debugImage?: DebugImage;
  data?: ColorMatchResult & {
    parkCount?: number; totalParkPct?: number; components?: ParkComponent[];
    clusters?: ClusterReviewCluster[];
  };
  message?: string;
  reviewId?: string;
  waterMaskImage?: string;
  waterPxPercent?: number;
  waterComponents?: WaterComponent[];
  metrics?: { overflow: number; error: number; icpOption: string };
}

// =============================================================================
// Vision Match
// =============================================================================

export interface VisionMatchResult {
  suggestedIds: number[];
  rejectedIds: number[];
  unclearIds: number[];
  reasoning: string;
  cost: number;
  debugImages?: {
    regionMap: string;
    divisionsMap: string;
  };
}

export async function visionMatchDivisions(
  worldViewId: number,
  divisionIds: number[],
  regionId: number,
  imageUrl: string,
): Promise<VisionMatchResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/vision-match`, {
    method: 'POST',
    body: JSON.stringify({ divisionIds, regionId, imageUrl }),
  });
}

// =============================================================================
// Mapshape Match
// =============================================================================

export interface MapshapeMatchResult {
  found: boolean;
  message?: string;
  mapshapes?: Array<{
    title: string;
    color: string;
    wikidataIds: string[];
    matchedRegion: { id: number; name: string } | null;
    divisions: Array<{ id: number; name: string; coverage: number }>;
  }>;
  childRegions?: Array<{ id: number; name: string }>;
  geoPreview?: {
    featureCollection: GeoJSON.FeatureCollection;
    clusterInfos: ClusterGeoInfo[];
  };
  /** Wikivoyage mapshape geoshape boundaries for side-by-side comparison */
  wikivoyagePreview?: GeoJSON.FeatureCollection;
  stats?: {
    totalMapshapes: number;
    matchedMapshapes: number;
    totalDivisions: number;
  };
}

export async function mapshapeMatch(
  worldViewId: number,
  regionId: number,
): Promise<MapshapeMatchResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/mapshape-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

// =============================================================================
// Cluster / Water / Park Preview URLs & Review Responses
// =============================================================================

/** URL for cluster preview image (served from backend memory, like water/park crops) */
export function clusterPreviewUrl(reviewId: string): string {
  const token = getAccessToken();
  const base = `${API_URL}/api/admin/wv-import/cluster-preview/${reviewId}`;
  return token ? `${base}?token=${token}` : base;
}

export function clusterHighlightUrl(reviewId: string, label: number): string {
  const token = getAccessToken();
  const base = `${API_URL}/api/admin/wv-import/cluster-highlight/${reviewId}/${label}`;
  return token ? `${base}?token=${token}` : base;
}

/** Respond to cluster review during CV match */
export async function respondToClusterReview(reviewId: string, decision: ClusterReviewDecision): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/cluster-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

/** Build URL for a water crop image served by the backend (includes JWT for auth) */
export function waterCropUrl(reviewId: string, componentId: number, subCluster: number): string {
  const token = getAccessToken();
  const base = `${API_URL}/api/admin/wv-import/water-crop/${reviewId}/${componentId}/${subCluster}`;
  return token ? `${base}?token=${token}` : base;
}

/** Build URL for a park crop image served by the backend */
export function parkCropUrl(reviewId: string, componentId: number): string {
  const token = getAccessToken();
  const base = `${API_URL}/api/admin/wv-import/park-crop/${reviewId}/${componentId}`;
  return token ? `${base}?token=${token}` : base;
}

/** Respond to park review during CV match */
export async function respondToParkReview(reviewId: string, decision: ParkReviewDecision): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/park-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

/** Respond to a per-component water review during CV match */
export async function respondToWaterReview(reviewId: string, decision: WaterReviewDecision): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/water-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

export interface IcpAdjustmentDecision {
  action: 'adjust' | 'continue';
}

/** Respond to ICP adjustment suggestion during CV match */
export async function respondToIcpAdjustment(reviewId: string, decision: IcpAdjustmentDecision): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/icp-adjustment/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

// =============================================================================
// Color Match with SSE Progress
// =============================================================================

/**
 * CV color match with SSE streaming for progress updates.
 * Sends progress events, debug images as they're generated, and final result.
 */
export function colorMatchWithProgress(
  worldViewId: number,
  regionId: number,
  onEvent: (event: ColorMatchSSEEvent) => void,
  signal?: AbortSignal,
): Promise<ColorMatchResult> {
  return new Promise((resolve, reject) => {
    ensureFreshToken().then(token => {
      const params = new URLSearchParams({ regionId: String(regionId) });
      if (token) params.append('token', token);
      const url = `${API_URL}/api/admin/wv-import/matches/${worldViewId}/color-match-stream?${params}`;

      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const eventSource = new EventSource(url);

      const onAbort = () => {
        eventSource.close();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ColorMatchSSEEvent;
          onEvent(data);

          if (data.type === 'complete' || data.type === 'error') {
            signal?.removeEventListener('abort', onAbort);
            eventSource.close();
            if (data.type === 'error') {
              reject(new Error(data.message || 'CV match failed'));
            } else {
              resolve(data.data!);
            }
          }
        } catch (e) {
          console.error('Failed to parse CV match SSE event:', e);
        }
      };

      eventSource.onerror = () => {
        signal?.removeEventListener('abort', onAbort);
        eventSource.close();
        reject(new Error('Connection to server lost'));
      };
    }).catch(reject);
  });
}

// =============================================================================
// Guided CV Match (seed-based)
// =============================================================================

export interface GuidedMatchPoint { x: number; y: number }
export interface GuidedMatchRegionSeed extends GuidedMatchPoint { regionId: number }
export interface GuidedMatchSeeds {
  waterPoints: GuidedMatchPoint[];
  parkPoints: GuidedMatchPoint[];
  regionSeeds: GuidedMatchRegionSeed[];
}

export async function prepareGuidedMatch(
  worldViewId: number,
  regionId: number,
  seeds: GuidedMatchSeeds,
): Promise<string> {
  const result = await authFetchJson<{ sessionId: string }>(
    `${API_URL}/api/admin/wv-import/matches/${worldViewId}/guided-match-prepare`,
    { method: 'POST', body: JSON.stringify({ regionId, seeds }) },
  );
  return result.sessionId;
}

export function guidedMatchWithProgress(
  worldViewId: number,
  sessionId: string,
  onEvent: (event: ColorMatchSSEEvent) => void,
): Promise<ColorMatchResult> {
  return new Promise((resolve, reject) => {
    ensureFreshToken().then(token => {
      const params = new URLSearchParams({ sessionId });
      if (token) params.append('token', token);
      const url = `${API_URL}/api/admin/wv-import/matches/${worldViewId}/guided-match-stream?${params}`;

      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ColorMatchSSEEvent;
          onEvent(data);

          if (data.type === 'complete' || data.type === 'error') {
            eventSource.close();
            if (data.type === 'error') {
              reject(new Error(data.message || 'Guided match failed'));
            } else {
              resolve(data.data!);
            }
          }
        } catch (e) {
          console.error('Failed to parse guided match SSE event:', e);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        reject(new Error('Connection to server lost'));
      };
    }).catch(reject);
  });
}
