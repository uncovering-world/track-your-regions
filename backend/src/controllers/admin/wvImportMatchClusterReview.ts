/**
 * Cluster review loop — interactive phase between cluster cleaning and ICP.
 *
 * Presents cluster info + preview images to the UI, then applies the user's
 * merge/split/exclude decisions (or manual-paint overrides). Can request a
 * recluster with different kmeans settings (returned as ReclusterSignal).
 * What it computes over the pixel labels is
 * `services/worldViewImport/colorMatch/cluster/clusterComponents.ts`.
 */

import {
  registerClusterReview,
  storeClusterPreviewImage,
  storeClusterHighlights,
  type ClusterReviewDecision,
} from './wvImportMatchReview.js';
import type { ReclusterPreset, SendEvent } from '../../services/worldViewImport/colorMatch/context.js';
import type { BorderPath } from '../../services/worldViewImport/colorMatch/geometry/borderTrace.js';
import {
  applyExcludeDecisions,
  applyMergeDecisions,
  applySplitDecisions,
  buildClusterInfos,
  renderClusterHighlightPng,
  renderClusterPreviewPng,
  type ClusterInfo,
  type GridDims,
} from '../../services/worldViewImport/colorMatch/cluster/clusterComponents.js';

export interface ReclusterSignal {
  recluster: true;
  preset: ReclusterPreset;
}

interface PrepareReviewImagesParams {
  reviewId: string;
  clusterInfos: ClusterInfo[];
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number] | null>;
  dims: GridDims;
  origW: number;
  origH: number;
}

/** Generate & store all images used by the cluster review UI (preview + per-cluster highlights) */
async function prepareClusterReviewImages(p: PrepareReviewImagesParams): Promise<void> {
  const previewPng = await renderClusterPreviewPng(p.pixelLabels, p.colorCentroids, p.dims, p.origW, p.origH);
  storeClusterPreviewImage(p.reviewId, `data:image/png;base64,${previewPng.toString('base64')}`);

  const highlights: Array<{ label: number; png: Buffer }> = [];
  for (const ci of p.clusterInfos) {
    const hlPng = await renderClusterHighlightPng(p.pixelLabels, ci.label, p.dims, p.origW, p.origH);
    highlights.push({ label: ci.label, png: hlPng });
  }
  storeClusterHighlights(p.reviewId, highlights);
}

export interface ClusterReviewIterationParams {
  regionId: number;
  finalLabels: Set<number>;
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number] | null>;
  countrySize: number;
  borderPaths: BorderPath[];
  dims: GridDims;
  origW: number;
  origH: number;
  pxS: (base: number) => number;
  sendEvent: SendEvent;
  logStep: (msg: string) => Promise<void>;
}

type ReviewIterationOutcome =
  | { kind: 'recluster'; signal: ReclusterSignal }
  | { kind: 'loop' } // need to re-review (after split)
  | { kind: 'done' }; // review complete

/** Dispatch one review decision: recluster / split (loop) / apply excludes + merges */
async function handleReviewDecision(
  decision: ClusterReviewDecision,
  p: ClusterReviewIterationParams,
): Promise<ReviewIterationOutcome> {
  const clusterDecision = decision;

  if (clusterDecision.recluster) {
    console.log(`  [Cluster Review] Recluster requested: ${clusterDecision.recluster.preset}`);
    return { kind: 'recluster', signal: { recluster: true, preset: clusterDecision.recluster.preset } };
  }

  // Apply split — if any clusters were split, loop back to review (don't apply other ops)
  const splitLabels = (clusterDecision.split ?? []).map(Number).filter((l: number) => p.finalLabels.has(l));
  if (splitLabels.length > 0) {
    await p.logStep(`Splitting ${splitLabels.length} cluster(s) into connected components...`);
    const didSplit = applySplitDecisions(
      splitLabels, p.pixelLabels, p.colorCentroids, p.finalLabels, p.dims, p.pxS,
    );
    if (didSplit) return { kind: 'loop' };
  }

  // Apply excludes
  const excludeLabels = (clusterDecision.excludes ?? []).map(Number).filter((l: number) => p.finalLabels.has(l));
  if (excludeLabels.length > 0) {
    await p.logStep(`Excluding ${excludeLabels.length} cluster(s)...`);
    applyExcludeDecisions(excludeLabels, p.pixelLabels, p.finalLabels, p.dims.tp);
  }

  // Apply merges
  const mergeEntries = Object.entries(clusterDecision.merges).map(([from, to]) => [Number(from), Number(to)] as [number, number]);
  if (mergeEntries.length > 0) {
    await p.logStep(`Applying ${mergeEntries.length} cluster merge(s)...`);
    applyMergeDecisions(mergeEntries, p.pixelLabels, p.finalLabels, p.dims.tp);
  }

  return { kind: 'done' };
}

/**
 * Run the cluster review loop to completion.
 * Loops until user confirms (done) or requests recluster.
 * Returns a ReclusterSignal if the user wants to restart with different settings.
 */
export async function runClusterReviewLoop(p: ClusterReviewIterationParams): Promise<ReclusterSignal | null> {
  let reviewing = true;
  while (reviewing) {
    const outcome = await runClusterReviewIteration(p);
    if (outcome.kind === 'recluster') return outcome.signal;
    if (outcome.kind === 'done') reviewing = false;
    // 'loop' → iterate again
  }
  return null;
}

/** Run one iteration of the cluster review loop */
async function runClusterReviewIteration(p: ClusterReviewIterationParams): Promise<ReviewIterationOutcome> {
  const clusterInfos = buildClusterInfos(
    p.finalLabels, p.pixelLabels, p.colorCentroids, p.countrySize, p.dims, p.pxS,
  );

  const reviewId = `cr-${p.regionId}-${Date.now()}`;
  await prepareClusterReviewImages({
    reviewId,
    clusterInfos,
    pixelLabels: p.pixelLabels,
    colorCentroids: p.colorCentroids,
    dims: p.dims,
    origW: p.origW,
    origH: p.origH,
  });

  p.sendEvent({
    type: 'cluster_review',
    reviewId,
    data: {
      clusters: clusterInfos.map(c => ({
        label: c.label,
        color: `rgb(${c.color[0]},${c.color[1]},${c.color[2]})`,
        pct: c.pct,
        isSmall: c.pct < 3,
        componentCount: c.componentCount,
      })),
      borderPaths: p.borderPaths,
      pipelineSize: { w: p.dims.TW, h: p.dims.TH },
    },
  });
  await new Promise(resolve => setImmediate(resolve));

  const decision = await new Promise<ClusterReviewDecision>((resolve) => {
    registerClusterReview(reviewId, resolve as Parameters<typeof registerClusterReview>[1]);
  });

  return handleReviewDecision(decision, p);
}
