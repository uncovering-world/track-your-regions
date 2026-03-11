/**
 * WorldView Import Tree — Mutations Hook
 *
 * Extracts all useMutation hooks, invalidation logic, and mutation-owned state
 * from WorldViewImportTree to keep the component focused on rendering.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  acceptMatch,
  acceptBatchMatches,
  rejectSuggestion,
  dbSearchOneRegion,
  aiMatchOneRegion,
  dismissChildren,
  pruneToLeaves,
  smartFlatten,
  undoLastOperation,
  syncInstances,
  handleAsGrouping,
  geocodeMatchRegion,
  geoshapeMatchRegion,
  pointMatchRegion,
  resetMatchRegion,
  clearRegionMembers,
  rejectRemaining,
  acceptAndRejectRest as acceptAndRejectRestApi,
  acceptBatchAndRejectRest,
  rejectBatchSuggestions,
  selectMapImage,
  markManualFix,
  mergeChildIntoParent,
  addChildRegion,
  dismissHierarchyWarnings,
  removeRegionFromImport,
  collapseToParent,
  autoResolveChildren,
  renameRegion,
  reparentRegion,
  getChildrenCoverage,
  type MatchTreeNode,
  type ChildrenCoverageResult,
} from '../../api/adminWorldViewImport';
// ─── Types shared between hook and component ─────────────────────────────────

export interface MapPickerState {
  regionId: number;
  regionName: string;
  candidates: string[];
  currentSelection: string | null;
  wikidataId: string | null;
  pendingPreview?: {
    divisionId: number;
    name: string;
    path?: string;
    isAssigned: boolean;
  };
}

/** Deps the hook needs from the component (all stable refs or setters) */
export interface TreeMutationDeps {
  onPreview: (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean, regionMapLabel?: string, regionName?: string) => void;
  /** Ref to current mapPickerState — needed by selectMapMutation to read pending preview */
  mapPickerStateRef: React.RefObject<MapPickerState | null>;
  setMapPickerState: React.Dispatch<React.SetStateAction<MapPickerState | null>>;
  setRemoveDialogState: React.Dispatch<React.SetStateAction<{ regionId: number; regionName: string; hasChildren: boolean; hasDivisions: boolean } | null>>;
  /** Called when division assignments change, so parent can mark coverage as stale */
  onMatchChange?: () => void;
}

export function useTreeMutations(worldViewId: number, deps: TreeMutationDeps) {
  const queryClient = useQueryClient();

  // ── Mutation-owned state ─────────────────────────────────────────────────
  const [geocodeProgress, setGeocodeProgress] = useState<{ regionId: number; message: string } | null>(null);
  const [undoSnackbar, setUndoSnackbar] = useState<{
    open: boolean;
    message: string;
    worldViewId: number;
  } | null>(null);

  // ── Shared invalidation helpers ──────────────────────────────────────────
  const treeKey = ['admin', 'wvImport', 'matchTree', worldViewId] as const;
  const coverageKey = ['admin', 'wvImport', 'childrenCoverage', worldViewId] as const;

  /** Merge partial coverage data into the cache */
  const mergeCoverage = (partial: ChildrenCoverageResult) => {
    queryClient.setQueryData<ChildrenCoverageResult>(coverageKey, (old) => {
      if (!old) return partial;
      return {
        coverage: { ...old.coverage, ...partial.coverage },
        geoshapeCoverage: { ...old.geoshapeCoverage, ...partial.geoshapeCoverage },
      };
    });
  };

  /** Fetch coverage for ancestors of regionId, merging results incrementally.
   * Each ancestor gets its own API call so deep regions update first. */
  const refreshCoverage = (regionId?: number) => {
    if (regionId == null) {
      queryClient.invalidateQueries({ queryKey: coverageKey });
      return;
    }
    // Walk up the cached tree to collect ancestor IDs (deepest first)
    const treeData = queryClient.getQueryData<MatchTreeNode[]>(treeKey);
    if (!treeData) {
      // No tree cached — fall back to single request for all ancestors
      getChildrenCoverage(worldViewId, regionId).then(mergeCoverage).catch(() => {
        queryClient.invalidateQueries({ queryKey: coverageKey });
      });
      return;
    }
    // Build parent map and walk up
    const parentOf = new Map<number, number | null>();
    const walkTree = (nodes: MatchTreeNode[], parentId: number | null) => {
      for (const n of nodes) {
        parentOf.set(n.id, parentId);
        walkTree(n.children, n.id);
      }
    };
    walkTree(treeData, null);

    const ancestorIds: number[] = [];
    let current: number | null = regionId;
    while (current != null) {
      ancestorIds.push(current);
      current = parentOf.get(current) ?? null;
    }

    // Fire individual requests per ancestor — each returns fast for its own level.
    // Deepest ancestors are first in the array and their responses arrive sooner.
    for (const id of ancestorIds) {
      getChildrenCoverage(worldViewId, undefined, id).then(mergeCoverage).catch(() => {
        // Individual failure is fine — other ancestors still update
      });
    }
  };

  const invalidateTree = (regionId?: number) => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchStats', worldViewId] });
    refreshCoverage(regionId);
    deps.onMatchChange?.();
  };

  const invalidateStatsOnly = (regionId?: number) => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchStats', worldViewId] });
    refreshCoverage(regionId);
    deps.onMatchChange?.();
  };

  /** Optimistically update a single node in the cached tree by regionId.
   * Preserves object identity for unchanged branches so React.memo can skip re-renders. */
  function optimisticTreeUpdate(
    regionId: number,
    updater: (node: MatchTreeNode) => MatchTreeNode,
  ): MatchTreeNode[] | undefined {
    const prev = queryClient.getQueryData<MatchTreeNode[]>(treeKey);
    if (!prev) return undefined;
    function walk(nodes: MatchTreeNode[]): MatchTreeNode[] {
      let changed = false;
      const result = nodes.map(n => {
        if (n.id === regionId) { changed = true; return updater(n); }
        if (n.children.length > 0) {
          const newChildren = walk(n.children);
          if (newChildren !== n.children) { changed = true; return { ...n, children: newChildren }; }
        }
        return n;
      });
      return changed ? result : nodes;
    }
    queryClient.setQueryData(treeKey, walk(prev));
    return prev;
  }

  // ── Match review mutations (optimistic) ────────────────────────────────

  const acceptMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      acceptMatch(worldViewId, regionId, divisionId),
    onMutate: ({ regionId, divisionId }) => {
      const prev = optimisticTreeUpdate(regionId, (node) => {
        const accepted = node.suggestions.find(s => s.divisionId === divisionId);
        const remaining = node.suggestions.filter(s => s.divisionId !== divisionId);
        return {
          ...node,
          suggestions: remaining,
          assignedDivisions: accepted
            ? [...node.assignedDivisions, { divisionId: accepted.divisionId, name: accepted.name, path: accepted.path, hasCustomGeom: false }]
            : node.assignedDivisions,
          memberCount: node.memberCount + 1,
          matchStatus: remaining.length > 0 ? 'needs_review' : 'manual_matched',
        };
      });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(treeKey, context.prev);
    },
    onSuccess: (_data, { regionId }) => invalidateStatsOnly(regionId),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      rejectSuggestion(worldViewId, regionId, divisionId),
    onMutate: ({ regionId, divisionId }) => {
      const prev = optimisticTreeUpdate(regionId, (node) => {
        const remaining = node.suggestions.filter(s => s.divisionId !== divisionId);
        // Also remove from assignedDivisions (backend deletes from region_members too)
        const wasAssigned = node.assignedDivisions.some(d => d.divisionId === divisionId);
        const remainingAssigned = node.assignedDivisions.filter(d => d.divisionId !== divisionId);
        const newMemberCount = wasAssigned ? node.memberCount - 1 : node.memberCount;
        const newStatus = remaining.length > 0
          ? 'needs_review'
          : newMemberCount > 0 ? 'manual_matched' : 'no_candidates';
        return { ...node, suggestions: remaining, assignedDivisions: remainingAssigned, memberCount: newMemberCount, matchStatus: newStatus };
      });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(treeKey, context.prev);
    },
    onSuccess: (_data, { regionId }) => invalidateStatsOnly(regionId),
  });

  const rejectRemainingMutation = useMutation({
    mutationFn: (regionId: number) => rejectRemaining(worldViewId, regionId),
    onMutate: (regionId) => {
      const prev = optimisticTreeUpdate(regionId, (node) => ({
        ...node,
        suggestions: [],
        matchStatus: node.memberCount > 0 ? 'manual_matched' : 'no_candidates',
      }));
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(treeKey, context.prev);
    },
    onSuccess: (_data, regionId) => invalidateStatsOnly(regionId),
  });

  const acceptAndRejectRestMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      acceptAndRejectRestApi(worldViewId, regionId, divisionId),
    onMutate: ({ regionId, divisionId }) => {
      const prev = optimisticTreeUpdate(regionId, (node) => {
        const accepted = node.suggestions.find(s => s.divisionId === divisionId);
        return {
          ...node,
          suggestions: [],
          assignedDivisions: accepted
            ? [...node.assignedDivisions, { divisionId: accepted.divisionId, name: accepted.name, path: accepted.path, hasCustomGeom: false }]
            : node.assignedDivisions,
          memberCount: node.memberCount + 1,
          matchStatus: 'manual_matched',
        };
      });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(treeKey, context.prev);
    },
    onSuccess: (_data, { regionId }) => invalidateStatsOnly(regionId),
  });

  const acceptAllMutation = useMutation({
    mutationFn: (assignments: Array<{ regionId: number; divisionId: number }>) =>
      acceptBatchMatches(worldViewId, assignments),
    onSuccess: (_data, assignments) => invalidateTree(assignments[0]?.regionId),
  });

  const acceptSelectedMutation = useMutation({
    mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
      acceptBatchMatches(worldViewId, divisionIds.map(d => ({ regionId, divisionId: d }))),
    onSuccess: (_data, { regionId }) => invalidateTree(regionId),
  });

  const acceptSelectedRejectRestMutation = useMutation({
    mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
      acceptBatchAndRejectRest(worldViewId, regionId, divisionIds),
    onSuccess: (_data, { regionId }) => invalidateTree(regionId),
  });

  const rejectSelectedMutation = useMutation({
    mutationFn: ({ regionId, divisionIds }: { regionId: number; divisionIds: number[] }) =>
      rejectBatchSuggestions(worldViewId, regionId, divisionIds),
    onSuccess: (_data, { regionId }) => invalidateTree(regionId),
  });

  // ── Search mutations ─────────────────────────────────────────────────────

  const dbSearchOneMutation = useMutation({
    mutationFn: (regionId: number) => dbSearchOneRegion(worldViewId, regionId),
    onSuccess: (_data, regionId) => invalidateTree(regionId),
  });

  const aiMatchOneMutation = useMutation({
    mutationFn: (regionId: number) => aiMatchOneRegion(worldViewId, regionId),
    onSuccess: (_data, regionId) => invalidateTree(regionId),
  });

  const geocodeMatchMutation = useMutation({
    mutationFn: (regionId: number) => geocodeMatchRegion(worldViewId, regionId),
    onMutate: (regionId) => {
      setGeocodeProgress({ regionId, message: 'Geocoding via Nominatim...' });
    },
    onSuccess: (data, regionId) => {
      if (data.geocodedName) {
        const radiusMsg = data.searchRadiusKm
          ? ` within ${data.searchRadiusKm}km`
          : ' (exact)';
        setGeocodeProgress({
          regionId,
          message: data.found > 0
            ? `Found ${data.found} division(s)${radiusMsg}`
            : `No divisions found — ${data.geocodedName}`,
        });
      } else {
        setGeocodeProgress({ regionId, message: 'Not found in Nominatim' });
      }
      invalidateTree(regionId);
      setTimeout(() => setGeocodeProgress(null), 4000);
    },
    onError: () => {
      setGeocodeProgress(null);
    },
  });

  const geoshapeMatchMutation = useMutation({
    mutationFn: (regionId: number) => geoshapeMatchRegion(worldViewId, regionId),
    onMutate: (regionId) => {
      setGeocodeProgress({ regionId, message: 'Matching by geoshape...' });
    },
    onSuccess: (data, regionId) => {
      const coverageMsg = data.totalCoverage != null
        ? ` (${Math.round(data.totalCoverage * 100)}% coverage)`
        : '';
      setGeocodeProgress({
        regionId,
        message: data.found > 0
          ? `Covering set: ${data.found} division(s)${coverageMsg}`
          : 'No geoshape matches found',
      });
      invalidateTree(regionId);
      setTimeout(() => setGeocodeProgress(null), 4000);
    },
    onError: () => {
      setGeocodeProgress(null);
    },
  });

  const pointMatchMutation = useMutation({
    mutationFn: (regionId: number) => pointMatchRegion(worldViewId, regionId),
    onMutate: (regionId) => {
      setGeocodeProgress({ regionId, message: 'Matching by markers...' });
    },
    onSuccess: (data, regionId) => {
      setGeocodeProgress({
        regionId,
        message: data.found > 0
          ? `Found ${data.found} division(s) from markers`
          : 'No divisions found from markers',
      });
      invalidateTree(regionId);
      setTimeout(() => setGeocodeProgress(null), 4000);
    },
    onError: () => {
      setGeocodeProgress(null);
    },
  });

  const resetMatchMutation = useMutation({
    mutationFn: (regionId: number) => resetMatchRegion(worldViewId, regionId),
    onSuccess: () => invalidateTree(),
  });

  const clearMembersMutation = useMutation({
    mutationFn: (regionId: number) => clearRegionMembers(worldViewId, regionId),
    onMutate: (regionId) => {
      const prev = optimisticTreeUpdate(regionId, (node) => ({
        ...node,
        assignedDivisions: [],
        memberCount: 0,
        matchStatus: node.suggestions.length > 0 ? 'needs_review' : 'no_candidates',
      }));
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(treeKey, context.prev);
    },
    onSuccess: (_data, regionId) => invalidateStatsOnly(regionId),
  });

  // ── Hierarchy mutations ──────────────────────────────────────────────────

  const dismissMutation = useMutation({
    mutationFn: (regionId: number) => dismissChildren(worldViewId, regionId),
    onSuccess: (data) => {
      invalidateTree();
      if (data.undoAvailable) {
        setUndoSnackbar({
          open: true,
          message: `Dismissed ${data.dismissed} descendant(s)`,
          worldViewId,
        });
      }
    },
  });

  const pruneMutation = useMutation({
    mutationFn: (regionId: number) => pruneToLeaves(worldViewId, regionId),
    onSuccess: (data) => {
      invalidateTree();
      if (data.undoAvailable) {
        setUndoSnackbar({
          open: true,
          message: `Pruned ${data.pruned} grandchildren+ (kept direct children as leaves)`,
          worldViewId,
        });
      }
    },
  });

  const syncMutation = useMutation({
    mutationFn: (regionId: number) => syncInstances(worldViewId, regionId),
    onSuccess: () => invalidateTree(),
  });

  const groupingMutation = useMutation({
    mutationFn: (regionId: number) => handleAsGrouping(worldViewId, regionId),
    onSuccess: (data) => {
      invalidateTree();
      if (data.undoAvailable) {
        setUndoSnackbar({
          open: true,
          message: `Matched ${data.matched}/${data.total} children`,
          worldViewId,
        });
      }
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (regionId: number) => mergeChildIntoParent(worldViewId, regionId),
    onSuccess: () => invalidateTree(),
  });

  const smartFlattenMutation = useMutation({
    mutationFn: (regionId: number) => smartFlatten(worldViewId, regionId),
    onSuccess: (data) => {
      if (data.unmatched) {
        const names = data.unmatched.map(u => u.name).join(', ');
        setUndoSnackbar({
          open: true,
          message: `Cannot flatten: ${data.unmatched.length} unmatched: ${names}`,
          worldViewId,
        });
        invalidateTree();
        return;
      }
      invalidateTree();
      if (data.undoAvailable) {
        setUndoSnackbar({
          open: true,
          message: `Absorbed ${data.absorbed} children (${data.divisions} divisions)`,
          worldViewId,
        });
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: ({ regionId, reparentChildren, reparentDivisions }: { regionId: number; reparentChildren: boolean; reparentDivisions?: boolean }) =>
      removeRegionFromImport(worldViewId, regionId, reparentChildren, reparentDivisions),
    onSuccess: () => {
      deps.setRemoveDialogState(null);
      invalidateTree();
    },
  });

  const collapseToParentMutation = useMutation({
    mutationFn: (regionId: number) => collapseToParent(worldViewId, regionId),
    onSuccess: (data) => {
      invalidateTree();
      if (data.undoAvailable) {
        setUndoSnackbar({
          open: true,
          message: `Cleared ${data.collapsed} descendant(s), found ${data.parentSuggestions} suggestion(s) for parent`,
          worldViewId,
        });
      }
    },
  });

  const autoResolveMutation = useMutation({
    mutationFn: (regionId: number) => autoResolveChildren(worldViewId, regionId),
    onSuccess: (data) => {
      invalidateTree();
      if (data.undoAvailable) {
        const parts: string[] = [];
        if (data.resolved > 0) parts.push(`${data.resolved} auto-matched`);
        if (data.review > 0) parts.push(`${data.review} to review`);
        if (data.failed.length > 0) parts.push(`${data.failed.length} unmatched`);
        setUndoSnackbar({
          open: true,
          message: `Auto-resolve: ${parts.join(', ')} (${data.total} total)`,
          worldViewId,
        });
      }
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ regionId, name }: { regionId: number; name: string }) =>
      renameRegion(worldViewId, regionId, name),
    onSuccess: () => invalidateTree(),
  });

  const reparentMutation = useMutation({
    mutationFn: ({ regionId, newParentId }: { regionId: number; newParentId: number | null }) =>
      reparentRegion(worldViewId, regionId, newParentId),
    onSuccess: () => invalidateTree(),
  });

  const undoMutation = useMutation({
    mutationFn: () => undoLastOperation(worldViewId),
    onSuccess: () => {
      setUndoSnackbar(null);
      invalidateTree();
    },
  });

  // ── Map image & manual fix ───────────────────────────────────────────────

  const selectMapMutation = useMutation({
    mutationFn: ({ regionId, imageUrl }: { regionId: number; imageUrl: string | null }) =>
      selectMapImage(worldViewId, regionId, imageUrl),
    onSuccess: (_data, variables) => {
      const pickerState = deps.mapPickerStateRef.current;
      const pending = pickerState?.pendingPreview;
      const wikidataId = pickerState?.wikidataId;
      const pickerRegionId = pickerState?.regionId;
      deps.setMapPickerState(null);
      invalidateTree();
      if (pending) {
        deps.onPreview(
          pending.divisionId,
          pending.name,
          pending.path,
          variables.imageUrl ?? undefined,
          wikidataId ?? undefined,
          pickerRegionId,
          pending.isAssigned,
        );
      }
    },
  });

  const manualFixMutation = useMutation({
    mutationFn: ({ regionId, needsManualFix, fixNote }: { regionId: number; needsManualFix: boolean; fixNote?: string }) =>
      markManualFix(worldViewId, regionId, needsManualFix, fixNote),
    onSuccess: () => invalidateTree(),
  });

  // ── Hierarchy mutations (add child, dismiss warnings) ───────────────────

  const addChildMutation = useMutation({
    mutationFn: ({ parentRegionId, name }: { parentRegionId: number; name: string }) =>
      addChildRegion(worldViewId, parentRegionId, name),
    onSuccess: () => invalidateTree(),
  });

  const dismissWarningsMutation = useMutation({
    mutationFn: (regionId: number) => dismissHierarchyWarnings(worldViewId, regionId),
    onMutate: (regionId) => {
      const treeKey = ['admin', 'wvImport', 'matchTree', worldViewId] as const;
      const prev = queryClient.getQueryData<MatchTreeNode[]>(treeKey);
      if (prev) {
        function markReviewed(nodes: MatchTreeNode[]): MatchTreeNode[] {
          return nodes.map(n => {
            if (n.id === regionId) return { ...n, hierarchyReviewed: true };
            if (n.children.length > 0) return { ...n, children: markReviewed(n.children) };
            return n;
          });
        }
        queryClient.setQueryData(treeKey, markReviewed(prev));
      }
      return { prev };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchStats', worldViewId] });
    },
    onError: (_err, _regionId, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['admin', 'wvImport', 'matchTree', worldViewId], context.prev);
      }
    },
  });

  // ── Aggregate pending state ──────────────────────────────────────────────

  const isMutating =
    acceptMutation.isPending || rejectMutation.isPending || acceptAndRejectRestMutation.isPending ||
    dismissMutation.isPending || pruneMutation.isPending || syncMutation.isPending || groupingMutation.isPending ||
    geocodeMatchMutation.isPending || geoshapeMatchMutation.isPending || pointMatchMutation.isPending || resetMatchMutation.isPending || clearMembersMutation.isPending || rejectRemainingMutation.isPending ||
    acceptAllMutation.isPending || acceptSelectedMutation.isPending || acceptSelectedRejectRestMutation.isPending || rejectSelectedMutation.isPending ||
    selectMapMutation.isPending || manualFixMutation.isPending ||
    mergeMutation.isPending || smartFlattenMutation.isPending || addChildMutation.isPending ||
    dismissWarningsMutation.isPending || removeMutation.isPending || collapseToParentMutation.isPending ||
    autoResolveMutation.isPending ||
    renameMutation.isPending || reparentMutation.isPending;

  return {
    // Mutations
    acceptMutation,
    rejectMutation,
    rejectRemainingMutation,
    acceptAndRejectRestMutation,
    acceptAllMutation,
    acceptSelectedMutation,
    acceptSelectedRejectRestMutation,
    rejectSelectedMutation,
    dbSearchOneMutation,
    aiMatchOneMutation,
    geocodeMatchMutation,
    geoshapeMatchMutation,
    pointMatchMutation,
    resetMatchMutation,
    clearMembersMutation,
    dismissMutation,
    pruneMutation,
    syncMutation,
    groupingMutation,
    mergeMutation,
    smartFlattenMutation,
    removeMutation,
    collapseToParentMutation,
    autoResolveMutation,
    undoMutation,
    selectMapMutation,
    manualFixMutation,
    addChildMutation,
    dismissWarningsMutation,
    renameMutation,
    reparentMutation,
    renamingRegionId: renameMutation.isPending ? (renameMutation.variables?.regionId ?? null) : null,
    reparentingRegionId: reparentMutation.isPending ? (reparentMutation.variables?.regionId ?? null) : null,
    // State
    geocodeProgress,
    undoSnackbar,
    setUndoSnackbar,
    isMutating,
    invalidateTree,
  };
}
