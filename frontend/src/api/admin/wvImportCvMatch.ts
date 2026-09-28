/**
 * Admin WorldView Import — CV Match Pipeline
 *
 * CV color match (SSE pipeline), water/cluster review responses, ICP
 * adjustment callback, mapshape match, image URL builders for
 * cluster preview / highlight / overlay / water-crop.
 */

import type {
  ClusterRegionSuggestions, ColorMatchEvent, ColorMatchResult, MapshapeMatchResult,
} from '../client.generated';
import { API_URL, ensureFreshToken } from '../fetchUtils';
import {
  postAdminWvImportClusterReviewByReviewId, postAdminWvImportIcpAdjustmentByReviewId,
  postAdminWvImportMatchesByWorldViewIdAiSuggestClusters, postAdminWvImportMatchesByWorldViewIdMapshapeMatch,
  postAdminWvImportWaterReviewByReviewId,
  type WvImportAiSuggestClustersBodyClustersItem,
  type WvImportClusterReviewAnswerBody,
  type WvImportIcpAdjustmentBody,
  type WvImportWaterReviewBody,
  getAdminWvImportClusterHighlightByReviewIdByLabel,
  getGetAdminWvImportClusterPreviewByReviewIdUrl,
  getGetAdminWvImportMatchesByWorldViewIdColorMatchStreamUrl,
  getGetAdminWvImportWaterCropByReviewIdByComponentIdBySubClusterUrl,
} from '../client.generated';

// What the calls here answer, and every event of the colour-match stream, is
// declared once, as a backend schema (ADR-0066), and generated into
// `client.generated.ts`. Passed on from here, so a component imports a call's
// answer from the module of the call.
export type {
  AdjacencyEdge, BorderPath, ChildRegionRef, ClusterGeoInfo, ClusterRegionMatch, ClusterRegionSuggestions,
  ClusterReviewCluster, ClusterReviewRequested, ColorMatchCluster, ColorMatchComplete, ColorMatchDebugImage,
  ColorMatchEvent, ColorMatchFailed, ColorMatchProgress, ColorMatchResult, CvPreviewFeature, DebugImage,
  IcpAdjustmentOffered, MapshapeDivision, MapshapeGroup, MapshapeMatchResult, MapshapePreviewFeature,
  MapshapesFound, MapshapesNotFound, NamedDivision, ReviewAnswered, WaterComponent, WaterReviewRequested,
  WikivoyageShapeFeature,
} from '../client.generated';


// =============================================================================
// Water Review Types
// =============================================================================

export type WaterReviewDecision = WvImportWaterReviewBody;

// =============================================================================
// Cluster Review Types
// =============================================================================

/** The painted-overlay answer: the admin's canvas-edited clusters, before ICP alignment. */
export type ManualClusterResponse = Extract<WvImportClusterReviewAnswerBody, { type: 'manual_clusters' }>;

/** Normal cluster review decision — merges, excludes, recluster, or split */
export type ClusterReviewDecision = Exclude<WvImportClusterReviewAnswerBody, ManualClusterResponse>;

// =============================================================================
// Mapshape Match
// =============================================================================

export async function mapshapeMatch(
  worldViewId: number,
  regionId: number,
): Promise<MapshapeMatchResult> {
  return postAdminWvImportMatchesByWorldViewIdMapshapeMatch(worldViewId, { regionId });
}

// =============================================================================
// AI Suggest Cluster Regions
// =============================================================================

/** Per-cluster info supplied to the AI for region matching */
export type AISuggestClusterRegionsCluster = WvImportAiSuggestClustersBodyClustersItem;

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
  return postAdminWvImportMatchesByWorldViewIdAiSuggestClusters(worldViewId, { clusters, childRegions, model: modelOverride });
}

// =============================================================================
// Cluster / Water Preview URLs & Review Responses
// =============================================================================

// The preview and water-crop URLs are read by `AuthImage`, which fetches them
// through `apiFetch` with the session's token in its header and refreshes it on
// a 401. So they carry no `?token=`: a token in a URL would outlast a refresh,
// since `requireAuth` prefers it, and would land in access logs.

/** URL for cluster preview image served from backend memory */
export function clusterPreviewUrl(reviewId: string): string {
  return API_URL + getGetAdminWvImportClusterPreviewByReviewIdUrl(reviewId);
}

/** The per-cluster highlight image (red-outline overlay for the selected cluster), read with the session's token. */
export async function fetchClusterHighlight(reviewId: string, label: number): Promise<Blob> {
  return getAdminWvImportClusterHighlightByReviewIdByLabel(reviewId, label);
}

/** Respond to cluster review during CV match */
export async function respondToClusterReview(
  reviewId: string,
  decision: ClusterReviewDecision,
): Promise<void> {
  await postAdminWvImportClusterReviewByReviewId(reviewId, decision);
}

/** URL for water crop image during water review (served from backend memory) */
export function waterCropUrl(reviewId: string, componentId: number, subCluster: number): string {
  return API_URL + getGetAdminWvImportWaterCropByReviewIdByComponentIdBySubClusterUrl(reviewId, componentId, subCluster);
}

/** Respond to a per-component water review during CV match */
export async function respondToWaterReview(reviewId: string, decision: WaterReviewDecision): Promise<void> {
  await postAdminWvImportWaterReviewByReviewId(reviewId, decision);
}

// =============================================================================
// ICP Adaptive Alignment (ADR-0011)
// =============================================================================

export type IcpAdjustmentDecision = WvImportIcpAdjustmentBody;

/**
 * Respond to an ICP adjustment suggestion during CV match.
 * Called when the user clicks "Adjust alignment" or "Continue anyway".
 * POST /api/admin/wv-import/icp-adjustment/:reviewId
 */
export async function respondToIcpAdjustment(
  reviewId: string,
  decision: IcpAdjustmentDecision,
): Promise<void> {
  await postAdminWvImportIcpAdjustmentByReviewId(reviewId, decision);
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
      // EventSource sends no headers, so the token rides in the query, on the
      // path the generated builder gives (ADR-0073 decision 5).
      const url = API_URL + getGetAdminWvImportMatchesByWorldViewIdColorMatchStreamUrl(
        worldViewId, { regionId, token: token ?? undefined },
      );

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
