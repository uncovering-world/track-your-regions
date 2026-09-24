/**
 * Admin WorldView Import — CV Match Pipeline
 *
 * CV color match (SSE pipeline), water/cluster review responses, ICP
 * adjustment callback, mapshape match, image URL builders for
 * cluster preview / highlight / overlay / water-crop.
 */

import type {
  ClusterRegionSuggestions, ColorMatchEvent, ColorMatchResult, MapshapeMatchResult, ReviewAnswered,
} from '@tyr/shared/api';
import { authFetchJson, ensureFreshToken, getAccessToken } from '../fetchUtils';

// What the calls here answer, and every event of the colour-match stream, is
// declared once, as a backend schema (ADR-0066), and generated into
// `@tyr/shared/api`. Passed on from here, so a component imports a call's
// answer from the module of the call.
export type {
  AdjacencyEdge, BorderPath, ChildRegionRef, ClusterGeoInfo, ClusterRegionMatch, ClusterRegionSuggestions,
  ClusterReviewCluster, ClusterReviewRequested, ColorMatchCluster, ColorMatchComplete, ColorMatchDebugImage,
  ColorMatchEvent, ColorMatchFailed, ColorMatchProgress, ColorMatchResult, CvPreviewFeature, DebugImage,
  IcpAdjustmentOffered, MapshapeDivision, MapshapeGroup, MapshapeMatchResult, MapshapePreviewFeature,
  MapshapesFound, MapshapesNotFound, NamedDivision, ReviewAnswered, WaterComponent, WaterReviewRequested,
  WikivoyageShapeFeature,
} from '@tyr/shared/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Water Review Types
// =============================================================================

export interface WaterReviewDecision {
  approvedIds: number[];
  mixDecisions: Array<{ componentId: number; approvedSubClusters: number[] }>;
}

// =============================================================================
// Cluster Review Types
// =============================================================================

/** Normal cluster review decision — merges, excludes, recluster, or split */
export interface ClusterReviewDecision {
  merges: Record<number, number>;
  excludes?: number[];
  recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy' };
  split?: number[];
}

export interface ManualClusterResponse {
  type: 'manual_clusters';
  overlayPng: string;
  palette: Array<{ label: number; color: [number, number, number] }>;
}

// =============================================================================
// Mapshape Match
// =============================================================================

export async function mapshapeMatch(
  worldViewId: number,
  regionId: number,
): Promise<MapshapeMatchResult> {
  return authFetchJson<MapshapeMatchResult>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/mapshape-match`, {
    method: 'POST',
    body: JSON.stringify({ regionId }),
  });
}

// =============================================================================
// AI Suggest Cluster Regions
// =============================================================================

/** Per-cluster info supplied to the AI for region matching */
export interface AISuggestClusterRegionsCluster {
  clusterId: number;
  color: string;
  pixelShare: number;
  /** Flattened list of GADM division names already associated with the cluster */
  divisionNames: string[];
}

/**
 * Ask the AI to assign each CV cluster to one of the given child regions
 * (or to none). Used by the geo-preview section after a CV color match.
 */
export async function aiSuggestClusterRegions(
  worldViewId: number,
  clusters: AISuggestClusterRegionsCluster[],
  childRegions: Array<{ id: number; name: string }>,
  modelOverride?: string,
): Promise<ClusterRegionSuggestions> {
  return authFetchJson<ClusterRegionSuggestions>(`${API_URL}/api/admin/wv-import/matches/${worldViewId}/ai-suggest-clusters`, {
    method: 'POST',
    body: JSON.stringify({ clusters, childRegions, model: modelOverride }),
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

/** Respond to cluster review during CV match */
export async function respondToClusterReview(
  reviewId: string,
  decision: ClusterReviewDecision,
): Promise<void> {
  await authFetchJson<ReviewAnswered>(`${API_URL}/api/admin/wv-import/cluster-review/${reviewId}`, {
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
  await authFetchJson<ReviewAnswered>(`${API_URL}/api/admin/wv-import/water-review/${reviewId}`, {
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
  await authFetchJson<ReviewAnswered>(`${API_URL}/api/admin/wv-import/icp-adjustment/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
}

// =============================================================================
// Color Match SSE Streaming
// =============================================================================

/**
 * Stream CV color match progress via SSE.
 * Calls onEvent for each event; resolves when complete, rejects on error.
 */
export function colorMatchWithProgress(
  worldViewId: number,
  regionId: number,
  onEvent: (event: ColorMatchEvent) => void,
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
          const data = JSON.parse(event.data) as ColorMatchEvent;
          onEvent(data);

          if (data.type === 'complete' || data.type === 'error') {
            signal?.removeEventListener('abort', onAbort);
            eventSource.close();
            if (data.type === 'error') {
              reject(new Error(data.message || 'CV match failed'));
            } else {
              resolve(data.data);
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
