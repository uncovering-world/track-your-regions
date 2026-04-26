/**
 * WorldView Import Tree View
 *
 * Clean hierarchical tree showing match results at the country level.
 * Containers (continents, sub-regions) show summary counts.
 * Countries show their match status and GADM assignment.
 * Children of drilled-down regions appear as regular country nodes.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
  Link as MuiLink,
} from '@mui/material';

import {
  UnfoldMore as ExpandAllIcon,
  UnfoldLess as CollapseAllIcon,
  ErrorOutline as UnresolvedIcon,
  Layers as GapsIcon,
  Link as LinkIcon,
  ArrowForward as ArrowForwardIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMatchTree,
  acceptMatch,
  acceptBatchMatches,
  rejectSuggestion,
  dbSearchOneRegion,
  aiMatchOneRegion,
  aiReviewChildren,
  addChildRegion,
  removeRegionFromImport,
  renameRegion,
  dismissChildren,
  simplifyHierarchy,
  simplifyChildren,
  undoLastOperation,
  syncInstances,
  handleAsGrouping,
  geocodeMatchRegion,
  geoshapeMatchRegion,
  pointMatchRegion,
  resetMatchRegion,
  rejectRemaining,
  acceptAndRejectRest as acceptAndRejectRestApi,
  selectMapImage,
  markManualFix,
  acceptWithTransfer as acceptWithTransferApi,
  type MatchTreeNode,
  type AIReviewChildrenResult,
  type ReviewChildAction,
} from '../../api/admin/worldViewImport';
import { MapImagePickerDialog } from './MapImagePickerDialog';
import { SmartSimplifyDialog } from './SmartSimplifyDialog';
import { useCvMatchPipeline } from './useCvMatchPipeline';
import { CvMatchDialog } from './CvMatchDialog';
import { type ShadowInsertion } from './treeNodeShared';
import { TreeNodeRow } from './TreeNodeRow';
import { collectAncestorsOfUnresolved, collectAncestorsOfIds } from './importTreeUtils';

/** Extracted to avoid re-rendering the entire tree on every keystroke */
function ManualFixDialog({ state, onClose, onSubmit, isPending }: {
  state: { regionId: number; regionName: string } | null;
  onClose: () => void;
  onSubmit: (regionId: number, fixNote: string | undefined) => void;
  isPending: boolean;
}) {
  const [fixNote, setFixNote] = useState('');

  // Reset note when dialog opens with a new region
  const prevRegionId = state?.regionId;
  const [lastRegionId, setLastRegionId] = useState<number | undefined>();
  if (prevRegionId !== lastRegionId) {
    setLastRegionId(prevRegionId);
    if (prevRegionId != null) setFixNote('');
  }

  return (
    <Dialog open={!!state} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Mark as Needing Manual Fix</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {state?.regionName}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          label="What needs to be fixed?"
          placeholder="e.g., Borders don't match GADM, need to split into sub-regions..."
          value={fixNote}
          onChange={(e) => setFixNote(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => {
            if (state) {
              onSubmit(state.regionId, fixNote || undefined);
              onClose();
            }
          }}
          disabled={isPending}
        >
          Mark for Fix
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface WorldViewImportTreeProps {
  worldViewId: number;
  onPreview: (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean, markerPoints?: Array<{ name: string; lat: number; lon: number }>) => void;
  onPreviewTransfer?: (divisionId: number, name: string, path: string | undefined, conflict: { donorDivisionId: number; donorDivisionName: string; donorRegionId: number; type: 'direct' | 'split' }, wikidataId: string, regionName: string, regionId?: number, allDivisionIds?: number[]) => void;
  shadowInsertions?: ShadowInsertion[];
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
}

export function WorldViewImportTree({ worldViewId, onPreview, onPreviewTransfer, shadowInsertions, onApproveShadow, onRejectShadow }: WorldViewImportTreeProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const skipAnimationRef = useRef(false);
  const [geocodeProgress, setGeocodeProgress] = useState<{ regionId: number; message: string; nextScope?: { ancestorId: number; ancestorName: string }; retryType?: 'geoshape' | 'point' } | null>(null);
  const [fixDialogState, setFixDialogState] = useState<{ regionId: number; regionName: string } | null>(null);
  const [mapPickerState, setMapPickerState] = useState<{
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
  } | null>(null);

  const [undoSnackbar, setUndoSnackbar] = useState<{
    open: boolean;
    message: string;
    worldViewId: number;
  } | null>(null);

  const [smartSimplifyDialog, setSmartSimplifyDialog] = useState<{
    regionId: number;
    regionName: string;
    regionMapUrl: string | null;
  } | null>(null);

  const [aiReviewDialog, setAIReviewDialog] = useState<{
    regionId: number;
    regionName: string;
    result: AIReviewChildrenResult;
    selected: Set<string>;
  } | null>(null);
  const [aiSuggestingRegionId, setAISuggestingRegionId] = useState<number | null>(null);

  /** Find a child region ID by name under a specific parent node */
  function findChildIdByName(nodes: MatchTreeNode[], parentId: number, childName: string): number | undefined {
    for (const node of nodes) {
      if (node.id === parentId) {
        return node.children.find(c => c.name === childName)?.id;
      }
      const found = findChildIdByName(node.children, parentId, childName);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const { data: tree, isLoading } = useQuery({
    queryKey: ['admin', 'wvImport', 'matchTree', worldViewId],
    queryFn: () => getMatchTree(worldViewId),
  });

  const invalidateTree = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchStats', worldViewId] });
  };

  const {
    cvMatchDialog,
    setCVMatchDialog,
    cvMatchingRegionId,
    mapshapeMatchingRegionId,
    handleCVMatch,
    handleMapshapeMatch,
    cancelCvMatch,
  } = useCvMatchPipeline(worldViewId, tree, (regionId) => {
    // Invalidate tree when CV match completes so match status refreshes
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchTree', worldViewId] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'wvImport', 'matchStats', worldViewId] });
    // Expand the node so newly assigned divisions are visible
    setExpanded(prev => new Set([...prev, regionId]));
  });

  const acceptMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      acceptMatch(worldViewId, regionId, divisionId),
    onSuccess: invalidateTree,
  });

  const rejectMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      rejectSuggestion(worldViewId, regionId, divisionId),
    onSuccess: invalidateTree,
  });

  const dbSearchOneMutation = useMutation({
    mutationFn: (regionId: number) => dbSearchOneRegion(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

  const aiMatchOneMutation = useMutation({
    mutationFn: (regionId: number) => aiMatchOneRegion(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

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

  const simplifyHierarchyMutation = useMutation({
    mutationFn: (regionId: number) => simplifyHierarchy(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

  const simplifyChildrenMutation = useMutation({
    mutationFn: (parentRegionId: number) => simplifyChildren(worldViewId, parentRegionId),
    onSuccess: invalidateTree,
  });

  const syncMutation = useMutation({
    mutationFn: (regionId: number) => syncInstances(worldViewId, regionId),
    onSuccess: invalidateTree,
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

  const undoMutation = useMutation({
    mutationFn: () => undoLastOperation(worldViewId),
    onSuccess: () => {
      setUndoSnackbar(null);
      invalidateTree();
    },
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
      invalidateTree();
      setTimeout(() => setGeocodeProgress(null), 4000);
    },
    onError: () => {
      setGeocodeProgress(null);
    },
  });

  const geoshapeMatchMutation = useMutation({
    mutationFn: ({ regionId, scopeAncestorId }: { regionId: number; scopeAncestorId?: number }) =>
      geoshapeMatchRegion(worldViewId, regionId, scopeAncestorId),
    onMutate: ({ regionId }) => {
      setGeocodeProgress({ regionId, message: 'Matching by geoshape...' });
    },
    onSuccess: (data, { regionId }) => {
      const coverageMsg = data.totalCoverage != null
        ? ` (${Math.round(data.totalCoverage * 100)}% coverage)`
        : '';
      if (data.found > 0) {
        setGeocodeProgress({
          regionId,
          message: `Covering set: ${data.found} division(s)${coverageMsg}`,
        });
        setTimeout(() => setGeocodeProgress(null), 4000);
      } else if (data.nextScope) {
        setGeocodeProgress({
          regionId,
          message: `No matches in ${data.scopeAncestorName ?? 'current'} scope`,
          nextScope: data.nextScope,
          retryType: 'geoshape',
        });
        // Do NOT auto-dismiss — user needs to decide
      } else {
        setGeocodeProgress({
          regionId,
          message: 'No geoshape matches found',
        });
        setTimeout(() => setGeocodeProgress(null), 4000);
      }
      invalidateTree();
    },
    onError: () => {
      setGeocodeProgress(null);
    },
  });

  const acceptTransferMutation = useMutation({
    mutationFn: ({ regionId, divisionIds, donorRegionId, donorDivisionId, transferType }: {
      regionId: number; divisionIds: number[]; donorRegionId: number; donorDivisionId: number; transferType: 'direct' | 'split';
    }) => acceptWithTransferApi(worldViewId, regionId, divisionIds, donorRegionId, donorDivisionId, transferType),
    onSuccess: (_data, { regionId }) => {
      invalidateTree();
      if (regionId) setGeocodeProgress(null);
    },
  });

  const onAcceptTransfer = (regionId: number, divisionId: number, conflict: { type: 'direct' | 'split'; donorRegionId: number; donorDivisionId: number }) =>
    acceptTransferMutation.mutate({
      regionId,
      divisionIds: [divisionId],
      donorRegionId: conflict.donorRegionId,
      donorDivisionId: conflict.donorDivisionId,
      transferType: conflict.type,
    });

  const pointMatchMutation = useMutation({
    mutationFn: ({ regionId, scopeAncestorId }: { regionId: number; scopeAncestorId?: number }) =>
      pointMatchRegion(worldViewId, regionId, scopeAncestorId),
    onMutate: ({ regionId }) => {
      setGeocodeProgress({ regionId, message: 'Matching by markers...' });
    },
    onSuccess: (data, { regionId }) => {
      if (data.found > 0) {
        setGeocodeProgress({
          regionId,
          message: `Found ${data.found} division(s) from markers`,
        });
        setTimeout(() => setGeocodeProgress(null), 4000);
      } else if (data.nextScope) {
        setGeocodeProgress({
          regionId,
          message: `No marker matches in ${data.scopeAncestorName ?? 'current'} scope`,
          nextScope: data.nextScope,
          retryType: 'point',
        });
      } else {
        setGeocodeProgress({
          regionId,
          message: 'No divisions found from markers',
        });
        setTimeout(() => setGeocodeProgress(null), 4000);
      }
      invalidateTree();
    },
    onError: () => {
      setGeocodeProgress(null);
    },
  });

  const resetMatchMutation = useMutation({
    mutationFn: (regionId: number) => resetMatchRegion(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

  const rejectRemainingMutation = useMutation({
    mutationFn: (regionId: number) => rejectRemaining(worldViewId, regionId),
    onSuccess: invalidateTree,
  });

  const acceptAndRejectRestMutation = useMutation({
    mutationFn: ({ regionId, divisionId }: { regionId: number; divisionId: number }) =>
      acceptAndRejectRestApi(worldViewId, regionId, divisionId),
    onSuccess: invalidateTree,
  });

  const acceptAllMutation = useMutation({
    mutationFn: (assignments: Array<{ regionId: number; divisionId: number }>) =>
      acceptBatchMatches(worldViewId, assignments),
    onSuccess: invalidateTree,
  });

  const selectMapMutation = useMutation({
    mutationFn: ({ regionId, imageUrl }: { regionId: number; imageUrl: string | null }) =>
      selectMapImage(worldViewId, regionId, imageUrl),
    onSuccess: (_data, variables) => {
      const pending = mapPickerState?.pendingPreview;
      const wikidataId = mapPickerState?.wikidataId;
      const pickerRegionId = mapPickerState?.regionId;
      setMapPickerState(null);
      invalidateTree();
      // If preview was intercepted, proceed to the regular preview now
      if (pending) {
        onPreview(
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
    onSuccess: invalidateTree,
  });

  const handleSmartSimplify = useCallback((regionId: number) => {
    if (!tree) return;
    const findNode = (nodes: MatchTreeNode[]): MatchTreeNode | null => {
      for (const n of nodes) {
        if (n.id === regionId) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    };
    const node = findNode(tree);
    if (!node) return;
    setSmartSimplifyDialog({
      regionId,
      regionName: node.name,
      regionMapUrl: node.regionMapUrl,
    });
  }, [tree]);

  const handleAIReviewChildren = useCallback(async (regionId: number) => {
    if (!tree) return;
    const findNode = (nodes: MatchTreeNode[]): MatchTreeNode | null => {
      for (const n of nodes) {
        if (n.id === regionId) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    };
    const node = findNode(tree);
    if (!node) return;

    setAISuggestingRegionId(regionId);
    try {
      const result = await aiReviewChildren(worldViewId, regionId);
      // Pre-select add and rename actions (not remove — destructive)
      const selected = new Set(
        result.actions
          .filter((a: ReviewChildAction) => a.type !== 'remove')
          .map((a: ReviewChildAction) => `${a.type}:${a.name}`),
      );
      setAIReviewDialog({ regionId, regionName: node.name, result, selected });
    } catch (err) {
      console.error('AI review children failed:', err);
      setUndoSnackbar({
        open: true,
        message: `AI review children failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        worldViewId,
      });
    } finally {
      setAISuggestingRegionId(null);
    }
  }, [tree, worldViewId]);

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

  const toggleExpand = useCallback((id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const allBranchIds = useMemo(() => {
    if (!tree) return new Set<number>();
    const ids = new Set<number>();
    function walk(nodes: MatchTreeNode[]) {
      for (const node of nodes) {
        if (node.children.length > 0) {
          ids.add(node.id);
          walk(node.children);
        }
      }
    }
    walk(tree);
    return ids;
  }, [tree]);

  const expandAll = useCallback(() => {
    skipAnimationRef.current = true;
    setExpanded(new Set(allBranchIds));
    requestAnimationFrame(() => { skipAnimationRef.current = false; });
  }, [allBranchIds]);

  const collapseAll = useCallback(() => {
    skipAnimationRef.current = true;
    setExpanded(new Set());
    requestAnimationFrame(() => { skipAnimationRef.current = false; });
  }, []);

  const expandToUnresolved = useCallback(() => {
    if (!tree) return;
    skipAnimationRef.current = true;
    setExpanded(collectAncestorsOfUnresolved(tree));
    requestAnimationFrame(() => { skipAnimationRef.current = false; });
  }, [tree]);

  const expandToShadows = useCallback(() => {
    if (!tree || !shadowInsertions?.length) return;
    skipAnimationRef.current = true;
    const targetIds = new Set(shadowInsertions.map(s => s.targetRegionId));
    const ancestorIds = collectAncestorsOfIds(tree, targetIds);
    setExpanded(new Set([...ancestorIds, ...targetIds]));
    // Scroll to first target
    requestAnimationFrame(() => {
      skipAnimationRef.current = false;
      setTimeout(() => {
        const firstId = shadowInsertions[0].targetRegionId;
        document.querySelector(`[data-region-id="${firstId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    });
  }, [tree, shadowInsertions]);

  // Compute per-region shadow map
  const shadowsByRegionId = useMemo(() => {
    const map = new Map<number, ShadowInsertion[]>();
    for (const s of shadowInsertions ?? []) {
      const arr = map.get(s.targetRegionId) ?? [];
      arr.push(s);
      map.set(s.targetRegionId, arr);
    }
    return map;
  }, [shadowInsertions]);

  // Auto-expand tree ancestors when shadow insertions appear
  const prevShadowCount = useRef(0);
  useEffect(() => {
    if (!tree || !shadowInsertions?.length) {
      prevShadowCount.current = 0;
      return;
    }
    if (prevShadowCount.current === shadowInsertions.length) return;
    prevShadowCount.current = shadowInsertions.length;

    const targetIds = new Set(shadowInsertions.map(s => s.targetRegionId));
    const ancestorIds = collectAncestorsOfIds(tree, targetIds);
    // Also expand the target nodes themselves (for create_region, shadows appear as children)
    setExpanded(prev => new Set([...prev, ...ancestorIds, ...targetIds]));

    // Scroll to first target
    requestAnimationFrame(() => {
      setTimeout(() => {
        const firstId = shadowInsertions[0].targetRegionId;
        document.querySelector(`[data-region-id="${firstId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    });
  }, [tree, shadowInsertions]);

  const isMutating = acceptMutation.isPending || rejectMutation.isPending || acceptAndRejectRestMutation.isPending || dismissMutation.isPending || simplifyHierarchyMutation.isPending || simplifyChildrenMutation.isPending || syncMutation.isPending || groupingMutation.isPending || geocodeMatchMutation.isPending || geoshapeMatchMutation.isPending || pointMatchMutation.isPending || resetMatchMutation.isPending || rejectRemainingMutation.isPending || acceptAllMutation.isPending || acceptTransferMutation.isPending || selectMapMutation.isPending || manualFixMutation.isPending;

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
    <Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Button size="small" startIcon={<ExpandAllIcon />} onClick={expandAll}>
          Expand All
        </Button>
        <Button size="small" startIcon={<CollapseAllIcon />} onClick={collapseAll}>
          Collapse All
        </Button>
        <Button size="small" startIcon={<UnresolvedIcon />} onClick={expandToUnresolved} color="warning">
          Show Unresolved
        </Button>
        {shadowInsertions && shadowInsertions.length > 0 && (
          <Button size="small" startIcon={<GapsIcon />} onClick={expandToShadows} color="info">
            Show {shadowInsertions.length} Gap{shadowInsertions.length !== 1 ? 's' : ''} to Review
          </Button>
        )}
      </Box>
      {tree.map(node => (
        <TreeNodeRow
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          ancestorIsMatched={false}
          onToggle={toggleExpand}
          onAccept={(regionId, divisionId) => acceptMutation.mutate({ regionId, divisionId })}
          onAcceptTransfer={onAcceptTransfer}
          onAcceptAndRejectRest={(regionId, divisionId) => acceptAndRejectRestMutation.mutate({ regionId, divisionId })}
          onReject={(regionId, divisionId) => rejectMutation.mutate({ regionId, divisionId })}
          onDBSearch={(regionId) => dbSearchOneMutation.mutate(regionId)}
          onAIMatch={(regionId) => aiMatchOneMutation.mutate(regionId)}
          onDismissChildren={(regionId) => dismissMutation.mutate(regionId)}
          onSimplifyHierarchy={(regionId) => simplifyHierarchyMutation.mutate(regionId)}
          onSimplifyChildren={(regionId) => simplifyChildrenMutation.mutate(regionId)}
          onSmartSimplify={handleSmartSimplify}
          onAISuggestChildren={handleAIReviewChildren}
          aiSuggestingRegionId={aiSuggestingRegionId}
          onCVMatch={handleCVMatch}
          cvMatchingRegionId={cvMatchingRegionId}
          onMapshapeMatch={handleMapshapeMatch}
          mapshapeMatchingRegionId={mapshapeMatchingRegionId}
          onSync={(regionId) => syncMutation.mutate(regionId)}
          onHandleAsGrouping={(regionId) => groupingMutation.mutate(regionId)}
          onGeocodeMatch={(regionId) => geocodeMatchMutation.mutate(regionId)}
          onGeoshapeMatch={(regionId, scopeAncestorId) => geoshapeMatchMutation.mutate({ regionId, scopeAncestorId })}
          onPointMatch={(regionId, scopeAncestorId) => pointMatchMutation.mutate({ regionId, scopeAncestorId })}
          onResetMatch={(regionId) => resetMatchMutation.mutate(regionId)}
          onRejectRemaining={(regionId) => rejectRemainingMutation.mutate(regionId)}
          onAcceptAll={(assignments) => acceptAllMutation.mutate(assignments)}
          onPreview={onPreview}
          onPreviewTransfer={onPreviewTransfer}
          onOpenMapPicker={handleOpenMapPicker}
          onManualFix={(regionId, needsManualFix) => {
            if (needsManualFix) {
              // Find the node name for the dialog title
              const findName = (nodes: MatchTreeNode[]): string => {
                for (const n of nodes) {
                  if (n.id === regionId) return n.name;
                  const found = findName(n.children);
                  if (found) return found;
                }
                return '';
              };
              setFixDialogState({ regionId, regionName: findName(tree!) });
            } else {
              manualFixMutation.mutate({ regionId, needsManualFix: false });
            }
          }}
          isMutating={isMutating}
          dbSearchingRegionId={dbSearchOneMutation.isPending ? (dbSearchOneMutation.variables ?? null) : null}
          aiMatchingRegionId={aiMatchOneMutation.isPending ? (aiMatchOneMutation.variables ?? null) : null}
          dismissingRegionId={dismissMutation.isPending ? (dismissMutation.variables ?? null) : null}
          simplifyingRegionId={simplifyHierarchyMutation.isPending ? (simplifyHierarchyMutation.variables ?? null) : null}
          simplifyingChildrenRegionId={simplifyChildrenMutation.isPending ? (simplifyChildrenMutation.variables ?? null) : null}
          syncingRegionId={syncMutation.isPending ? (syncMutation.variables ?? null) : null}
          groupingRegionId={groupingMutation.isPending ? (groupingMutation.variables ?? null) : null}
          geocodeMatchingRegionId={geocodeMatchMutation.isPending ? (geocodeMatchMutation.variables ?? null) : null}
          geoshapeMatchingRegionId={geoshapeMatchMutation.isPending ? (geoshapeMatchMutation.variables?.regionId ?? null) : null}
          pointMatchingRegionId={pointMatchMutation.isPending ? (pointMatchMutation.variables?.regionId ?? null) : null}
          geocodeProgress={geocodeProgress}
          duplicateUrls={duplicateUrls}
          syncedUrls={syncedUrls}
          shadowsByRegionId={shadowsByRegionId}
          onApproveShadow={onApproveShadow}
          onRejectShadow={onRejectShadow}
          skipAnimationRef={skipAnimationRef}
        />
      ))}
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
      <ManualFixDialog
        state={fixDialogState}
        onClose={() => setFixDialogState(null)}
        onSubmit={(regionId, note) => manualFixMutation.mutate({ regionId, needsManualFix: true, fixNote: note })}
        isPending={manualFixMutation.isPending}
      />
      {smartSimplifyDialog && (
        <SmartSimplifyDialog
          open
          onClose={() => setSmartSimplifyDialog(null)}
          worldViewId={worldViewId}
          parentRegionId={smartSimplifyDialog.regionId}
          parentRegionName={smartSimplifyDialog.regionName}
          regionMapUrl={smartSimplifyDialog.regionMapUrl}
          onApplied={() => invalidateTree()}
        />
      )}

      <CvMatchDialog
        cvMatchDialog={cvMatchDialog}
        setCVMatchDialog={setCVMatchDialog}
        onClose={cancelCvMatch}
      />

      {/* AI Review Children dialog */}
      {aiReviewDialog && (
        <AIReviewChildrenDialog
          state={aiReviewDialog}
          onClose={() => setAIReviewDialog(null)}
          onToggle={(key) => {
            setAIReviewDialog(prev => {
              if (!prev) return prev;
              const next = new Set(prev.selected);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return { ...prev, selected: next };
            });
          }}
          onSubmit={async () => {
            if (!aiReviewDialog) return;
            const { regionId: parentId, result, selected } = aiReviewDialog;
            setAIReviewDialog(null);

            // Batch all API calls, then invalidate once
            const promises: Promise<unknown>[] = [];
            for (const key of selected) {
              const colonIdx = key.indexOf(':');
              const type = key.slice(0, colonIdx);
              const name = key.slice(colonIdx + 1);
              const action = result.actions.find((a: ReviewChildAction) => a.type === type && a.name === name);
              if (!action) continue;

              if (action.type === 'add') {
                promises.push(addChildRegion(
                  worldViewId, parentId, action.name,
                  action.sourceUrl ?? undefined, action.sourceExternalId ?? undefined,
                ));
              } else if (action.type === 'remove') {
                const childId = tree ? findChildIdByName(tree, parentId, action.name) : undefined;
                if (childId) {
                  // Reparent both children AND assigned GADM divisions up to the parent;
                  // otherwise CASCADE would silently delete `region_members` rows the admin
                  // had already accepted.
                  promises.push(removeRegionFromImport(worldViewId, childId, true, true));
                }
              } else if (action.type === 'rename') {
                const childId = tree ? findChildIdByName(tree, parentId, action.name) : undefined;
                if (childId) {
                  promises.push(renameRegion(
                    worldViewId, childId, action.newName ?? action.name,
                    action.sourceUrl ?? undefined, action.sourceExternalId ?? undefined,
                  ));
                }
              }
            }

            const results = await Promise.allSettled(promises);
            const failures = results.filter(r => r.status === 'rejected');
            if (failures.length > 0) {
              for (const f of failures) {
                console.error('[AI Review Children] action failed:', (f as PromiseRejectedResult).reason);
              }
              alert(`AI Review Children: ${failures.length} of ${results.length} action(s) failed. See browser console for details. The tree will refresh to reflect the partial result.`);
            }
            invalidateTree();
          }}
        />
      )}
    </Box>
  );
}

/** Dialog showing AI-reviewed children actions grouped by type */
function AIReviewChildrenDialog({ state, onClose, onToggle, onSubmit }: {
  state: {
    regionId: number;
    regionName: string;
    result: AIReviewChildrenResult;
    selected: Set<string>;
  };
  onClose: () => void;
  onToggle: (key: string) => void;
  onSubmit: () => void;
}) {
  const addActions = state.result.actions.filter((a: ReviewChildAction) => a.type === 'add');
  const removeActions = state.result.actions.filter((a: ReviewChildAction) => a.type === 'remove');
  const renameActions = state.result.actions.filter((a: ReviewChildAction) => a.type === 'rename');

  const renderEnrichment = (action: ReviewChildAction) => {
    if (action.type === 'remove' || !action.verified) return null;
    return (
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {action.sourceUrl && (
          <Typography variant="caption" color="text.secondary">
            <LinkIcon sx={{ fontSize: 12, mr: 0.25, verticalAlign: 'middle' }} />
            <MuiLink href={action.sourceUrl} target="_blank" rel="noopener" sx={{ fontSize: 'inherit' }}>
              {decodeURIComponent(action.sourceUrl.split('/wiki/')[1] ?? '')}
            </MuiLink>
          </Typography>
        )}
        {action.sourceExternalId && (
          <Typography variant="caption" color="text.secondary">
            <MuiLink
              href={`https://www.wikidata.org/wiki/${action.sourceExternalId}`}
              target="_blank"
              rel="noopener"
              sx={{ fontSize: 'inherit' }}
            >
              {action.sourceExternalId}
            </MuiLink>
          </Typography>
        )}
      </Box>
    );
  };

  const renderSection = (
    title: string,
    actions: ReviewChildAction[],
    color: string,
  ) => {
    if (actions.length === 0) return null;
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" color={color} sx={{ mb: 0.5 }}>
          {title} ({actions.length})
        </Typography>
        {actions.map((a) => {
          const key = `${a.type}:${a.name}`;
          return (
            <Box key={key} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.5 }}>
              <Checkbox
                size="small"
                checked={state.selected.has(key)}
                onChange={() => onToggle(key)}
                sx={{ p: 0.25, mt: 0.25 }}
              />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2">
                  {a.type === 'rename' ? (
                    <>{a.name} <ArrowForwardIcon sx={{ fontSize: 14, verticalAlign: 'middle', mx: 0.5 }} /> {a.newName}</>
                  ) : (
                    a.name
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">{a.reason}</Typography>
                {renderEnrichment(a)}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Review Children for &quot;{state.regionName}&quot;</DialogTitle>
      <DialogContent>
        {state.result.analysis && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {state.result.analysis}
          </Typography>
        )}
        {state.result.actions.length === 0 && (
          <Typography variant="body2">All children look correct — no changes suggested.</Typography>
        )}
        {renderSection('Add', addActions, 'success.main')}
        {renderSection('Remove', removeActions, 'error.main')}
        {renderSection('Rename', renameActions, 'warning.main')}
        {state.result.stats && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            {(state.result.stats.inputTokens + state.result.stats.outputTokens).toLocaleString()} tokens
            {' · '}${state.result.stats.cost.toFixed(4)}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!state.selected.size}
          onClick={onSubmit}
        >
          Apply {state.selected.size} Selected
        </Button>
      </DialogActions>
    </Dialog>
  );
}
