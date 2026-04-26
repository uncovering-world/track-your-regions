/**
 * useCvMatchPipeline — Custom hook for the CV color-match / mapshape-match state machine.
 *
 * Extracted from WorldViewImportTree.tsx. Owns all dialog state, SSE event handling,
 * and review response callbacks for the CV match workflow.
 */

import { useState, useCallback, useRef } from 'react';
import {
  colorMatchWithProgress,
  clusterPreviewUrl,
  mapshapeMatch,
  waterCropUrl,
  type ColorMatchSSEEvent,
  type ColorMatchCluster,
  type MatchTreeNode,
  type ClusterReviewCluster,
  type ClusterGeoInfo,
} from '../../api/admin/worldViewImport';
import type { SpatialAnomaly } from '../../api/admin/wvImportTreeOps';
import type { AdjacencyEdge, BorderPath } from '../../api/admin/wvImportCvMatch';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CvMatchDialogState {
  title: string;
  progressText: string;
  progressColor: string;
  debugImages: Array<{ label: string; dataUrl: string }>;
  clusters: ColorMatchCluster[];
  childRegions: Array<{ id: number; name: string }>;
  outOfBounds: Array<{ id: number; name: string }>;
  regionId: number;
  regionMapUrl: string | null;
  sourceUrl: string | null;
  done: boolean;
  /** Saved cluster->region assignments from cluster review (persists after review is cleared) */
  savedRegionAssignments?: Map<number, number>;
  /** Saved merges from cluster review (persists across split operations) */
  savedMerges?: Map<number, number>;
  /** Saved excludes from cluster review (persists across split operations) */
  savedExcludes?: Set<number>;
  geoPreview?: {
    featureCollection: GeoJSON.FeatureCollection;
    clusterInfos: ClusterGeoInfo[];
  };
  /** Wikivoyage mapshape geoshape boundaries for side-by-side comparison */
  wikivoyagePreview?: GeoJSON.FeatureCollection;
  spatialAnomalies?: SpatialAnomaly[];
  adjacencyEdges?: AdjacencyEdge[];
  /** Interactive water review — pipeline paused waiting for user response */
  waterReview?: {
    reviewId: string;
    waterMaskImage: string;
    waterPxPercent: number;
    components: Array<{ id: number; pct: number; cropDataUrl: string; subClusters: Array<{ idx: number; pct: number; cropDataUrl: string }> }>;
    /** Per-component decision: 'water' | 'region' | 'mix' */
    decisions: Map<number, 'water' | 'region' | 'mix'>;
    /** Per-component sub-cluster approvals (only for 'mix' decisions) */
    mixApproved: Map<number, Set<number>>;
  };
  /** Interactive cluster review — merge small artifact clusters before final assignment */
  clusterReview?: {
    reviewId: string;
    clusters: ClusterReviewCluster[];
    previewImage: string;
    /** Map from small cluster label -> target cluster label to merge into */
    merges: Map<number, number>;
    /** Cluster labels to exclude (not a real region) */
    excludes: Set<number>;
    /** Map from cluster label -> region id (user-assigned during review) */
    regionAssignments: Map<number, number>;
    /** Currently highlighted cluster label (clicked by user) */
    highlightedLabel?: number;
    /** Highlight overlay image URL for the selected cluster */
    highlightOverlay?: string;
    /** Border paths between clusters for alignment visualization */
    borderPaths: BorderPath[];
    pipelineSize?: { w: number; h: number };
  };
  icpAdjustment?: {
    reviewId: string;
    message: string;
    metrics: { overflow: number; error: number; icpOption: string };
  };
}

export interface UseCvMatchPipelineResult {
  // Dialog state
  cvMatchDialog: CvMatchDialogState | null;
  setCVMatchDialog: React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;
  highlightClusterId: number | null;
  setHighlightClusterId: React.Dispatch<React.SetStateAction<number | null>>;
  cvMatchingRegionId: number | null;
  mapshapeMatchingRegionId: number | null;

  // Settings state
  aiModelOverride: string | null;
  setAiModelOverride: React.Dispatch<React.SetStateAction<string | null>>;
  modelPickerOpen: boolean;
  setModelPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modelPickerModels: Array<{ id: string }>;
  setModelPickerModels: React.Dispatch<React.SetStateAction<Array<{ id: string }>>>;
  modelPickerGlobal: string;
  setModelPickerGlobal: React.Dispatch<React.SetStateAction<string>>;
  modelPickerSelected: string;
  setModelPickerSelected: React.Dispatch<React.SetStateAction<string>>;

  // Handlers
  handleCVMatch: (regionId: number) => Promise<void>;
  handleMapshapeMatch: (regionId: number) => Promise<void>;
  cancelCvMatch: () => void;
}

// ─── Module-level SSE event helpers ─────────────────────────────────────────
// Defined outside the hook so they don't count toward the hook's function-nesting
// depth budget and are re-used trivially across the closure.

type DialogSetter = React.Dispatch<React.SetStateAction<CvMatchDialogState | null>>;

function applyProgressEvent(setDialog: DialogSetter, event: ColorMatchSSEEvent) {
  if (!event.step) return;
  const elapsed = event.elapsed?.toFixed(1);
  const progressText = `${event.step} (${elapsed}s)`;
  setDialog(prev => prev ? { ...prev, progressText } : prev);
}

function applyDebugImageEvent(setDialog: DialogSetter, event: ColorMatchSSEEvent) {
  if (!event.debugImage) return;
  const img = event.debugImage;
  setDialog(prev => prev ? { ...prev, debugImages: [...prev.debugImages, img] } : prev);
}

/**
 * Build review component rows with cropDataUrl resolved.
 *
 * Two producers:
 * - JS pipeline: backend stores crops in memory, emits components with an
 *   empty cropDataUrl — we build /api/admin/wv-import/water-crop/... URLs here.
 * - Python pipeline: Python encodes each crop inline as a `data:image/png;base64,...`
 *   URL — we pass it through verbatim.
 */
function buildWaterReviewComponents(
  rid: string,
  rawComponents: NonNullable<ColorMatchSSEEvent['waterComponents']>,
) {
  const resolveCrop = (incoming: string | undefined, cId: number, subIdx: number): string =>
    incoming && incoming.startsWith('data:') ? incoming : waterCropUrl(rid, cId, subIdx);

  const mapSubCluster = (cId: number) => (sc: { idx: number; pct: number; cropDataUrl?: string }) => ({
    ...sc,
    cropDataUrl: resolveCrop(sc.cropDataUrl, cId, sc.idx),
  });
  return rawComponents.map(c => ({
    ...c,
    cropDataUrl: resolveCrop(c.cropDataUrl, c.id, -1),
    subClusters: (c.subClusters ?? []).map(mapSubCluster(c.id)),
  }));
}

function applyWaterReviewEvent(setDialog: DialogSetter, event: ColorMatchSSEEvent) {
  if (!event.reviewId) return;
  const rid = event.reviewId;
  setDialog(prev => {
    if (!prev) return prev;
    // Python pipeline sends waterMaskImage inline; JS pipeline's review event
    // has no image and relies on a prior "Water mask" debug_image.
    const inlineMask = event.waterMaskImage && event.waterMaskImage.length > 0
      ? event.waterMaskImage
      : undefined;
    const waterImg = inlineMask
      ? undefined
      : [...prev.debugImages].reverse().find(img => img.label.startsWith('Water mask'));
    const components = buildWaterReviewComponents(rid, event.waterComponents ?? []);
    const decisions = new Map<number, 'water' | 'region' | 'mix'>();
    for (const c of components) decisions.set(c.id, 'water');
    return {
      ...prev,
      waterReview: {
        reviewId: rid,
        waterMaskImage: inlineMask ?? waterImg?.dataUrl ?? '',
        waterPxPercent: event.waterPxPercent ?? 0,
        components,
        decisions,
        mixApproved: new Map<number, Set<number>>(),
      },
      progressText: 'Water detection — review needed',
      progressColor: '#ed6c02',
    };
  });
}

function computeClusterAutoExcludes(
  clusters: ReadonlyArray<{ label: number; color: string; isSmall: boolean }>,
): Set<number> {
  const excludes = new Set<number>();
  for (const c of clusters) {
    const m = c.color.match(/rgb\((\d+),(\d+),(\d+)\)/);
    if (!m) continue;
    const r = +m[1], g = +m[2], b = +m[3];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
    if (sat < 0.15 && c.isSmall) excludes.add(c.label);
  }
  return excludes;
}

function restoreSavedMerges(
  saved: Map<number, number> | undefined,
  newLabels: Set<number>,
): Map<number, number> {
  const out = new Map<number, number>();
  if (!saved) return out;
  for (const [from, to] of saved) {
    if (newLabels.has(from) && newLabels.has(to)) out.set(from, to);
  }
  return out;
}

function restoreSavedExcludes(
  saved: Set<number> | undefined,
  newLabels: Set<number>,
  autoExcludes: Set<number>,
): Set<number> {
  const out = new Set<number>(autoExcludes);
  if (!saved) return out;
  for (const label of saved) {
    if (newLabels.has(label)) out.add(label);
  }
  return out;
}

function restoreSavedRegionAssignments(
  saved: Map<number, number> | undefined,
  newLabels: Set<number>,
): Map<number, number> {
  const out = new Map<number, number>();
  if (!saved) return out;
  for (const [label, regId] of saved) {
    if (newLabels.has(label)) out.set(label, regId);
  }
  return out;
}

function restoreClusterReviewState(
  prev: CvMatchDialogState,
  clusters: ReadonlyArray<{ label: number; color: string; isSmall: boolean }>,
) {
  const autoExcludes = computeClusterAutoExcludes(clusters);
  const newLabels = new Set(clusters.map(c => c.label));
  return {
    restoredMerges: restoreSavedMerges(prev.savedMerges, newLabels),
    restoredExcludes: restoreSavedExcludes(prev.savedExcludes, newLabels, autoExcludes),
    restoredRegionAssignments: restoreSavedRegionAssignments(prev.savedRegionAssignments, newLabels),
  };
}

function applyClusterReviewEvent(setDialog: DialogSetter, event: ColorMatchSSEEvent) {
  if (!event.reviewId) return;
  const rid = event.reviewId;
  setDialog(prev => {
    if (!prev) return prev;
    const clusters = event.data?.clusters ?? [];
    const { restoredMerges, restoredExcludes, restoredRegionAssignments } =
      restoreClusterReviewState(prev, clusters);

    return {
      ...prev,
      clusterReview: {
        reviewId: rid,
        clusters,
        previewImage: clusterPreviewUrl(rid),
        merges: restoredMerges,
        excludes: restoredExcludes,
        regionAssignments: restoredRegionAssignments,
        borderPaths: event.data?.borderPaths ?? [],
        pipelineSize: event.data?.pipelineSize,
      },
      savedRegionAssignments: undefined,
      savedMerges: undefined,
      savedExcludes: undefined,
      progressText: 'Cluster review — merge small artifacts before assignment',
      progressColor: '#1565c0',
    };
  });
}

function applyIcpAdjustmentEvent(setDialog: DialogSetter, event: ColorMatchSSEEvent) {
  if (!event.reviewId) return;
  const rid = event.reviewId;
  setDialog(prev => {
    if (!prev) return prev;
    return {
      ...prev,
      icpAdjustment: {
        reviewId: rid,
        message: event.message ?? 'Alignment quality is lower than expected.',
        metrics: {
          overflow: event.metrics?.overflow ?? 0,
          error: event.metrics?.error ?? 0,
          icpOption: event.metrics?.icpOption ?? '',
        },
      },
      progressText: 'ICP alignment — adjustment available',
      progressColor: '#ed6c02',
    };
  });
}

function buildCompleteStatsText(
  elapsed: number | undefined,
  stats: {
    cvAssignedDivisions?: number;
    assignedDivisions?: number;
    cvUnsplittable?: number;
    cvOutOfBounds?: number;
  },
): string {
  const elapsedText = elapsed?.toFixed(1);
  const cvAssigned = stats.cvAssignedDivisions ?? 0;
  const preAssignedPart = stats.assignedDivisions ? `, ${stats.assignedDivisions} pre-assigned` : '';
  const unsplittablePart = stats.cvUnsplittable ? `, ${stats.cvUnsplittable} unsplittable` : '';
  const outOfBoundsPart = stats.cvOutOfBounds ? `, ${stats.cvOutOfBounds} outside map` : '';
  return `Done in ${elapsedText}s — ${cvAssigned} matched${preAssignedPart}${unsplittablePart}${outOfBoundsPart}`;
}

function applyCompleteEvent(setDialog: DialogSetter, event: ColorMatchSSEEvent) {
  if (!event.data?.stats) return;
  const stats = event.data.stats;
  const clusters = event.data.clusters ?? [];
  const title = stats.countryName
    ? `CV Match — ${stats.countryName} (${stats.cvAssignedDivisions ?? 0} divisions → ${stats.cvClusters ?? 0} clusters)`
    : 'CV Match';

  setDialog(prev => {
    if (!prev) return prev;
    // Apply region assignments from cluster review (user picked regions during review)
    const savedAssignments = prev.savedRegionAssignments ?? prev.clusterReview?.regionAssignments;
    const childRegionsList = event.data?.childRegions ?? prev.childRegions;
    const applyAssignmentToCluster = (c: ColorMatchCluster): ColorMatchCluster => {
      const assignedRegionId = savedAssignments?.get(c.clusterId);
      if (assignedRegionId == null) return c;
      const region = childRegionsList.find(r => r.id === assignedRegionId);
      return region ? { ...c, suggestedRegion: region } : c;
    };
    const finalClusters = savedAssignments && savedAssignments.size > 0
      ? clusters.map(applyAssignmentToCluster)
      : clusters;
    return {
      ...prev,
      title,
      clusters: finalClusters,
      childRegions: childRegionsList,
      outOfBounds: event.data?.outOfBounds ?? prev.outOfBounds,
      geoPreview: event.data?.geoPreview,
      spatialAnomalies: event.data?.spatialAnomalies,
      adjacencyEdges: event.data?.adjacencyEdges,
      progressText: buildCompleteStatsText(event.elapsed, stats),
      progressColor: '#2e7d32',
      done: true,
    };
  });
}

function applyErrorEvent(setDialog: DialogSetter, event: ColorMatchSSEEvent) {
  setDialog(prev => prev ? {
    ...prev,
    progressText: `Error: ${event.message}`,
    progressColor: '#d32f2f',
    done: true,
  } : prev);
}

export function useCvMatchPipeline(
  worldViewId: number,
  tree: MatchTreeNode[] | undefined,
  onComplete?: (regionId: number) => void,
): UseCvMatchPipelineResult {
  // CV color match / Mapshape match dialog state
  const [cvMatchingRegionId, setCVMatchingRegionId] = useState<number | null>(null);
  const [mapshapeMatchingRegionId, setMapshapeMatchingRegionId] = useState<number | null>(null);
  const [cvMatchDialog, setCVMatchDialog] = useState<CvMatchDialogState | null>(null);
  const [highlightClusterId, setHighlightClusterId] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Settings
  const [aiModelOverride, setAiModelOverride] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerModels, setModelPickerModels] = useState<Array<{ id: string }>>([]);
  const [modelPickerGlobal, setModelPickerGlobal] = useState('');
  const [modelPickerSelected, setModelPickerSelected] = useState('');

  // Cancel any running CV/mapshape pipeline — aborts SSE connection and clears state
  const cancelCvMatch = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setCVMatchingRegionId(null);
    setMapshapeMatchingRegionId(null);
    setCVMatchDialog(null);
    setHighlightClusterId(null);
  }, []);

  // CV color match handler — opens dialog immediately with SSE progress
  const handleCVMatch = useCallback(async (regionId: number) => {
    // Cancel any previous run
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Find tree node to get the original region map URL
    const findNode = (nodes: MatchTreeNode[]): MatchTreeNode | null => {
      for (const n of nodes) {
        if (n.id === regionId) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    };
    const node = tree ? findNode(tree) : null;

    // Pre-populate childRegions from tree so they're available during cluster review
    const childRegions = node?.children?.map(c => ({ id: c.id, name: c.name })) ?? [];

    setCVMatchingRegionId(regionId);
    setCVMatchDialog({
      title: 'CV Color Match',
      progressText: 'Connecting...',
      progressColor: '#666',
      debugImages: [],
      clusters: [],
      childRegions,
      outOfBounds: [],
      regionId,
      regionMapUrl: node?.regionMapUrl ?? null,
      sourceUrl: node?.sourceUrl ?? null,
      done: false,
    });

    const handleSseEvent = (event: ColorMatchSSEEvent) => {
      switch (event.type) {
        case 'progress':
          applyProgressEvent(setCVMatchDialog, event);
          return;
        case 'debug_image':
          applyDebugImageEvent(setCVMatchDialog, event);
          return;
        case 'water_review':
          applyWaterReviewEvent(setCVMatchDialog, event);
          return;
        case 'cluster_review':
          applyClusterReviewEvent(setCVMatchDialog, event);
          return;
        case 'icp_adjustment_available':
          applyIcpAdjustmentEvent(setCVMatchDialog, event);
          return;
        case 'complete':
          applyCompleteEvent(setCVMatchDialog, event);
          onCompleteRef.current?.(regionId);
          return;
        case 'error':
          applyErrorEvent(setCVMatchDialog, event);
      }
    };

    try {
      await colorMatchWithProgress(worldViewId, regionId, handleSseEvent, controller.signal);
    } catch (err) {
      // Abort is expected when user closes dialog — don't show error
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('CV match failed:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setCVMatchDialog(prev => prev ? {
        ...prev,
        progressText: `Error: ${errMsg}`,
        progressColor: '#d32f2f',
        done: true,
      } : prev);
    } finally {
      setCVMatchingRegionId(null);
    }
  }, [worldViewId, tree]);

  // Mapshape match handler — fetches Kartographer mapshape data from Wikivoyage page,
  // maps to GADM divisions, and opens the same dialog as CV match
  const handleMapshapeMatch = useCallback(async (regionId: number) => {
    setMapshapeMatchingRegionId(regionId);
    setCVMatchDialog({
      title: 'Mapshape Match',
      progressText: 'Fetching Wikivoyage mapshape data...',
      progressColor: '#666',
      debugImages: [],
      clusters: [],
      childRegions: [],
      outOfBounds: [],
      regionId,
      regionMapUrl: null,
      sourceUrl: null,
      done: false,
    });

    try {
      const result = await mapshapeMatch(worldViewId, regionId);

      if (!result.found || !result.mapshapes || result.mapshapes.length === 0) {
        setCVMatchDialog(prev => prev ? {
          ...prev,
          progressText: result.message ?? 'No mapshape templates found on this page',
          progressColor: '#ed6c02',
          done: true,
        } : prev);
        return;
      }

      // Convert mapshape results to ColorMatchCluster format for the shared dialog
      const clusters: ColorMatchCluster[] = result.mapshapes.map((ms, i) => ({
        clusterId: i,
        color: ms.color,
        pixelShare: 1 / result.mapshapes!.length,
        suggestedRegion: ms.matchedRegion,
        divisions: ms.divisions.map(d => ({
          id: d.id,
          name: d.name,
          confidence: d.coverage,
          depth: 0,
        })),
        unsplittable: [],
      }));

      const stats = result.stats!;
      setCVMatchDialog(prev => prev ? {
        ...prev,
        title: `Mapshape Match — ${stats.totalDivisions} divisions → ${stats.totalMapshapes} regions (${stats.matchedMapshapes} matched)`,
        clusters,
        childRegions: result.childRegions ?? [],
        geoPreview: result.geoPreview,
        wikivoyagePreview: result.wikivoyagePreview,
        progressText: `Found ${stats.totalMapshapes} mapshape regions with ${stats.totalDivisions} GADM divisions`,
        progressColor: '#2e7d32',
        done: true,
      } : prev);
      onCompleteRef.current?.(regionId);
    } catch (err) {
      console.error('Mapshape match failed:', err);
      setCVMatchDialog(prev => prev ? {
        ...prev,
        progressText: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        progressColor: '#d32f2f',
        done: true,
      } : prev);
    } finally {
      setMapshapeMatchingRegionId(null);
    }
  }, [worldViewId]);

  return {
    cvMatchDialog,
    setCVMatchDialog,
    highlightClusterId,
    setHighlightClusterId,
    cvMatchingRegionId,
    mapshapeMatchingRegionId,

    aiModelOverride,
    setAiModelOverride,
    modelPickerOpen,
    setModelPickerOpen,
    modelPickerModels,
    setModelPickerModels,
    modelPickerGlobal,
    setModelPickerGlobal,
    modelPickerSelected,
    setModelPickerSelected,

    handleCVMatch,
    handleMapshapeMatch,
    cancelCvMatch,
  };
}
