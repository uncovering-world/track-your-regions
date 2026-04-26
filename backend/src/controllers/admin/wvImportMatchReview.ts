/**
 * WorldView Import Match — Review State
 *
 * In-memory review state and decision handling for the CV pipeline.
 * Manages pending review callbacks and crop image storage for water
 * and cluster review phases.
 *
 * This is a leaf dependency — it must NEVER import from phase modules
 * or the controller.
 */

// =============================================================================
// Water review
// =============================================================================

/** Water review decision: approved components + mix (sub-clustered) components */
export interface WaterReviewDecision {
  approvedIds: number[];
  mixDecisions: Array<{ componentId: number; approvedSubClusters: number[] }>;
}

/** Pending water review callbacks — SSE handler pauses here, POST handler resolves */
const pendingWaterReviews = new Map<string, (decision: WaterReviewDecision) => void>();

/** Water crop image storage — crops served via GET endpoint (avoids SSE bloat)
 *  Key: "reviewId/componentId/subCluster" → base64 data URL */
const waterCropImages = new Map<string, string>();

/** Register a pending water review callback (called from pipeline module that awaits the SSE review decision) */
export function registerWaterReview(reviewId: string, resolver: (decision: WaterReviewDecision) => void): void {
  pendingWaterReviews.set(reviewId, resolver);
}

/** Resolve a pending water review (called from POST endpoint) */
export function resolveWaterReview(reviewId: string, decision: WaterReviewDecision): boolean {
  const resolve = pendingWaterReviews.get(reviewId);
  if (!resolve) return false;
  pendingWaterReviews.delete(reviewId);
  resolve(decision);
  return true;
}

/** Get a stored water crop image (called from GET endpoint) */
export function getWaterCropImage(reviewId: string, componentId: number, subCluster: number): string | undefined {
  return waterCropImages.get(`${reviewId}/${componentId}/${subCluster}`);
}

/** Store water crop images for a review session */
export function storeWaterCrops(reviewId: string, components: Array<{ id: number; cropDataUrl: string; subClusters: Array<{ idx: number; cropDataUrl: string }> }>) {
  for (const wc of components) {
    waterCropImages.set(`${reviewId}/${wc.id}/-1`, wc.cropDataUrl);
    for (const sc of wc.subClusters) {
      waterCropImages.set(`${reviewId}/${wc.id}/${sc.idx}`, sc.cropDataUrl);
    }
  }
  // Auto-cleanup after 10 minutes
  setTimeout(() => {
    for (const key of [...waterCropImages.keys()]) {
      if (key.startsWith(`${reviewId}/`)) waterCropImages.delete(key);
    }
  }, 600000);
}

// =============================================================================
// Cluster review
// =============================================================================

/** Cluster review decision — let user merge small artifact clusters into real ones */
export interface ClusterReviewDecision {
  /** Map from small cluster label → target cluster label to merge into */
  merges: Record<number, number>;
  /** Cluster labels to exclude entirely (not a real region — set to background) */
  excludes?: number[];
  /** Request re-clustering with modified parameters */
  recluster?: { preset: 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy' };
  /** Cluster labels to split into their connected components */
  split?: number[];
}

/** Manual cluster decision — user paints clusters manually and submits the result */
export interface ManualClusterDecision {
  type: 'manual_clusters';
  /** Base64 data URL of the painted cluster overlay PNG */
  overlayPng: string;
  /** Palette mapping label numbers to RGB colors */
  palette: Array<{ label: number; color: [number, number, number] }>;
}

/** Union of all possible cluster review responses */
export type ClusterReviewResponse = ClusterReviewDecision | ManualClusterDecision;

/** Pending cluster review callbacks */
const pendingClusterReviews = new Map<string, (decision: ClusterReviewResponse) => void>();

/** Cluster preview images — served via GET endpoint (avoids SSE bloat like water/park crops) */
const clusterPreviewImages = new Map<string, string>();
/** Per-cluster highlight images — key: "{reviewId}:{label}" → PNG buffer */
const clusterHighlightImages = new Map<string, Buffer>();
/** Cluster overlay images — full-image colored overlay for manual paint editor */
const clusterOverlayImages = new Map<string, Buffer>();

/** Register a pending cluster review callback */
export function registerClusterReview(reviewId: string, resolver: (decision: ClusterReviewResponse) => void): void {
  pendingClusterReviews.set(reviewId, resolver);
}

/** Store a cluster preview image (base64 data URL) — auto-cleans up after 10 minutes */
export function storeClusterPreviewImage(reviewId: string, dataUrl: string): void {
  clusterPreviewImages.set(reviewId, dataUrl);
  setTimeout(() => { clusterPreviewImages.delete(reviewId); }, 600000);
}

/** Get a stored cluster preview image (called from GET endpoint) */
export function getClusterPreviewImage(reviewId: string): string | undefined {
  return clusterPreviewImages.get(reviewId);
}

/** Get a stored per-cluster highlight image (called from GET endpoint) */
export function getClusterHighlightImage(reviewId: string, label: number): Buffer | undefined {
  return clusterHighlightImages.get(`${reviewId}:${label}`);
}

/** Store per-cluster highlight images for a review session */
export function storeClusterHighlights(reviewId: string, highlights: Array<{ label: number; png: Buffer }>) {
  for (const h of highlights) {
    clusterHighlightImages.set(`${reviewId}:${h.label}`, h.png);
  }
  setTimeout(() => {
    for (const key of [...clusterHighlightImages.keys()]) {
      if (key.startsWith(`${reviewId}:`)) clusterHighlightImages.delete(key);
    }
  }, 600000);
}

/** Get a stored cluster overlay image (called from GET endpoint) */
export function getClusterOverlayImage(reviewId: string): Buffer | undefined {
  return clusterOverlayImages.get(reviewId);
}

/** Store a cluster overlay PNG for a review session — auto-cleans after 10 minutes */
export function storeClusterOverlay(reviewId: string, png: Buffer): void {
  clusterOverlayImages.set(reviewId, png);
  setTimeout(() => { clusterOverlayImages.delete(reviewId); }, 600000);
}

/** Resolve a pending cluster review (called from POST endpoint) */
export function resolveClusterReview(reviewId: string, decision: ClusterReviewResponse): boolean {
  const resolve = pendingClusterReviews.get(reviewId);
  if (typeof resolve !== 'function') return false;
  pendingClusterReviews.delete(reviewId);
  resolve(decision);
  return true;
}

// =============================================================================
// ICP adjustment review
// =============================================================================

export interface IcpAdjustmentDecision {
  action: 'adjust' | 'continue';
}

/** Pending ICP adjustment callbacks — SSE handler pauses here, POST handler resolves */
const pendingIcpAdjustments = new Map<string, (decision: IcpAdjustmentDecision) => void>();

/** Register a pending ICP adjustment callback */
export function registerIcpAdjustment(reviewId: string, resolver: (decision: IcpAdjustmentDecision) => void): void {
  pendingIcpAdjustments.set(reviewId, resolver);
}

/** Check if a pending ICP adjustment is still registered (used by timeout cleanup in caller) */
export function hasIcpAdjustment(reviewId: string): boolean {
  return pendingIcpAdjustments.has(reviewId);
}

/** Cancel a pending ICP adjustment without resolving (used by timeout cleanup in caller) */
export function cancelIcpAdjustment(reviewId: string): boolean {
  return pendingIcpAdjustments.delete(reviewId);
}

/** Resolve a pending ICP adjustment review (called from POST endpoint) */
export function resolveIcpAdjustment(reviewId: string, decision: IcpAdjustmentDecision): boolean {
  const resolve = pendingIcpAdjustments.get(reviewId);
  if (typeof resolve !== 'function') return false;
  pendingIcpAdjustments.delete(reviewId);
  resolve(decision);
  return true;
}
