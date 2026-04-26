/**
 * Cluster review loop — interactive phase between cluster cleaning and ICP.
 *
 * Presents cluster info + preview images to the UI, then applies the user's
 * merge/split/exclude decisions (or manual-paint overrides). Can request a
 * recluster with different kmeans settings (returned as ReclusterSignal).
 */


import sharp from 'sharp';
import {
  registerClusterReview,
  storeClusterPreviewImage,
  storeClusterHighlights,
  type ClusterReviewDecision,
} from './wvImportMatchReview.js';

// =============================================================================
// Shared types
// =============================================================================

export interface GridDims { TW: number; TH: number; tp: number }

export interface ReclusterSignal {
  recluster: true;
  preset: 'more_clusters' | 'different_seed' | 'boost_chroma' | 'remove_roads' | 'fill_holes' | 'clean_light' | 'clean_heavy';
}

// =============================================================================
// Connected-component helpers
// =============================================================================

/** Build binary mask for a cluster label; returns mask and total pixel count */
function buildClusterMask(pixelLabels: Uint8Array, lbl: number, tp: number): { mask: Uint8Array; total: number } {
  const mask = new Uint8Array(tp);
  let total = 0;
  for (let i = 0; i < tp; i++) if (pixelLabels[i] === lbl) { mask[i] = 1; total++; }
  return { mask, total };
}

/** Apply one erosion iteration: keeps a pixel only if all 4-neighbours are set */
function erodeOnce(src: Uint8Array, { TW, TH, tp }: GridDims): Uint8Array {
  const next = new Uint8Array(tp);
  for (let i = 0; i < tp; i++) {
    if (!src[i]) continue;
    const x = i % TW, y = (i - x) / TW;
    if (x > 0 && x < TW - 1 && y > 0 && y < TH - 1 &&
        src[i - 1] && src[i + 1] && src[i - TW] && src[i + TW]) {
      next[i] = 1;
    }
  }
  return next;
}

/** Count set pixels in a mask */
function countMask(mask: Uint8Array, tp: number): number {
  let n = 0;
  for (let i = 0; i < tp; i++) if (mask[i]) n++;
  return n;
}

/** Repeatedly erode `mask`; fall back to original if result is too small */
function erodeWithFallback(mask: Uint8Array, iterations: number, minSize: number, dims: GridDims): Uint8Array {
  let eroded = mask;
  for (let e = 0; e < iterations; e++) eroded = erodeOnce(eroded, dims);
  if (countMask(eroded, dims.tp) < Math.max(20, minSize / 4)) return mask;
  return eroded;
}

/** Push the 4-connected neighbours of `pix` onto `out` (within grid bounds) */
function pushNeighbors(pix: number, out: number[], { TW, TH }: GridDims): void {
  const x = pix % TW, y = (pix - x) / TW;
  if (y > 0) out.push(pix - TW);
  if (y < TH - 1) out.push(pix + TW);
  if (x > 0) out.push(pix - 1);
  if (x < TW - 1) out.push(pix + 1);
}

/** Flood-fill one component from `seed`, tagging `compId` with `id`. Returns pixel count */
function floodFillComponent(seed: number, id: number, compId: Int32Array, mask: Uint8Array, dims: GridDims): number {
  let size = 0;
  const stack = [seed];
  while (stack.length) {
    const pix = stack.pop()!;
    if (compId[pix] || !mask[pix]) continue;
    compId[pix] = id;
    size++;
    pushNeighbors(pix, stack, dims);
  }
  return size;
}

/** CCA: assigns component IDs to all set pixels in `mask`. Returns IDs + sizes */
function labelComponents(mask: Uint8Array, dims: GridDims): { compId: Int32Array; rawComps: { id: number; size: number }[] } {
  const compId = new Int32Array(dims.tp);
  let nextId = 1;
  const rawComps: { id: number; size: number }[] = [];
  for (let seed = 0; seed < dims.tp; seed++) {
    if (!mask[seed] || compId[seed]) continue;
    const size = floodFillComponent(seed, nextId, compId, mask, dims);
    rawComps.push({ id: nextId, size });
    nextId++;
  }
  return { compId, rawComps };
}

/** Check and claim one pixel during BFS expansion */
function tryClaim(pix: number, id: number, compId: Int32Array, mask: Uint8Array, queue: number[]): void {
  if (mask[pix] && !compId[pix]) { compId[pix] = id; queue.push(pix); }
}

/** Expand already-labeled components via BFS to cover all set pixels in `mask` */
function expandComponentsBFS(compId: Int32Array, mask: Uint8Array, { TW, TH, tp }: GridDims): void {
  const queue: number[] = [];
  for (let i = 0; i < tp; i++) if (compId[i]) queue.push(i);
  let head = 0;
  while (head < queue.length) {
    const pix = queue[head++];
    const id = compId[pix];
    const x = pix % TW, y = (pix - x) / TW;
    if (y > 0) tryClaim(pix - TW, id, compId, mask, queue);
    if (y < TH - 1) tryClaim(pix + TW, id, compId, mask, queue);
    if (x > 0) tryClaim(pix - 1, id, compId, mask, queue);
    if (x < TW - 1) tryClaim(pix + 1, id, compId, mask, queue);
  }
}

/** Group pixel indices by component ID (restricted to `mask` pixels) */
function collectComponentPixels(compId: Int32Array, mask: Uint8Array, tp: number): number[][] {
  const result = new Map<number, number[]>();
  for (let i = 0; i < tp; i++) {
    if (!compId[i] || !mask[i]) continue;
    let arr = result.get(compId[i]);
    if (!arr) { arr = []; result.set(compId[i], arr); }
    arr.push(i);
  }
  return Array.from(result.values()).sort((a, b) => b.length - a.length);
}

/** Standard CCA without erosion — used as fallback */
function standardCCA(mask: Uint8Array, dims: GridDims): number[][] {
  const { compId } = labelComponents(mask, dims);
  return collectComponentPixels(compId, mask, dims.tp);
}

/**
 * Find connected components with morphological erosion to break thin bridges.
 * Erodes the cluster mask, finds CCA on the eroded mask, then expands
 * components back to original pixels via BFS (Voronoi-like assignment).
 * Returns pixel index arrays per component, sorted by size descending.
 */
export function findComponentsWithErosion(
  pixelLabels: Uint8Array,
  lbl: number,
  minSize: number,
  dims: GridDims,
  pxS: (base: number) => number,
): number[][] {
  const { mask, total } = buildClusterMask(pixelLabels, lbl, dims.tp);

  const erosionIter = Math.max(1, pxS(1)); // ~2 iterations at 800px
  const useErosion = total > 200 && erosionIter > 0;

  const eroded = useErosion ? erodeWithFallback(mask, erosionIter, minSize, dims) : mask;

  // CCA on (possibly eroded) mask
  const { compId, rawComps } = labelComponents(eroded, dims);

  // Filter out tiny eroded fragments (use relaxed threshold since erosion shrinks)
  const erodedMin = Math.max(5, Math.round(minSize / 8));
  const significant = new Set(rawComps.filter(c => c.size >= erodedMin).map(c => c.id));

  // If only 1 significant component, skip expansion — use plain CCA on original mask
  if (significant.size <= 1) return standardCCA(mask, dims);

  // Zero out insignificant component labels
  for (let i = 0; i < dims.tp; i++) if (compId[i] && !significant.has(compId[i])) compId[i] = 0;

  // Expand eroded components back to original mask via BFS
  expandComponentsBFS(compId, mask, dims);

  return collectComponentPixels(compId, mask, dims.tp);
}

// =============================================================================
// Cluster review helpers
// =============================================================================

interface ClusterInfo {
  label: number;
  color: [number, number, number];
  pxCount: number;
  pct: number;
  componentCount: number;
}

/** Build per-cluster metadata for the review UI */
function buildClusterInfos(
  finalLabels: Set<number>,
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  countrySize: number,
  dims: GridDims,
  pxS: (base: number) => number,
): ClusterInfo[] {
  const clusterInfos: ClusterInfo[] = [];
  for (const lbl of finalLabels) {
    let cnt = 0;
    for (let i = 0; i < dims.tp; i++) if (pixelLabels[i] === lbl) cnt++;
    const c = colorCentroids[lbl];
    if (!c) continue;
    // Connected component analysis with erosion to break thin bridges
    // Use fixed threshold of 20px (matches split logic) — 5% was hiding small
    // disconnected fragments like map title text that users need to split off
    const minCompSize = 20;
    const components = findComponentsWithErosion(pixelLabels, lbl, minCompSize, dims, pxS);
    const compCount = components.filter(c => c.length >= minCompSize).length;
    clusterInfos.push({
      label: lbl,
      color: [c[0], c[1], c[2]],
      pxCount: cnt,
      pct: Math.round(cnt / countrySize * 1000) / 10,
      componentCount: compCount,
    });
  }
  return clusterInfos;
}

/** Render the "preview" image: flat cluster colors on a light-grey background */
async function renderClusterPreviewPng(
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  dims: GridDims,
  origW: number,
  origH: number,
): Promise<Buffer> {
  const previewBuf = Buffer.alloc(dims.tp * 3, 220);
  for (let i = 0; i < dims.tp; i++) {
    if (pixelLabels[i] !== 255 && colorCentroids[pixelLabels[i]]) {
      const c = colorCentroids[pixelLabels[i]]!;
      previewBuf[i * 3] = c[0];
      previewBuf[i * 3 + 1] = c[1];
      previewBuf[i * 3 + 2] = c[2];
    }
  }
  return sharp(previewBuf, { raw: { width: dims.TW, height: dims.TH, channels: 3 } })
    .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
}

/** Render one per-cluster highlight mask (hot-pink highlighter on transparent) */
async function renderClusterHighlightPng(
  pixelLabels: Uint8Array,
  label: number,
  dims: GridDims,
  origW: number,
  origH: number,
): Promise<Buffer> {
  const hlBuf = Buffer.alloc(dims.tp * 4, 0); // RGBA, all transparent
  for (let i = 0; i < dims.tp; i++) {
    if (pixelLabels[i] !== label) continue;
    hlBuf[i * 4] = 255;     // R
    hlBuf[i * 4 + 1] = 0;   // G
    hlBuf[i * 4 + 2] = 200; // B (hot pink)
    hlBuf[i * 4 + 3] = 140; // A — bright but see-through like a highlighter
  }
  return sharp(hlBuf, { raw: { width: dims.TW, height: dims.TH, channels: 4 } })
    .resize(origW, origH, { kernel: 'lanczos3' }).png().toBuffer();
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

/**
 * Apply split: break target clusters into separate labels based on connected components.
 * Returns true if at least one cluster was split (caller should loop back to review).
 */
function applySplitDecisions(
  splitLabels: number[],
  pixelLabels: Uint8Array,
  colorCentroids: Array<[number, number, number] | null>,
  finalLabels: Set<number>,
  dims: GridDims,
  pxS: (base: number) => number,
): boolean {
  let nextLabel = Math.max(...finalLabels) + 1;
  let didSplit = false;
  for (const lbl of splitLabels) {
    const components = findComponentsWithErosion(pixelLabels, lbl, 20, dims, pxS);
    const filtered = components.filter(c => c.length >= 20);
    if (filtered.length <= 1) {
      console.log(`  [Split] Cluster ${lbl}: only 1 significant component, skipping`);
      continue;
    }
    console.log(`  [Split] Cluster ${lbl}: ${filtered.length} components (${filtered.map(c => c.length + 'px').join(', ')})`);
    const origColor = colorCentroids[lbl] ?? [128, 128, 128];
    for (let ci = 1; ci < filtered.length; ci++) {
      const newLbl = nextLabel++;
      for (const pix of filtered[ci]) pixelLabels[pix] = newLbl;
      finalLabels.add(newLbl);
      colorCentroids[newLbl] = [...origColor] as [number, number, number];
      console.log(`  [Split] New cluster ${newLbl}: ${filtered[ci].length}px (split from cluster ${lbl})`);
    }
    didSplit = true;
  }
  if (didSplit) console.log(`  [Split] Now ${finalLabels.size} clusters — looping back to review`);
  return didSplit;
}

/** Apply exclude decisions: set excluded clusters' pixels to background (255) */
function applyExcludeDecisions(
  excludeLabels: number[],
  pixelLabels: Uint8Array,
  finalLabels: Set<number>,
  tp: number,
): void {
  for (const lbl of excludeLabels) {
    console.log(`  [Cluster Review] Excluding cluster ${lbl} (set to background)`);
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] === lbl) pixelLabels[i] = 255;
    }
    finalLabels.delete(lbl);
  }
}

/** Apply merge decisions: remap `from` pixels to `to` cluster */
function applyMergeDecisions(
  mergeEntries: Array<[number, number]>,
  pixelLabels: Uint8Array,
  finalLabels: Set<number>,
  tp: number,
): void {
  for (const [fromLabel, toLabel] of mergeEntries) {
    if (!finalLabels.has(fromLabel) || !finalLabels.has(toLabel)) continue;
    console.log(`  [Cluster Review] Merging cluster ${fromLabel} → ${toLabel}`);
    for (let i = 0; i < tp; i++) {
      if (pixelLabels[i] === fromLabel) pixelLabels[i] = toLabel;
    }
    finalLabels.delete(fromLabel);
  }
  console.log(`  [Cluster Review] ${finalLabels.size} clusters remaining`);
}

export interface ClusterReviewIterationParams {
  regionId: number;
  finalLabels: Set<number>;
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number] | null>;
  countrySize: number;
  borderPaths: unknown; // passed through to SSE payload
  dims: GridDims;
  origW: number;
  origH: number;
  pxS: (base: number) => number;
  sendEvent: (event: Record<string, unknown>) => void;
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
