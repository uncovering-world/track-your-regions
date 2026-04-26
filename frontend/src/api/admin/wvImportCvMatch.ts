/**
 * Admin WorldView Import — CV Match Pipeline
 *
 * CV color match (SSE pipeline), water/cluster review responses, ICP
 * adjustment callback, mapshape match, image URL builders for
 * cluster preview / highlight / overlay / water-crop.
 */

import type { SpatialAnomaly } from './wvImportTreeOps';
import { authFetchJson, ensureFreshToken, getAccessToken } from '../fetchUtils';

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

/**
 * A single vector border path extracted from the cluster label map via
 * OpenCV findContours. Transferred to the frontend as part of the cluster
 * review SSE event so the paint editor can render an SVG overlay.
 */
export interface BorderPath {
  id: string;
  points: Array<[number, number]>;
  type: 'internal' | 'external';
  clusters: [number, number];
}

/** Cluster info for interactive cluster review (used by CvClusterReviewSection) */
export interface ClusterReviewCluster {
  label: number;
  color: string;
  pct: number;
  isSmall: boolean;
  componentCount: number;
}

/** Normal cluster review decision — merges, excludes, recluster, or split */
export interface ClusterReviewDecision {
  merges: Record<number, number>;
  excludes?: number[];
  recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy' };
  split?: number[];
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
// Cluster / Water Preview URLs & Review Responses
// =============================================================================

// These URLs are used as `<img src>` (and also passed to `new Image().src` in the
// canvas editor), where browsers will not attach the `Authorization` header.
// `requireAuth` accepts `?token=` as a fallback for exactly this case.
function withTokenQuery(path: string): string {
  const token = getAccessToken();
  return token ? `${path}?token=${token}` : path;
}

/** URL for cluster preview image served from backend memory */
export function clusterPreviewUrl(reviewId: string): string {
  return withTokenQuery(`${API_URL}/api/admin/wv-import/cluster-preview/${reviewId}`);
}

/** URL for per-cluster highlight image (red-outline overlay for selected cluster) */
export function clusterHighlightUrl(reviewId: string, label: number): string {
  return withTokenQuery(`${API_URL}/api/admin/wv-import/cluster-highlight/${reviewId}/${label}`);
}

/** URL for cluster overlay image (RGBA, all clusters in their colors on transparent bg) */
export function clusterOverlayUrl(reviewId: string): string {
  return withTokenQuery(`${API_URL}/api/admin/wv-import/cluster-overlay/${reviewId}`);
}

/** Respond to cluster review during CV match */
export async function respondToClusterReview(
  reviewId: string,
  decision: ClusterReviewDecision,
): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/cluster-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

/** URL for water crop image during water review (served from backend memory) */
export function waterCropUrl(reviewId: string, componentId: number, subCluster: number): string {
  return withTokenQuery(`${API_URL}/api/admin/wv-import/water-crop/${reviewId}/${componentId}/${subCluster}`);
}

/** Respond to a per-component water review during CV match */
export async function respondToWaterReview(reviewId: string, decision: WaterReviewDecision): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/water-review/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

// =============================================================================
// ICP Adaptive Alignment (ADR-0011)
// =============================================================================

export interface IcpAdjustmentDecision {
  action: 'adjust' | 'continue';
}

/**
 * Respond to an ICP adjustment suggestion during CV match.
 * Called when the user clicks "Adjust alignment" or "Continue anyway".
 * POST /api/admin/wv-import/icp-adjustment/:reviewId
 */
export async function respondToIcpAdjustment(
  reviewId: string,
  decision: IcpAdjustmentDecision,
): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/wv-import/icp-adjustment/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

// =============================================================================
// Color Match SSE Streaming
// =============================================================================

export interface ColorMatchSSEEvent {
  type: 'progress' | 'debug_image' | 'complete' | 'error' | 'water_review' | 'cluster_review' | 'icp_adjustment_available';
  step?: string;
  elapsed?: number;
  debugImage?: DebugImage;
  data?: ColorMatchResult & {
    clusters?: ClusterReviewCluster[];
    borderPaths?: BorderPath[];
    pipelineSize?: { w: number; h: number };
  };
  message?: string;
  reviewId?: string;
  waterMaskImage?: string;
  waterPxPercent?: number;
  waterComponents?: WaterComponent[];
  metrics?: { overflow: number; error: number; icpOption: string };
}

/**
 * Stream CV color match progress via SSE.
 * Calls onEvent for each event; resolves when complete, rejects on error.
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
            } else if (data.data) {
              resolve(data.data);
            } else {
              reject(new Error('CV match completed without a result payload'));
            }
          }
        } catch (e) {
          console.error('Failed to parse CV match SSE event:', e);
          signal?.removeEventListener('abort', onAbort);
          eventSource.close();
          reject(new Error('Invalid CV match SSE payload'));
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
