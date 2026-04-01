/**
 * WorldView Import Match — Review State
 *
 * In-memory review state and decision handling for the CV pipeline.
 * Manages pending review callbacks and crop image storage for water,
 * park, and cluster review phases.
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
export const pendingWaterReviews = new Map<string, (decision: WaterReviewDecision) => void>();

/** Water crop image storage — crops served via GET endpoint (avoids SSE bloat)
 *  Key: "reviewId/componentId/subCluster" → base64 data URL */
const waterCropImages = new Map<string, string>();

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
// Park review
// =============================================================================

/** Park review decision — similar to water review but for national park/reserve overlays */
export interface ParkReviewDecision {
  /** Component IDs confirmed as parks (will be inpainted out) */
  confirmedIds: number[];
}

/** Pending park review callbacks */
export const pendingParkReviews = new Map<string, (decision: ParkReviewDecision) => void>();

/** Park crop images — served via same GET endpoint pattern */
const parkCropImages = new Map<string, string>();

export function resolveParkReview(reviewId: string, decision: ParkReviewDecision): boolean {
  const resolve = pendingParkReviews.get(reviewId);
  if (!resolve) return false;
  pendingParkReviews.delete(reviewId);
  resolve(decision);
  return true;
}

/** Get a stored park crop image (called from GET endpoint) */
export function getParkCropImage(reviewId: string, componentId: number): string | undefined {
  return parkCropImages.get(`${reviewId}/${componentId}`);
}

/** Store park crop images for a review session */
export function storeParkCrops(reviewId: string, components: Array<{ id: number; cropDataUrl: string }>) {
  for (const pc of components) {
    parkCropImages.set(`${reviewId}/${pc.id}`, pc.cropDataUrl);
  }
  setTimeout(() => {
    for (const key of [...parkCropImages.keys()]) {
      if (key.startsWith(`${reviewId}/`)) parkCropImages.delete(key);
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
export const pendingClusterReviews = new Map<string, (decision: ClusterReviewResponse) => void>();

/** Cluster preview images — served via GET endpoint (avoids SSE bloat like water/park crops) */
export const clusterPreviewImages = new Map<string, string>();
/** Per-cluster highlight images — key: "{reviewId}:{label}" → PNG buffer */
const clusterHighlightImages = new Map<string, Buffer>();
/** Cluster overlay images — full-image colored overlay for manual paint editor */
const clusterOverlayImages = new Map<string, Buffer>();

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

/** Store a cluster overlay PNG for a review session */
export function storeClusterOverlay(reviewId: string, png: Buffer) {
  clusterOverlayImages.set(reviewId, png);
  setTimeout(() => { clusterOverlayImages.delete(reviewId); }, 600000);
}

/** Resolve a pending cluster review (called from POST endpoint) */
export function resolveClusterReview(reviewId: string, decision: ClusterReviewResponse): boolean {
  const resolve = pendingClusterReviews.get(reviewId);
  if (!resolve) return false;
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
export const pendingIcpAdjustments = new Map<string, (decision: IcpAdjustmentDecision) => void>();

/** Resolve a pending ICP adjustment review (called from POST endpoint) */
export function resolveIcpAdjustment(reviewId: string, decision: IcpAdjustmentDecision): boolean {
  const resolve = pendingIcpAdjustments.get(reviewId);
  if (!resolve) return false;
  pendingIcpAdjustments.delete(reviewId);
  resolve(decision);
  return true;
}
