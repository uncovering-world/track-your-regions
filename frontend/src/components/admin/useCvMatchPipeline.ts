/**
 * useCvMatchPipeline — Custom hook for the CV color-match / mapshape-match state machine.
 *
 * Extracted from WorldViewImportTree.tsx. Owns all dialog state, SSE event handling,
 * and review response callbacks for the CV match workflow.
 */

import { useState, useCallback, useRef } from 'react';
import {
  colorMatchWithProgress,
  parkCropUrl,
  clusterPreviewUrl,
  mapshapeMatch,
  waterCropUrl,
  type ColorMatchSSEEvent,
  type ColorMatchCluster,
  type MatchTreeNode,
  type ClusterReviewCluster,
  type ClusterGeoInfo,
} from '../../api/adminWorldViewImport';
import type { SpatialAnomaly } from '../../api/adminWvImportTreeOps';
import type { AdjacencyEdge } from '../../api/adminWvImportCvMatch';

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
  /** Interactive park review — pipeline paused waiting for user response */
  parkReview?: {
    reviewId: string;
    totalParkPct: number;
    components: Array<{ id: number; pct: number; cropUrl: string }>;
    /** Per-component decision: true = park (remove), false = keep */
    decisions: Map<number, boolean>;
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

    try {
      await colorMatchWithProgress(worldViewId, regionId, (event: ColorMatchSSEEvent) => {
        if (event.type === 'progress' && event.step) {
          setCVMatchDialog(prev => prev ? { ...prev, progressText: `${event.step} (${event.elapsed?.toFixed(1)}s)` } : prev);
        }

        if (event.type === 'debug_image' && event.debugImage) {
          const img = event.debugImage;
          setCVMatchDialog(prev => prev ? { ...prev, debugImages: [...prev.debugImages, img] } : prev);
        }

        if (event.type === 'water_review' && event.reviewId) {
          console.log(`[CV SSE] water_review: ${event.waterComponents?.length ?? 0} components, reviewId=${event.reviewId}`);
          const rid = event.reviewId;
          setCVMatchDialog(prev => {
            if (!prev) return prev;
            const waterImg = [...prev.debugImages].reverse().find(img => img.label.startsWith('Water mask'));
            // Build crop URLs pointing to the backend GET endpoint (no SSE bloat)
            const components = (event.waterComponents ?? []).map(c => ({
              ...c,
              cropDataUrl: waterCropUrl(rid, c.id, -1),
              subClusters: (c.subClusters ?? []).map(sc => ({
                ...sc,
                cropDataUrl: waterCropUrl(rid, c.id, sc.idx),
              })),
            }));
            // Default: all components marked as water
            const decisions = new Map<number, 'water' | 'region' | 'mix'>();
            for (const c of components) decisions.set(c.id, 'water');
            return {
              ...prev,
              waterReview: {
                reviewId: rid,
                waterMaskImage: waterImg?.dataUrl ?? '',
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

        if (event.type === 'park_review' && event.reviewId) {
          console.log(`[CV SSE] park_review: ${event.data?.components?.length ?? 0} components, reviewId=${event.reviewId}`);
          const rid = event.reviewId;
          setCVMatchDialog(prev => {
            if (!prev) return prev;
            const components = (event.data?.components ?? []).map(c => ({
              id: c.id,
              pct: c.pct,
              cropUrl: parkCropUrl(rid, c.id),
            }));
            // Default: all components marked as parks (to be removed)
            const decisions = new Map<number, boolean>();
            for (const c of components) decisions.set(c.id, true);
            return {
              ...prev,
              parkReview: {
                reviewId: rid,
                totalParkPct: event.data?.totalParkPct ?? 0,
                components,
                decisions,
              },
              progressText: 'Park overlay detection — review needed',
              progressColor: '#2e7d32',
            };
          });
        }

        if (event.type === 'cluster_review' && event.reviewId) {
          console.log(`[CV SSE] cluster_review: ${event.data?.clusters?.length ?? 0} clusters, reviewId=${event.reviewId}`);
          const rid = event.reviewId;
          setCVMatchDialog(prev => {
            if (!prev) return prev;
            const clusters = event.data?.clusters ?? [];
            // Auto-exclude near-gray clusters (low saturation, likely artifacts)
            const autoExcludes = new Set<number>();
            for (const c of clusters) {
              const m = c.color.match(/rgb\((\d+),(\d+),(\d+)\)/);
              if (m) {
                const r = +m[1], g = +m[2], b = +m[3];
                const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
                const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
                if (sat < 0.15 && c.isSmall) autoExcludes.add(c.label);
              }
            }
            // Restore saved decisions for cluster labels that still exist after split
            const newLabels = new Set(clusters.map((c: { label: number }) => c.label));
            const restoredMerges = new Map<number, number>();
            const restoredExcludes = new Set<number>(autoExcludes);
            const restoredRegionAssignments = new Map<number, number>();

            if (prev.savedMerges) {
              for (const [from, to] of prev.savedMerges) {
                if (newLabels.has(from) && newLabels.has(to)) restoredMerges.set(from, to);
              }
            }
            if (prev.savedExcludes) {
              for (const label of prev.savedExcludes) {
                if (newLabels.has(label)) restoredExcludes.add(label);
              }
            }
            if (prev.savedRegionAssignments) {
              for (const [label, regionId] of prev.savedRegionAssignments) {
                if (newLabels.has(label)) restoredRegionAssignments.set(label, regionId);
              }
            }

            return {
              ...prev,
              clusterReview: {
                reviewId: rid,
                clusters,
                previewImage: clusterPreviewUrl(rid),
                merges: restoredMerges,
                excludes: restoredExcludes,
                regionAssignments: restoredRegionAssignments,
              },
              savedRegionAssignments: undefined,
              savedMerges: undefined,
              savedExcludes: undefined,
              progressText: 'Cluster review — merge small artifacts before assignment',
              progressColor: '#1565c0',
            };
          });
        }

        if (event.type === 'icp_adjustment_available' && event.reviewId) {
          console.log(`[CV SSE] icp_adjustment_available: reviewId=${event.reviewId}`);
          const rid = event.reviewId;
          setCVMatchDialog(prev => {
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

        if (event.type === 'complete' && event.data?.stats) {
          const stats = event.data.stats;
          const clusters = event.data.clusters ?? [];
          const title = stats.countryName
            ? `CV Match — ${stats.countryName} (${stats.cvAssignedDivisions ?? 0} divisions → ${stats.cvClusters ?? 0} clusters)`
            : 'CV Match';
          setCVMatchDialog(prev => {
            if (!prev) return prev;
            // Apply region assignments from cluster review (user picked regions during review)
            const savedAssignments = prev.savedRegionAssignments ?? prev.clusterReview?.regionAssignments;
            const finalClusters = savedAssignments && savedAssignments.size > 0
              ? clusters.map(c => {
                  const assignedRegionId = savedAssignments.get(c.clusterId);
                  if (assignedRegionId == null) return c;
                  const childRegions = event.data?.childRegions ?? prev.childRegions;
                  const region = childRegions.find(r => r.id === assignedRegionId);
                  return region ? { ...c, suggestedRegion: region } : c;
                })
              : clusters;
            return {
              ...prev,
              title,
              clusters: finalClusters,
              childRegions: event.data?.childRegions ?? prev.childRegions,
              outOfBounds: event.data?.outOfBounds ?? prev.outOfBounds,
              geoPreview: event.data?.geoPreview,
              spatialAnomalies: event.data?.spatialAnomalies,
              adjacencyEdges: event.data?.adjacencyEdges,
              progressText: `Done in ${event.elapsed?.toFixed(1)}s — ${stats.cvAssignedDivisions ?? 0} matched${stats.assignedDivisions ? `, ${stats.assignedDivisions} pre-assigned` : ''}${stats.cvUnsplittable ? `, ${stats.cvUnsplittable} unsplittable` : ''}${stats.cvOutOfBounds ? `, ${stats.cvOutOfBounds} outside map` : ''}`,
              progressColor: '#2e7d32',
              done: true,
            };
          });
          onCompleteRef.current?.(regionId);
        }

        if (event.type === 'error') {
          setCVMatchDialog(prev => prev ? {
            ...prev,
            progressText: `Error: ${event.message}`,
            progressColor: '#d32f2f',
            done: true,
          } : prev);
        }
      }, controller.signal);
    } catch (err) {
      // Abort is expected when user closes dialog — don't show error
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('CV match failed:', err);
      setCVMatchDialog(prev => prev ? {
        ...prev,
        progressText: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
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
      onComplete?.(regionId);
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
