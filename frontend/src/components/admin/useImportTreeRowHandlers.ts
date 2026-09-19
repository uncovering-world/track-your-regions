/**
 * The row's handlers, and which row each mutation is busy with.
 *
 * A tree row offers some thirty actions, and every one of them is a narrow
 * wrapper around a mutation — the JSX inlining them would be dozens of arrow
 * functions rebuilt per row per render, and the component that owns the tree
 * would carry them all. The same goes for the pending map: one memo, so a row
 * asks `pendingIds.mergingRegionId` rather than the JSX testing a mutation.
 *
 * Its own file beside `WorldViewImportTree.tsx`, which had reached the length
 * the lint draws the line at (#933). The caller destructures what it hands to
 * the rows, so the JSX reads exactly as it did.
 */

import { useCallback, useMemo } from 'react';
import type { useTreeMutations } from './useTreeMutations';
import type { useImportTreeDialogs } from './useImportTreeDialogs';

export function useImportTreeRowHandlers(
  mutations: ReturnType<typeof useTreeMutations>,
  dialogs: ReturnType<typeof useImportTreeDialogs>,
  setLastMutatedRegionId: (regionId: number) => void,
) {
  const {
    acceptAllMutation, acceptAndRejectRestMutation, acceptMutation,
    acceptSelectedMutation, acceptSelectedRejectRestMutation, aiMatchOneMutation,
    autoResolveMutation, clearMembersMutation, collapseToParentMutation,
    dbSearchOneMutation, dismissMutation, dismissWarningsMutation,
    geocodeMatchMutation, geoshapeMatchMutation, groupingMutation,
    mergeMutation, overlapCheckMutation, pointMatchMutation,
    pruneMutation, rejectMutation, rejectRemainingMutation,
    rejectSelectedMutation, removeMutation, resetMatchMutation,
    simplifyChildrenMutation, simplifyHierarchyMutation, smartFlattenMutation,
    syncMutation,
  } = mutations;

  // Each handler is a narrow wrapper around a mutation, so the tree's JSX in
  // `WorldViewImportTree.tsx` does not inline dozens of arrow functions in the
  // callback that maps its virtualised rows.
  const handleAccept = useCallback((regionId: number, divisionId: number) => {
    setLastMutatedRegionId(regionId);
    acceptMutation.mutate({ regionId, divisionId });
  }, [acceptMutation, setLastMutatedRegionId]);

  const handleAcceptAndRejectRest = useCallback((regionId: number, divisionId: number) => {
    setLastMutatedRegionId(regionId);
    acceptAndRejectRestMutation.mutate({ regionId, divisionId });
  }, [acceptAndRejectRestMutation, setLastMutatedRegionId]);

  const handleReject = useCallback((regionId: number, divisionId: number) => {
    rejectMutation.mutate({ regionId, divisionId });
  }, [rejectMutation]);

  const handleDBSearch = useCallback((regionId: number) => dbSearchOneMutation.mutate(regionId), [dbSearchOneMutation]);
  const handleAIMatch = useCallback((regionId: number) => aiMatchOneMutation.mutate(regionId), [aiMatchOneMutation]);
  const handleDismissChildren = useCallback((regionId: number) => dismissMutation.mutate(regionId), [dismissMutation]);
  const handleSync = useCallback((regionId: number) => syncMutation.mutate(regionId), [syncMutation]);
  const handleHandleAsGrouping = useCallback((regionId: number) => {
    setLastMutatedRegionId(regionId);
    groupingMutation.mutate(regionId);
  }, [groupingMutation, setLastMutatedRegionId]);
  const handleGeocodeMatch = useCallback((regionId: number) => geocodeMatchMutation.mutate(regionId), [geocodeMatchMutation]);
  const handleGeoshapeMatch = useCallback((regionId: number, scopeAncestorId?: number) =>
    geoshapeMatchMutation.mutate({ regionId, scopeAncestorId }), [geoshapeMatchMutation]);
  const handlePointMatch = useCallback((regionId: number, scopeAncestorId?: number) =>
    pointMatchMutation.mutate({ regionId, scopeAncestorId }), [pointMatchMutation]);
  const handleResetMatch = useCallback((regionId: number) => resetMatchMutation.mutate(regionId), [resetMatchMutation]);
  const handleRejectRemaining = useCallback((regionId: number) => rejectRemainingMutation.mutate(regionId), [rejectRemainingMutation]);

  const handleAcceptAll = useCallback((assignments: Array<{ regionId: number; divisionId: number }>) => {
    if (assignments[0]) setLastMutatedRegionId(assignments[0].regionId);
    acceptAllMutation.mutate(assignments);
  }, [acceptAllMutation, setLastMutatedRegionId]);

  const handleAcceptSelected = useCallback((regionId: number, divisionIds: number[]) => {
    setLastMutatedRegionId(regionId);
    acceptSelectedMutation.mutate({ regionId, divisionIds });
  }, [acceptSelectedMutation, setLastMutatedRegionId]);

  const handleAcceptSelectedRejectRest = useCallback((regionId: number, divisionIds: number[]) => {
    setLastMutatedRegionId(regionId);
    acceptSelectedRejectRestMutation.mutate({ regionId, divisionIds });
  }, [acceptSelectedRejectRestMutation, setLastMutatedRegionId]);

  const handleRejectSelected = useCallback((regionId: number, divisionIds: number[]) => {
    rejectSelectedMutation.mutate({ regionId, divisionIds });
  }, [rejectSelectedMutation]);

  const handleMergeChild = useCallback((regionId: number) => mergeMutation.mutate(regionId), [mergeMutation]);
  const handleDismissHierarchyWarnings = useCallback((regionId: number) => dismissWarningsMutation.mutate(regionId), [dismissWarningsMutation]);
  const handleCollapseToParent = useCallback((regionId: number) => collapseToParentMutation.mutate(regionId), [collapseToParentMutation]);
  const handleAutoResolve = useCallback((regionId: number) => autoResolveMutation.mutate(regionId), [autoResolveMutation]);
  const handleReviewSubtree = useCallback((regionId: number) => dialogs.handleReview(regionId), [dialogs]);

  const handleRename = useCallback((regionId: number, currentName: string) => {
    dialogs.setRenameDialog({ regionId, currentName, newName: currentName });
  }, [dialogs]);

  const handleReparent = useCallback((regionId: number) => {
    const region = dialogs.flatRegionList.find(r => r.id === regionId);
    dialogs.setReparentDialog({ regionId, regionName: region?.name ?? '', selectedParentId: null });
  }, [dialogs]);

  const handlePruneToLeaves = useCallback((regionId: number) => pruneMutation.mutate(regionId), [pruneMutation]);
  const handleClearMembers = useCallback((regionId: number) => clearMembersMutation.mutate(regionId), [clearMembersMutation]);

  // Which row each mutation is busy with, in one memo, so the tree's JSX asks
  // `pendingIds.mergingRegionId` rather than testing a mutation per row.
  const pendingIds = useMemo(() => {
    const simple = <V,>(m: { isPending: boolean; variables?: V }): V | null =>
      (m.isPending ? (m.variables ?? null) : null);
    const nested = <V,>(m: { isPending: boolean; variables?: { regionId?: V } }): V | null =>
      (m.isPending ? (m.variables?.regionId ?? null) : null);
    return {
      mergingRegionId: simple(mergeMutation),
      flatteningRegionId: dialogs.flattenPreviewLoading ?? simple(smartFlattenMutation),
      removingRegionId: nested(removeMutation),
      collapsingRegionId: simple(collapseToParentMutation),
      autoResolvingRegionId: simple(autoResolveMutation),
      reviewingRegionId: dialogs.reviewLoading?.key.startsWith('region-')
        ? Number(dialogs.reviewLoading.key.replace('region-', ''))
        : null,
      pruningRegionId: simple(pruneMutation),
      clearingMembersRegionId: simple(clearMembersMutation),
      simplifyingRegionId: simple(simplifyHierarchyMutation),
      simplifyingChildrenRegionId: simple(simplifyChildrenMutation),
      checkingOverlapRegionId: simple(overlapCheckMutation),
      dbSearchingRegionId: simple(dbSearchOneMutation),
      aiMatchingRegionId: simple(aiMatchOneMutation),
      dismissingRegionId: simple(dismissMutation),
      syncingRegionId: simple(syncMutation),
      groupingRegionId: simple(groupingMutation),
      geocodeMatchingRegionId: simple(geocodeMatchMutation),
      geoshapeMatchingRegionId: nested(geoshapeMatchMutation),
      pointMatchingRegionId: nested(pointMatchMutation),
    };
  }, [
    mergeMutation, smartFlattenMutation, removeMutation, collapseToParentMutation,
    autoResolveMutation, pruneMutation, clearMembersMutation, simplifyHierarchyMutation,
    simplifyChildrenMutation, overlapCheckMutation, dbSearchOneMutation, aiMatchOneMutation,
    dismissMutation, syncMutation, groupingMutation, geocodeMatchMutation,
    geoshapeMatchMutation, pointMatchMutation, dialogs.flattenPreviewLoading, dialogs.reviewLoading,
  ]);

  return {
    handleAIMatch, handleAccept, handleAcceptAll, handleAcceptAndRejectRest,
    handleAcceptSelected, handleAcceptSelectedRejectRest, handleAutoResolve, handleClearMembers,
    handleCollapseToParent, handleDBSearch, handleDismissChildren, handleDismissHierarchyWarnings,
    handleGeocodeMatch, handleGeoshapeMatch, handleHandleAsGrouping, handleMergeChild,
    handlePointMatch, handlePruneToLeaves, handleReject, handleRejectRemaining,
    handleRejectSelected, handleRename, handleReparent, handleResetMatch,
    handleReviewSubtree, handleSync,
    pendingIds,
  };
}
