/**
 * WorldView Import Tree View
 *
 * Virtualized hierarchical tree showing match results at the country level.
 * Uses @tanstack/react-virtual to render only visible rows (~40 at a time),
 * keeping the DOM lightweight even when hundreds of nodes are expanded.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Snackbar,
} from '@mui/material';

import {
  UnfoldMore as ExpandAllIcon,
  UnfoldLess as CollapseAllIcon,
  ErrorOutline as UnresolvedIcon,
  Layers as GapsIcon,
  CallMerge as SingleChildIcon,
  WarningAmber as WarningIcon,
  Psychology as ReviewIcon,
  PieChartOutline as CoverageIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import {
  getMatchTree,
  getChildrenCoverage,
  addChildRegion,
  removeRegionFromImport,
  renameRegion,
  type MatchTreeNode,
} from '../../api/admin/worldViewImport';
import { MapImagePickerDialog } from './MapImagePickerDialog';
import { SmartFlattenPreviewDialog } from './SmartFlattenPreviewDialog';
import { type ShadowInsertion } from './treeNodeShared';
import { TreeNodeRow } from './TreeNodeRow';
import { useTreeMutations, type MapPickerState } from './useTreeMutations';
import {
  ManualFixDialog, RemoveRegionDialog, CoverageCompareDialog,
  RenameRegionDialog, ReparentRegionDialog, AddChildDialog,
  AISuggestChildrenDialog, DivisionSearchDialog, GapAnalysisDialog,
} from './ImportTreeDialogs';
import { ShadowCreateRow, NavControls } from './GapAnalysis';
import { useCvMatchPipeline } from './useCvMatchPipeline';
import { useNavigationState } from './useNavigationState';
import { useImportTreeDialogs } from './useImportTreeDialogs';
import { CvMatchDialog } from './CvMatchDialog';
import { AIReviewDrawer } from './AIReviewDrawer';
import { SmartSimplifyDialog } from './SmartSimplifyDialog';
import { OverlapResolutionDialog } from './OverlapResolutionDialog';
import type { DivisionOverlapResult } from '../../api/admin/worldViewImport';

/** Find a child region's ID by name under a specific parent */
function findChildIdByName(nodes: MatchTreeNode[], parentId: number, childName: string): number | undefined {
  for (const node of nodes) {
    if (node.id === parentId) {
      return node.children.find(c => c.name === childName)?.id;
    }
    const found = findChildIdByName(node.children, parentId, childName);
    if (found) return found;
  }
  return undefined;
}

interface WorldViewImportTreeProps {
  worldViewId: number;
  onPreview: (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean, regionMapLabel?: string, regionName?: string) => void;
  onPreviewUnion?: (regionId: number, divisionIds: number[], context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string }) => void;
  onPreviewTransfer?: (divisionId: number, name: string, path: string | undefined, conflict: { donorDivisionId: number; donorDivisionName: string; donorRegionId: number; type: 'direct' | 'split' }, wikidataId: string, regionName: string, regionId?: number, allDivisionIds?: number[], allSuggestions?: Array<{ divisionId: number; conflict?: { donorDivisionId: number; donorRegionId: number; type: 'direct' | 'split' } }>) => void;
  onViewMap?: (regionId: number, context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string; divisionIds: number[] }) => void;
  shadowInsertions?: ShadowInsertion[];
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
  /** Called when division assignments change, so parent can mark coverage as stale */
  onMatchChange?: () => void;
}

export function WorldViewImportTree({ worldViewId, onPreview, onPreviewUnion, onPreviewTransfer, onViewMap, shadowInsertions, onApproveShadow, onRejectShadow, onMatchChange }: WorldViewImportTreeProps) {
  const [mapPickerState, setMapPickerState] = useState<MapPickerState | null>(null);
  const [removeDialogState, setRemoveDialogState] = useState<{
    regionId: number;
    regionName: string;
    hasChildren: boolean;
    hasDivisions: boolean;
  } | null>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'matchTree', worldViewId],
    queryFn: () => getMatchTree(worldViewId),
  });

  // Children coverage query (separate from tree to avoid slowing every tree load).
  // staleTime=Infinity: we manage updates manually via setQueryData in refreshCoverage,
  // so prevent TanStack Query from auto-refetching (which would recompute ALL containers).
  const { data: coverageData, isRefetching: coverageRefetching, isLoading: coverageLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'childrenCoverage', worldViewId],
    queryFn: () => getChildrenCoverage(worldViewId),
    staleTime: Infinity,
  });

  // Track which region was last mutated so we only show spinner on affected ancestors
  const [lastMutatedRegionId, setLastMutatedRegionId] = useState<number | null>(null);
  const [simplifySnackbar, setSimplifySnackbar] = useState<string | null>(null);
  const [overlapDialog, setOverlapDialog] = useState<{
    regionId: number;
    regionName: string;
    regionMapUrl: string | null;
    data: DivisionOverlapResult;
  } | null>(null);

  // Clear the dirty marker once coverage refetch completes
  useEffect(() => {
    if (!coverageRefetching && lastMutatedRegionId != null) {
      setLastMutatedRegionId(null);
    }
  }, [coverageRefetching, lastMutatedRegionId]);


  // Compute the set of ancestor IDs for the last mutated region
  const coverageDirtyIds = useMemo<ReadonlySet<number>>(() => {
    if (!coverageRefetching || lastMutatedRegionId == null || !tree) return new Set();
    // Build parent map from tree
    const parentOf = new Map<number, number | null>();
    const walkTree = (nodes: MatchTreeNode[], parentId: number | null) => {
      for (const n of nodes) {
        parentOf.set(n.id, parentId);
        walkTree(n.children, n.id);
      }
    };
    walkTree(tree, null);
    // Walk up from mutated region collecting ancestors
    const dirtyIds = new Set<number>();
    let current: number | null = lastMutatedRegionId;
    while (current != null) {
      dirtyIds.add(current);
      current = parentOf.get(current) ?? null;
    }
    return dirtyIds;
  }, [coverageRefetching, lastMutatedRegionId, tree]);

  // Ref for mapPickerState — needed by selectMapMutation to read pending preview
  const mapPickerStateRef = useRef(mapPickerState);
  mapPickerStateRef.current = mapPickerState;

  const mutations = useTreeMutations(worldViewId, {
    onPreview,
    mapPickerStateRef,
    setMapPickerState,
    setRemoveDialogState,
    onMatchChange,
  });

  const {
    acceptMutation, rejectMutation, rejectRemainingMutation, acceptAndRejectRestMutation,
    acceptAllMutation, acceptSelectedMutation, acceptSelectedRejectRestMutation, rejectSelectedMutation, onAcceptTransfer,
    dbSearchOneMutation, aiMatchOneMutation, geocodeMatchMutation, geoshapeMatchMutation, pointMatchMutation,
    resetMatchMutation, clearMembersMutation, dismissMutation, pruneMutation, syncMutation, groupingMutation, mergeMutation,
    smartFlattenMutation, removeMutation, collapseToParentMutation, autoResolveMutation, simplifyHierarchyMutation, simplifyChildrenMutation, overlapCheckMutation, undoMutation,
    selectMapMutation, manualFixMutation, addChildMutation,
    dismissWarningsMutation, renameMutation, reparentMutation,
    renamingRegionId, reparentingRegionId,
    geocodeProgress, undoSnackbar, setUndoSnackbar,
    isMutating, invalidateTree,
  } = mutations;

  // ── Extracted hooks ────────────────────────────────────────────────────────

  const dialogs = useImportTreeDialogs(worldViewId, tree, {
    renameMutation,
    reparentMutation,
    setRemoveDialogState,
    setUndoSnackbar,
    invalidateTree,
  });

  const cvPipeline = useCvMatchPipeline(worldViewId, tree, dialogs.handleSmartSimplify);

  const nav = useNavigationState(tree, shadowInsertions, coverageData);

  // ── Callbacks ──────────────────────────────────────────────────────────────

  const handleOpenMapPicker = useCallback((node: MatchTreeNode, pendingPreview?: { divisionId: number; name: string; path?: string; isAssigned: boolean }) => {
    setMapPickerState({
      regionId: node.id,
      regionName: node.name,
      candidates: node.mapImageCandidates,
      currentSelection: node.regionMapUrl,
      wikidataId: node.wikidataId,
      pendingPreview,
    });
  }, []);

  const handleSimplifyHierarchy = useCallback((regionId: number) => {
    simplifyHierarchyMutation.mutate(regionId, {
      onSuccess: (data) => {
        if (data.replacements.length === 0) {
          setSimplifySnackbar('Nothing to simplify');
        } else {
          const summary = data.replacements
            .map(r => `${r.parentName} (${r.replacedCount} → 1)`)
            .join(', ');
          setSimplifySnackbar(`Simplified: ${summary}`);
        }
      },
    });
  }, [simplifyHierarchyMutation]);

  const handleSimplifyChildren = useCallback((regionId: number) => {
    simplifyChildrenMutation.mutate(regionId, {
      onSuccess: (data) => {
        if (data.totalSimplified === 0) {
          setSimplifySnackbar('No children could be simplified');
        } else {
          const summary = data.results.map(r => `${r.regionName} (${r.totalReduced} reduced)`).join(', ');
          setSimplifySnackbar(`Simplified ${data.totalSimplified} children: ${summary}`);
        }
      },
    });
  }, [simplifyChildrenMutation]);

  const handleCheckOverlap = useCallback((regionId: number) => {
    // Find node in tree for name/mapUrl
    function findNode(nodes: MatchTreeNode[], id: number): MatchTreeNode | null {
      for (const n of nodes) {
        if (n.id === id) return n;
        const found = findNode(n.children, id);
        if (found) return found;
      }
      return null;
    }
    const node = tree ? findNode(tree, regionId) : null;
    overlapCheckMutation.mutate(regionId, {
      onSuccess: (data) => {
        if (data.overlaps.length === 0) {
          setSimplifySnackbar('No division overlaps found among children');
        } else {
          setOverlapDialog({
            regionId,
            regionName: node?.name ?? `Region ${regionId}`,
            regionMapUrl: node?.regionMapUrl ?? null,
            data,
          });
        }
      },
    });
  }, [overlapCheckMutation, tree]);

  // Build a pending promise for a single AI-suggested action
  const buildSuggestChildrenActionPromise = useCallback((
    parentId: number,
    action: { type: 'add' | 'remove' | 'rename' | 'enrich'; name: string; newName?: string; sourceUrl?: string | null; sourceExternalId?: string | null },
  ): Promise<unknown> | undefined => {
    if (action.type === 'add') {
      return addChildRegion(
        worldViewId, parentId, action.name,
        action.sourceUrl ?? undefined, action.sourceExternalId ?? undefined,
      );
    }
    if (action.type === 'remove') {
      const childId = tree ? findChildIdByName(tree, parentId, action.name) : undefined;
      if (!childId) return undefined;
      // Reparent both children AND assigned GADM divisions up to the parent;
      // otherwise CASCADE would silently delete `region_members` rows the admin
      // had already accepted.
      return removeRegionFromImport(worldViewId, childId, true, true);
    }
    // rename or enrich
    const childId = tree ? findChildIdByName(tree, parentId, action.name) : undefined;
    if (!childId) return undefined;
    return renameRegion(
      worldViewId, childId, action.newName ?? action.name,
      action.sourceUrl ?? undefined, action.sourceExternalId ?? undefined,
    );
  }, [worldViewId, tree]);

  // Handler bundle for TreeNodeRow, extracted to reduce complexity of the render
  // virtualization map callback below. Each handler is a narrow wrapper around a
  // mutation so the JSX doesn't inline dozens of arrow functions.
  const handleAccept = useCallback((regionId: number, divisionId: number) => {
    setLastMutatedRegionId(regionId);
    acceptMutation.mutate({ regionId, divisionId });
  }, [acceptMutation]);

  const handleAcceptAndRejectRest = useCallback((regionId: number, divisionId: number) => {
    setLastMutatedRegionId(regionId);
    acceptAndRejectRestMutation.mutate({ regionId, divisionId });
  }, [acceptAndRejectRestMutation]);

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
  }, [groupingMutation]);
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
  }, [acceptAllMutation]);

  const handleAcceptSelected = useCallback((regionId: number, divisionIds: number[]) => {
    setLastMutatedRegionId(regionId);
    acceptSelectedMutation.mutate({ regionId, divisionIds });
  }, [acceptSelectedMutation]);

  const handleAcceptSelectedRejectRest = useCallback((regionId: number, divisionIds: number[]) => {
    setLastMutatedRegionId(regionId);
    acceptSelectedRejectRestMutation.mutate({ regionId, divisionIds });
  }, [acceptSelectedRejectRestMutation]);

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

  // Compute pending region IDs for each mutation via a single memo, so the
  // JSX below doesn't need to inline dozens of ternaries (and the enclosing
  // component function stays under the cognitive-complexity cap).
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

  const handleContentResize = useCallback(() => {
    // Re-measure visible items after DOM update (don't use virtualizer.measure()
    // which clears ALL cached sizes and causes layout thrash)
    const measureVisibleElement = (el: HTMLElement) => {
      nav.virtualizer.measureElement(el);
    };
    const performMeasurements = () => {
      nav.parentRef.current?.querySelectorAll<HTMLElement>('[data-index]').forEach(measureVisibleElement);
    };
    requestAnimationFrame(performMeasurements);
  }, [nav]);

  const findNodeName = useCallback((regionId: number): string => {
    if (!tree) return '';
    const walk = (nodes: MatchTreeNode[]): string => {
      for (const n of nodes) {
        if (n.id === regionId) return n.name;
        const found = walk(n.children);
        if (found) return found;
      }
      return '';
    };
    return walk(tree);
  }, [tree]);

  const handleManualFix = useCallback((regionId: number, needsManualFix: boolean) => {
    if (needsManualFix) {
      dialogs.setFixDialogState({ regionId, regionName: findNodeName(regionId) });
    } else {
      manualFixMutation.mutate({ regionId, needsManualFix: false });
    }
  }, [dialogs, findNodeName, manualFixMutation]);

  const handleSuggestChildrenSubmit = useCallback(async () => {
    if (!dialogs.suggestChildrenResult) return;
    const { regionId: parentId, result, selected } = dialogs.suggestChildrenResult;
    dialogs.setSuggestChildrenResult(null);

    const promises: Promise<unknown>[] = [];
    for (const key of selected) {
      const colonIdx = key.indexOf(':');
      const type = key.slice(0, colonIdx);
      const name = key.slice(colonIdx + 1);
      const action = result.actions.find(a => a.type === type && a.name === name);
      if (!action) continue;
      const promise = buildSuggestChildrenActionPromise(parentId, action);
      if (promise) promises.push(promise);
    }

    const results = await Promise.allSettled(promises);
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      for (const f of failures) {
        console.error('[AI Review Children] action failed:', (f as PromiseRejectedResult).reason);
      }
      alert(`AI Review Children: ${failures.length} of ${results.length} action(s) failed. See browser console for details. The tree will refresh to reflect the partial result.`);
    }
    invalidateTree(parentId);
  }, [dialogs, buildSuggestChildrenActionPromise, invalidateTree]);

  // Compute which sourceUrls appear on multiple nodes (duplicates)
  // and which are already synced (same matchStatus and same division set)
  const { duplicateUrls, syncedUrls } = useMemo(() => {
    if (!tree) return { duplicateUrls: new Set<string>(), syncedUrls: new Set<string>() };
    const urlNodes = new Map<string, MatchTreeNode[]>();
    function walk(nodes: MatchTreeNode[]) {
      for (const node of nodes) {
        if (node.sourceUrl) {
          const existing = urlNodes.get(node.sourceUrl);
          if (existing) existing.push(node);
          else urlNodes.set(node.sourceUrl, [node]);
        }
        walk(node.children);
      }
    }
    walk(tree);
    const dups = new Set<string>();
    const synced = new Set<string>();
    for (const [url, nodes] of urlNodes) {
      if (nodes.length > 1) {
        dups.add(url);
        // Check if all instances have the same matchStatus and same set of divisionIds
        const refStatus = nodes[0].matchStatus;
        const refDivs = nodes[0].assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',');
        const allSame = nodes.every(n =>
          n.matchStatus === refStatus &&
          n.assignedDivisions.map(d => d.divisionId).sort((a, b) => a - b).join(',') === refDivs,
        );
        if (allSame) synced.add(url);
      }
    }
    return { duplicateUrls: dups, syncedUrls: synced };
  }, [tree]);

  // Build maps from node ID -> direct parent's regionMapUrl and name (for fallback in preview)
  const { parentRegionMapUrlById, parentRegionMapNameById } = useMemo(() => {
    const urlMap = new Map<number, string>();
    const nameMap = new Map<number, string>();
    if (!tree) return { parentRegionMapUrlById: urlMap, parentRegionMapNameById: nameMap };
    function walk(nodes: MatchTreeNode[], parentMapUrl: string | null, parentMapName: string | null) {
      for (const node of nodes) {
        if (parentMapUrl) urlMap.set(node.id, parentMapUrl);
        if (parentMapName) nameMap.set(node.id, parentMapName);
        // Only pass THIS node's own map to children — don't propagate inherited ancestor maps
        walk(node.children, node.regionMapUrl ?? null, node.regionMapUrl ? node.name : null);
      }
    }
    walk(tree, null, null);
    return { parentRegionMapUrlById: urlMap, parentRegionMapNameById: nameMap };
  }, [tree]);

  // Render nav-category toolbar: either NavControls (when active) or a count button.
  // Extracted to keep the component body's cognitive complexity under the cap.
  const renderNavCategoryButton = (params: {
    category: 'unresolved' | 'warnings' | 'single-child' | 'incomplete-coverage';
    ids: ReadonlyArray<number>;
    label: string;
    icon: React.ReactNode;
    buttonText: string;
    buttonColor?: 'warning' | 'info' | 'secondary' | 'error' | 'inherit';
    buttonSx?: { color: string };
  }) => {
    if (params.ids.length === 0) return null;
    if (nav.activeNav?.category === params.category) {
      return (
        <NavControls
          label={params.label}
          idx={nav.activeNav.idx}
          total={params.ids.length}
          onPrev={() => nav.navigateTo(params.category, nav.activeNav!.idx - 1)}
          onNext={() => nav.navigateTo(params.category, nav.activeNav!.idx + 1)}
          onClose={() => nav.setActiveNav(null)}
        />
      );
    }
    return (
      <Button
        size="small"
        startIcon={params.icon}
        onClick={() => nav.navigateTo(params.category, 0)}
        color={params.buttonColor}
        sx={params.buttonSx}
      >
        {params.buttonText}
      </Button>
    );
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!tree || tree.length === 0) {
    return <Typography color="text.secondary">No regions found.</Typography>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 250px)' }}>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" startIcon={<ExpandAllIcon />} onClick={nav.expandAll}>
          Expand All
        </Button>
        <Button size="small" startIcon={<CollapseAllIcon />} onClick={nav.collapseAll}>
          Collapse All
        </Button>
        {renderNavCategoryButton({
          category: 'unresolved',
          ids: nav.unresolvedIds,
          label: 'unresolved',
          icon: <UnresolvedIcon />,
          buttonText: `${nav.unresolvedIds.length} Unresolved`,
          buttonColor: 'warning',
        })}
        {shadowInsertions && shadowInsertions.length > 0 && (
          <Button size="small" startIcon={<GapsIcon />} onClick={nav.expandToShadows} color="info">
            Show {shadowInsertions.length} Gap{shadowInsertions.length !== 1 ? 's' : ''} to Review
          </Button>
        )}
        {renderNavCategoryButton({
          category: 'warnings',
          ids: nav.warningIds,
          label: 'warnings',
          icon: <WarningIcon />,
          buttonText: `${nav.warningIds.length} Hierarchy Warning${nav.warningIds.length !== 1 ? 's' : ''}`,
          buttonSx: { color: 'warning.main' },
        })}
        {renderNavCategoryButton({
          category: 'single-child',
          ids: nav.singleChildIds,
          label: 'single-child',
          icon: <SingleChildIcon />,
          buttonText: `${nav.singleChildIds.length} Single-Child`,
          buttonColor: 'secondary',
        })}
        {renderNavCategoryButton({
          category: 'incomplete-coverage',
          ids: nav.incompleteCoverageIds,
          label: 'incomplete coverage',
          icon: <CoverageIcon />,
          buttonText: `${nav.incompleteCoverageIds.length} Incomplete Coverage`,
          buttonColor: 'error',
        })}
        <Button
          size="small"
          startIcon={dialogs.reviewLoading ? <CircularProgress size={14} /> : <ReviewIcon />}
          onClick={() => dialogs.handleReview()}
          disabled={!!dialogs.reviewLoading}
        >
          AI Review
        </Button>
      </Box>

      {/* Virtualized scroll container */}
      <Box ref={nav.parentRef} sx={{ flex: 1, overflow: 'auto' }}>
        <Box sx={{ height: nav.virtualizer.getTotalSize(), position: 'relative' }}>
          {nav.virtualizer.getVirtualItems().map(virtualRow => {
            const item = nav.flatItems[virtualRow.index];
            return (
              <Box
                key={virtualRow.key}
                ref={nav.virtualizer.measureElement}
                data-index={virtualRow.index}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.kind === 'node' ? (
                  <TreeNodeRow
                    node={item.node}
                    depth={item.depth}
                    expanded={nav.expanded}
                    ancestorIsMatched={item.ancestorIsMatched}
                    highlightedRegionId={nav.highlightedRegionId}
                    onToggle={nav.toggleExpand}
                    onAccept={handleAccept}
                    onAcceptTransfer={onAcceptTransfer}
                    onAcceptAndRejectRest={handleAcceptAndRejectRest}
                    onReject={handleReject}
                    onDBSearch={handleDBSearch}
                    onAIMatch={handleAIMatch}
                    onDismissChildren={handleDismissChildren}
                    onSync={handleSync}
                    onHandleAsGrouping={handleHandleAsGrouping}
                    onGeocodeMatch={handleGeocodeMatch}
                    onGeoshapeMatch={handleGeoshapeMatch}
                    onPointMatch={handlePointMatch}
                    onResetMatch={handleResetMatch}
                    onRejectRemaining={handleRejectRemaining}
                    onAcceptAll={handleAcceptAll}
                    onPreviewUnion={onPreviewUnion}
                    onPreviewTransfer={onPreviewTransfer}
                    onAcceptSelected={handleAcceptSelected}
                    onAcceptSelectedRejectRest={handleAcceptSelectedRejectRest}
                    onRejectSelected={handleRejectSelected}
                    onPreview={onPreview}
                    onOpenMapPicker={handleOpenMapPicker}
                    onMergeChild={handleMergeChild}
                    mergingRegionId={pendingIds.mergingRegionId}
                    onSmartFlatten={dialogs.handleSmartFlatten}
                    flatteningRegionId={pendingIds.flatteningRegionId}
                    onDismissHierarchyWarnings={handleDismissHierarchyWarnings}
                    onAddChild={dialogs.handleAddChild}
                    onRemoveRegion={dialogs.handleRemoveRegion}
                    removingRegionId={pendingIds.removingRegionId}
                    onCollapseToParent={handleCollapseToParent}
                    collapsingRegionId={pendingIds.collapsingRegionId}
                    onAutoResolve={handleAutoResolve}
                    autoResolvingRegionId={pendingIds.autoResolvingRegionId}
                    onReviewSubtree={handleReviewSubtree}
                    reviewingRegionId={pendingIds.reviewingRegionId}
                    onRename={handleRename}
                    renamingRegionId={renamingRegionId}
                    onReparent={handleReparent}
                    reparentingRegionId={reparentingRegionId}
                    onAISuggestChildren={dialogs.handleAISuggestChildren}
                    aiSuggestingRegionId={dialogs.aiSuggestingRegionId}
                    onManualDivisionSearch={dialogs.handleManualDivisionSearch}
                    onPruneToLeaves={handlePruneToLeaves}
                    pruningRegionId={pendingIds.pruningRegionId}
                    onViewMap={onViewMap}
                    onCVMatch={cvPipeline.handleCVMatch}
                    cvMatchingRegionId={cvPipeline.cvMatchingRegionId}
                    onMapshapeMatch={cvPipeline.handleMapshapeMatch}
                    mapshapeMatchingRegionId={cvPipeline.mapshapeMatchingRegionId}
                    onClearMembers={handleClearMembers}
                    clearingMembersRegionId={pendingIds.clearingMembersRegionId}
                    onSimplifyHierarchy={handleSimplifyHierarchy}
                    simplifyingRegionId={pendingIds.simplifyingRegionId}
                    onSimplifyChildren={handleSimplifyChildren}
                    simplifyingChildrenRegionId={pendingIds.simplifyingChildrenRegionId}
                    onSmartSimplify={dialogs.handleSmartSimplify}
                    onCheckOverlap={handleCheckOverlap}
                    checkingOverlapRegionId={pendingIds.checkingOverlapRegionId}
                    coverageData={coverageData?.coverage}
                    coverageLoading={coverageLoading}
                    coverageDirtyIds={coverageDirtyIds}
                    onCoverageClick={dialogs.handleCoverageClick}
                    onContentResize={handleContentResize}
                    onManualFix={handleManualFix}
                    isMutating={isMutating}
                    dbSearchingRegionId={pendingIds.dbSearchingRegionId}
                    aiMatchingRegionId={pendingIds.aiMatchingRegionId}
                    dismissingRegionId={pendingIds.dismissingRegionId}
                    syncingRegionId={pendingIds.syncingRegionId}
                    groupingRegionId={pendingIds.groupingRegionId}
                    geocodeMatchingRegionId={pendingIds.geocodeMatchingRegionId}
                    geoshapeMatchingRegionId={pendingIds.geoshapeMatchingRegionId}
                    pointMatchingRegionId={pendingIds.pointMatchingRegionId}
                    parentRegionMapUrl={parentRegionMapUrlById.get(item.node.id)}
                    parentRegionMapName={parentRegionMapNameById.get(item.node.id)}
                    geocodeProgress={geocodeProgress}
                    duplicateUrls={duplicateUrls}
                    syncedUrls={syncedUrls}
                    shadowsByRegionId={nav.shadowsByRegionId}
                    onApproveShadow={onApproveShadow}
                    onRejectShadow={onRejectShadow}
                  />
                ) : (
                  <ShadowCreateRow
                    shadow={item.shadow}
                    depth={item.depth}
                    onApproveShadow={onApproveShadow}
                    onRejectShadow={onRejectShadow}
                    isMutating={isMutating}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Dialogs rendered outside the scroll container */}
      {mapPickerState && (
        <MapImagePickerDialog
          open
          regionName={mapPickerState.regionName}
          candidates={mapPickerState.candidates}
          currentSelection={mapPickerState.currentSelection}
          onSelect={(imageUrl) => selectMapMutation.mutate({ regionId: mapPickerState.regionId, imageUrl })}
          onClose={() => setMapPickerState(null)}
          loading={selectMapMutation.isPending}
        />
      )}
      <Snackbar
        open={!!undoSnackbar?.open}
        autoHideDuration={15000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setUndoSnackbar(null);
        }}
        message={undoSnackbar?.message}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => undoMutation.mutate()}
            disabled={undoMutation.isPending}
          >
            Undo
          </Button>
        }
      />
      <Snackbar
        open={simplifySnackbar !== null}
        autoHideDuration={simplifySnackbar && simplifySnackbar.includes('\n') ? 15000 : 6000}
        onClose={() => setSimplifySnackbar(null)}
        message={simplifySnackbar}
        slotProps={{ content: { sx: { whiteSpace: 'pre-line', maxWidth: 600 } } }}
      />
      <ManualFixDialog
        state={dialogs.fixDialogState}
        onClose={() => dialogs.setFixDialogState(null)}
        onSubmit={(regionId, note) => manualFixMutation.mutate({ regionId, needsManualFix: true, fixNote: note })}
        isPending={manualFixMutation.isPending}
      />
      <RemoveRegionDialog
        state={removeDialogState}
        onClose={() => setRemoveDialogState(null)}
        onConfirm={(regionId, reparentChildren, reparentDivisions) => removeMutation.mutate({ regionId, reparentChildren, reparentDivisions })}
        isPending={removeMutation.isPending}
      />
      {/* CV color match dialog with SSE progress + suggestions */}
      <CvMatchDialog
        cvMatchDialog={cvPipeline.cvMatchDialog}
        setCVMatchDialog={cvPipeline.setCVMatchDialog}
        onClose={() => cvPipeline.cancelCvMatch()}
        highlightClusterId={cvPipeline.highlightClusterId}
        setHighlightClusterId={cvPipeline.setHighlightClusterId}
        worldViewId={worldViewId}
        invalidateTree={invalidateTree}
        aiModelOverride={cvPipeline.aiModelOverride}
        setAiModelOverride={cvPipeline.setAiModelOverride}
        modelPickerOpen={cvPipeline.modelPickerOpen}
        setModelPickerOpen={cvPipeline.setModelPickerOpen}
        modelPickerModels={cvPipeline.modelPickerModels}
        setModelPickerModels={cvPipeline.setModelPickerModels}
        modelPickerGlobal={cvPipeline.modelPickerGlobal}
        setModelPickerGlobal={cvPipeline.setModelPickerGlobal}
        modelPickerSelected={cvPipeline.modelPickerSelected}
        setModelPickerSelected={cvPipeline.setModelPickerSelected}
      />
      <AddChildDialog
        parentRegionId={dialogs.addChildDialogRegionId}
        name={dialogs.addChildName}
        onNameChange={dialogs.setAddChildName}
        onClose={() => { dialogs.setAddChildDialogRegionId(null); dialogs.setAddChildName(''); }}
        onSubmit={() => {
          if (dialogs.addChildDialogRegionId && dialogs.addChildName.trim()) {
            addChildMutation.mutate({ parentRegionId: dialogs.addChildDialogRegionId, name: dialogs.addChildName.trim() });
            dialogs.setAddChildDialogRegionId(null);
            dialogs.setAddChildName('');
          }
        }}
        isPending={addChildMutation.isPending}
      />
      <SmartFlattenPreviewDialog
        open={dialogs.flattenPreview != null}
        regionName={dialogs.flattenPreview?.regionName ?? ''}
        geometry={dialogs.flattenPreview?.geometry ?? null}
        regionMapUrl={dialogs.flattenPreview?.regionMapUrl ?? null}
        descendants={dialogs.flattenPreview?.descendants ?? 0}
        divisions={dialogs.flattenPreview?.divisions ?? 0}
        onConfirm={() => {
          if (dialogs.flattenPreview) {
            smartFlattenMutation.mutate(dialogs.flattenPreview.regionId);
            dialogs.setFlattenPreview(null);
          }
        }}
        onCancel={() => dialogs.setFlattenPreview(null)}
        confirming={smartFlattenMutation.isPending}
      />
      {dialogs.smartSimplifyDialog && (
        <SmartSimplifyDialog
          open
          onClose={() => dialogs.setSmartSimplifyDialog(null)}
          worldViewId={worldViewId}
          parentRegionId={dialogs.smartSimplifyDialog.regionId}
          parentRegionName={dialogs.smartSimplifyDialog.regionName}
          regionMapUrl={dialogs.smartSimplifyDialog.regionMapUrl}
          onApplied={() => invalidateTree(dialogs.smartSimplifyDialog?.regionId)}
        />
      )}
      {overlapDialog && (
        <OverlapResolutionDialog
          open
          onClose={() => setOverlapDialog(null)}
          worldViewId={worldViewId}
          parentRegionId={overlapDialog.regionId}
          parentRegionName={overlapDialog.regionName}
          regionMapUrl={overlapDialog.regionMapUrl}
          overlapData={overlapDialog.data}
          onApplied={() => invalidateTree(overlapDialog.regionId)}
        />
      )}
      <AISuggestChildrenDialog
        state={dialogs.suggestChildrenResult}
        onClose={() => dialogs.setSuggestChildrenResult(null)}
        onToggle={(key) => {
          dialogs.setSuggestChildrenResult(prev => {
            if (!prev) return prev;
            const next = new Set(prev.selected);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return { ...prev, selected: next };
          });
        }}
        onSubmit={handleSuggestChildrenSubmit}
        isPending={false}
      />
      <CoverageCompareDialog
        data={dialogs.coverageCompare}
        onClose={() => dialogs.setCoverageCompare(null)}
        onAnalyzeGaps={dialogs.handleAnalyzeGaps}
      />
      {dialogs.gapAnalysis && (
        <GapAnalysisDialog
          state={dialogs.gapAnalysis}
          tree={tree}
          worldViewId={worldViewId}
          highlightedGapId={dialogs.highlightedGapId}
          setHighlightedGapId={dialogs.setHighlightedGapId}
          gapMapSelectedRegionId={dialogs.gapMapSelectedRegionId}
          setGapMapSelectedRegionId={dialogs.setGapMapSelectedRegionId}
          onClose={() => { dialogs.setGapAnalysis(null); dialogs.setGapMapSelectedRegionId(null); invalidateTree(); }}
          setLastMutatedRegionId={setLastMutatedRegionId}
          acceptAllMutation={acceptAllMutation}
          addChildMutation={addChildMutation}
          isMutating={isMutating}
        />
      )}
      <DivisionSearchDialog
        state={dialogs.divisionSearchDialog}
        onClose={() => dialogs.setDivisionSearchDialog(null)}
        onSelect={(divisionId) => {
          if (dialogs.divisionSearchDialog) {
            setLastMutatedRegionId(dialogs.divisionSearchDialog.regionId);
            acceptAllMutation.mutate([{
              regionId: dialogs.divisionSearchDialog.regionId,
              divisionId,
            }]);
            dialogs.setDivisionSearchDialog(null);
          }
        }}
        query={dialogs.divSearchQuery}
        results={dialogs.divSearchResults}
        loading={dialogs.divSearchLoading}
        onInputChange={dialogs.handleDivSearchInput}
      />
      <RenameRegionDialog
        state={dialogs.renameDialog}
        onClose={() => dialogs.setRenameDialog(null)}
        onSubmit={dialogs.handleRenameSubmit}
        onNameChange={(value) => dialogs.setRenameDialog(prev => prev ? { ...prev, newName: value } : prev)}
      />
      <ReparentRegionDialog
        state={dialogs.reparentDialog}
        onClose={() => dialogs.setReparentDialog(null)}
        onSubmit={dialogs.handleReparentSubmit}
        onParentChange={(parentId) => dialogs.setReparentDialog(prev => prev ? { ...prev, selectedParentId: parentId } : prev)}
        flatRegionList={dialogs.flatRegionList}
      />
      {/* AI Hierarchy Review Drawer */}
      <AIReviewDrawer
        activeReviewKey={dialogs.activeReviewKey}
        setActiveReviewKey={dialogs.setActiveReviewKey}
        reviewReports={dialogs.reviewReports}
        setReviewReports={dialogs.setReviewReports}
        reviewLoading={dialogs.reviewLoading}
        handleReview={dialogs.handleReview}
        regionNameRegex={dialogs.regionNameRegex}
        regionNameToId={dialogs.regionNameToId}
        navigateToRegion={nav.navigateToRegion}
      />
    </Box>
  );
}
